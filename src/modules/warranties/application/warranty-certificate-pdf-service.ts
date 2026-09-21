import 'server-only';
import { createHash } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { getEnv } from '@/core/config/env';
import { getDb } from '@/core/db/client';
import { affectedRows } from '@/core/db/affected-rows';
import { runInTransaction, type TransactionExecutor } from '@/core/db/unit-of-work';
import { NotFoundError } from '@/core/errors';
import { logger } from '@/core/logging/logger';
import { getFileStorage } from '@/core/storage/file-storage';
import { authorize } from '@/modules/access-control/application/authorization-service';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { AUDIT_ACTIONS, recordAudit } from '@/modules/audit/application/audit-service';
import { FEATURES } from '@/modules/features/domain/catalog';
import type { TenantContext } from '@/modules/tenancy/domain/tenant-context';
import { buildCertificateDocument } from '@/modules/warranties/domain/certificate-document';
import {
  CERTIFICATE_PDF_EXTENSION,
  CERTIFICATE_PDF_MIME,
  CERTIFICATE_PDF_SCOPE,
  certificatePdfFilename,
} from '@/modules/warranties/domain/certificate-pdf';
import { certificatePathFor, WARRANTY_TIMELINE_KINDS } from '@/modules/warranties/domain/warranty';
import { getCertificatePdfRenderer } from '@/modules/warranties/infrastructure/pdf/certificate-pdf-renderer';
import { warrantyCertificates } from '@/modules/warranties/infrastructure/schema';
import type { CertificateSnapshot } from './warranty-certificate-service';
import { loadWarranty, writeWarrantyTimeline } from './warranty-service';

/**
 * PDF DO CERTIFICADO DE GARANTIA (Prompt 13.1).
 *
 * O QUE ESTE MODULO ENTREGA: um arquivo `application/pdf` de verdade, gerado
 * no servidor a partir do snapshot congelado na emissao, guardado uma vez e
 * reutilizado.
 *
 * O SNAPSHOT E A AUTORIDADE (item 9). Este arquivo NAO importa
 * `warranty_policies`, nao consulta cliente vivo e nao recalcula cobertura:
 * ele le `warranty_certificates.snapshot` e mais nada. Mudar a politica
 * amanha nao mexe num PDF emitido hoje, e ha teste que prova isso.
 *
 * O PDF NAO E A GARANTIA (item 2). A garantia e a entidade de negocio; o
 * certificado e o documento; o snapshot e o conteudo congelado; o PDF e uma
 * REPRESENTACAO dele. Apagar o arquivo nao apaga direito nenhum — ele volta a
 * ser gerado do snapshot (item 37).
 */

/** Um PDF valido nunca e menor que isto. Serve para detectar arquivo truncado. */
const MIN_PDF_BYTES = 400;

export interface CertificatePdfArtifact {
  certificateId: string;
  storageKey: string;
  byteSize: number;
  /** SHA-256 dos bytes do arquivo. */
  checksum: string;
  pageCount: number;
  filename: string;
  /** `true` quando o arquivo ja existia e foi reaproveitado (itens 24 e 54). */
  reused: boolean;
}

interface CertificateRow {
  id: string;
  warrantyId: string;
  token: string;
  snapshot: string;
  checksum: string;
  issuedAt: Date;
  pdfStorageKey: string | null;
  pdfChecksum: string | null;
  pdfSnapshotChecksum: string | null;
  pdfByteSize: number | null;
  pdfPageCount: number | null;
}

async function loadCertificateRow(
  context: TenantContext,
  warrantyId: string,
): Promise<CertificateRow> {
  const [row] = await getDb()
    .select({
      id: warrantyCertificates.id,
      warrantyId: warrantyCertificates.warrantyId,
      token: warrantyCertificates.token,
      snapshot: warrantyCertificates.snapshot,
      checksum: warrantyCertificates.checksum,
      issuedAt: warrantyCertificates.issuedAt,
      pdfStorageKey: warrantyCertificates.pdfStorageKey,
      pdfChecksum: warrantyCertificates.pdfChecksum,
      pdfSnapshotChecksum: warrantyCertificates.pdfSnapshotChecksum,
      pdfByteSize: warrantyCertificates.pdfByteSize,
      pdfPageCount: warrantyCertificates.pdfPageCount,
    })
    .from(warrantyCertificates)
    .where(
      and(
        eq(warrantyCertificates.tenantId, context.tenantId),
        eq(warrantyCertificates.warrantyId, warrantyId),
      ),
    )
    .limit(1);

  if (!row) {
    throw new NotFoundError('Esta garantia ainda nao tem certificado emitido.');
  }
  return row;
}

/**
 * O endereco que o QR carrega.
 *
 * Nao vem do snapshot de proposito: o certificado historico continua valido
 * se a empresa trocar de dominio, e congelar a URL antiga deixaria o QR
 * apontando para um lugar que nao existe mais. O que e imutavel e o TOKEN.
 */
function verificationUrl(token: string): string {
  return new URL(certificatePathFor(token), getEnv().APP_URL).toString();
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Le o arquivo guardado e confere se ele ainda e o que foi gravado (item 38).
 *
 * Devolve `null` — e nao erro — quando o arquivo sumiu, veio vazio ou nao bate
 * com o checksum. Quem chama trata isso como "precisa gerar de novo", e o
 * usuario recebe o documento em vez de uma falha que ele nao pode resolver.
 */
async function readStoredPdf(row: CertificateRow): Promise<Buffer | null> {
  if (!row.pdfStorageKey || !row.pdfChecksum) return null;
  if (row.pdfSnapshotChecksum !== row.checksum) return null;

  try {
    const bytes = await getFileStorage().read(row.pdfStorageKey);
    if (bytes.byteLength < MIN_PDF_BYTES) return null;
    if (sha256(bytes) !== row.pdfChecksum) {
      logger.warn('PDF de certificado com checksum divergente; sera regerado', {
        module: 'warranties',
        operation: 'readStoredPdf',
        certificateId: row.id,
      });
      return null;
    }
    return bytes;
  } catch {
    /** Arquivo ausente e caso previsto (item 37): o snapshot regenera. */
    return null;
  }
}

/**
 * Garante que existe um PDF para o certificado desta garantia.
 *
 * IDEMPOTENTE POR VERSAO DE SNAPSHOT (itens 24 e 25). Dez cliques produzem UM
 * artefato; so um snapshot diferente justifica arquivo novo.
 *
 * CONCORRENCIA (itens 55 e 69). O `UPDATE` so vence se o registro ainda NAO
 * tiver o PDF desta versao. Como a renderizacao e deterministica, todas as
 * chamadas simultaneas produzem bytes identicos; quem perde a corrida APAGA o
 * proprio arquivo e devolve o do vencedor. Resultado: um artefato logico, um
 * arquivo referenciado, nenhum orfao.
 *
 * FRONTEIRA COM O STORAGE (item 34). O armazenamento NAO participa da
 * transacao do banco — e disco, nao MariaDB. A ordem e deliberada: renderiza,
 * grava o arquivo, e so entao registra no banco. Se a gravacao falhar, nada e
 * registrado e o banco continua dizendo a verdade ("nao ha PDF"); o pior caso
 * e um arquivo sem referencia, que nao mente para ninguem. A ordem inversa
 * produziria uma linha apontando para um arquivo inexistente.
 */
export async function ensureCertificatePdf(
  context: TenantContext,
  warrantyId: string,
): Promise<CertificatePdfArtifact> {
  const warranty = await loadWarranty(context, warrantyId);

  /**
   * MESMA PERMISSAO DE VER O CERTIFICADO (item 31).
   *
   * O PDF nao revela nada alem do que a pessoa ja le na tela: e a mesma
   * informacao, noutro formato. Criar `warranties.pdf.download` seria
   * permissao por botao, que o item 31 proibe.
   */
  await authorize(context, {
    permission: PERMISSIONS.WARRANTIES_VIEW,
    featureKey: FEATURES.OPERATIONS_WARRANTIES,
    unitId: warranty.unitId,
  });

  const row = await loadCertificateRow(context, warrantyId);
  const snapshot = JSON.parse(row.snapshot) as CertificateSnapshot;
  const filename = certificatePdfFilename(snapshot.garantia.numero);

  const guardado = await readStoredPdf(row);
  if (guardado && row.pdfStorageKey && row.pdfChecksum) {
    return {
      certificateId: row.id,
      storageKey: row.pdfStorageKey,
      byteSize: guardado.byteLength,
      checksum: row.pdfChecksum,
      pageCount: row.pdfPageCount ?? 1,
      filename,
      reused: true,
    };
  }

  const documento = buildCertificateDocument(snapshot, verificationUrl(row.token));
  const renderer = getCertificatePdfRenderer();
  /** `issuedAt` fixa os metadados: mesmo snapshot, mesmos bytes (item 23). */
  const rendered = await renderer.render(documento, row.issuedAt);

  const stored = await getFileStorage().save({
    data: rendered.bytes,
    extension: CERTIFICATE_PDF_EXTENSION,
    scope: CERTIFICATE_PDF_SCOPE,
  });

  const now = new Date();
  const chaveAnterior = row.pdfStorageKey;
  const primeiraGeracao = chaveAnterior === null;

  const venceu = await runInTransaction(async (tx) => {
    const resultado = await tx
      .update(warrantyCertificates)
      .set({
        pdfStorageKey: stored.key,
        pdfMimeType: CERTIFICATE_PDF_MIME,
        pdfByteSize: stored.byteSize,
        pdfChecksum: stored.checksum,
        pdfSnapshotChecksum: row.checksum,
        pdfPageCount: rendered.pageCount,
        pdfGeneratedAt: now,
        pdfRenderer: rendered.renderer,
        updatedAt: now,
      })
      .where(
        and(
          eq(warrantyCertificates.id, row.id),
          eq(warrantyCertificates.tenantId, context.tenantId),
          /**
           * COMPARE-AND-SWAP NA CHAVE DO ARQUIVO.
           *
           * A condicao e "o registro continua como eu o li": ou ainda nao
           * tinha arquivo, ou tinha exatamente aquele. Quem chega depois nao
           * encontra mais esse estado e perde a corrida — mesmo quando o
           * motivo da geracao e o arquivo ter sumido, caso em que a chave
           * anterior existe e serve de token.
           *
           * Comparar o checksum do snapshot NAO serviria: dois retries de
           * regeneracao produzem bytes identicos, os dois casariam, e os dois
           * gravariam — deixando um arquivo sem referencia no disco.
           */
          chaveAnterior === null
            ? isNull(warrantyCertificates.pdfStorageKey)
            : eq(warrantyCertificates.pdfStorageKey, chaveAnterior),
        ),
      );

    if (affectedRows(resultado) === 0) return false;

    if (primeiraGeracao) {
      await writeWarrantyTimeline(tx as TransactionExecutor, {
        tenantId: context.tenantId,
        warrantyId,
        kind: WARRANTY_TIMELINE_KINDS.CERTIFICATE_PDF_GENERATED,
        summary: 'Certificado em PDF gerado',
        actorId: context.userId,
        occurredAt: now,
      });
    }

    await recordAudit(
      {
        action: AUDIT_ACTIONS.WARRANTY_CERTIFICATE_PDF_GENERATED,
        entityType: 'warranty_certificate',
        entityId: row.id,
        tenantId: context.tenantId,
        unitId: warranty.unitId,
        userId: context.userId,
        /** Identificadores e impressoes digitais; nunca o conteudo. */
        after: {
          warrantyId,
          snapshotChecksum: row.checksum,
          pdfChecksum: stored.checksum,
          pageCount: rendered.pageCount,
          renderer: rendered.renderer,
        },
      },
      tx,
    );

    return true;
  });

  if (venceu) {
    /**
     * Substituicao NAO acumula arquivo (item 24): a versao anterior deixa de
     * ser referenciada e sai do disco. Falha aqui nao invalida a geracao — o
     * registro ja aponta para o arquivo novo.
     */
    if (chaveAnterior && chaveAnterior !== stored.key) {
      await getFileStorage()
        .remove(chaveAnterior)
        .catch(() => undefined);
    }

    return {
      certificateId: row.id,
      storageKey: stored.key,
      byteSize: stored.byteSize,
      checksum: stored.checksum,
      pageCount: rendered.pageCount,
      filename,
      reused: false,
    };
  }

  /**
   * Outra chamada gravou primeiro. Como o documento e deterministico, o
   * arquivo dela tem exatamente os mesmos bytes — o nosso e descartado para
   * nao deixar orfao no disco.
   */
  await getFileStorage()
    .remove(stored.key)
    .catch(() => undefined);

  const vencedor = await loadCertificateRow(context, warrantyId);
  return {
    certificateId: vencedor.id,
    storageKey: vencedor.pdfStorageKey ?? stored.key,
    byteSize: vencedor.pdfByteSize ?? stored.byteSize,
    checksum: vencedor.pdfChecksum ?? stored.checksum,
    pageCount: vencedor.pdfPageCount ?? rendered.pageCount,
    filename,
    reused: true,
  };
}

export interface CertificatePdfDownload {
  bytes: Buffer;
  filename: string;
  byteSize: number;
  checksum: string;
  mimeType: string;
}

/**
 * Entrega os bytes para download (itens 29, 30, 36 e 54).
 *
 * Reutiliza o arquivo guardado quando ele esta integro; so renderiza de novo
 * quando nao ha arquivo, quando ele sumiu ou quando o snapshot mudou.
 */
export async function readCertificatePdf(
  context: TenantContext,
  warrantyId: string,
): Promise<CertificatePdfDownload> {
  const artefato = await ensureCertificatePdf(context, warrantyId);
  const bytes = await getFileStorage().read(artefato.storageKey);

  /**
   * Nunca entregar HTML com MIME de PDF (item 36). Se o que voltou do disco
   * nao e um PDF, isso e falha de infraestrutura e vira erro — nao um arquivo
   * quebrado na pasta de downloads do cliente.
   */
  if (bytes.byteLength < MIN_PDF_BYTES || bytes.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw new NotFoundError('O arquivo do certificado nao esta disponivel.');
  }

  return {
    bytes,
    filename: artefato.filename,
    byteSize: bytes.byteLength,
    checksum: artefato.checksum,
    mimeType: CERTIFICATE_PDF_MIME,
  };
}
