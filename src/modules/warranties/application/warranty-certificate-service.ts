import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/core/db/client';
import { runInTransaction, type TransactionExecutor } from '@/core/db/unit-of-work';
import { BusinessRuleError, NotFoundError } from '@/core/errors';
import { newId } from '@/core/ids/id';
import { authorize } from '@/modules/access-control/application/authorization-service';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { AUDIT_ACTIONS, recordAudit } from '@/modules/audit/application/audit-service';
import { customers } from '@/modules/customers/infrastructure/schema';
import { equipmentTitle } from '@/modules/equipment/domain/equipment';
import { equipment } from '@/modules/equipment/infrastructure/schema';
import { EVENT_TYPES } from '@/modules/events/domain/event';
import { FEATURES } from '@/modules/features/domain/catalog';
import { serviceOrders } from '@/modules/service-orders/infrastructure/schema';
import { tenants, units } from '@/modules/tenancy/infrastructure/schema';
import type { TenantContext } from '@/modules/tenancy/domain/tenant-context';
import {
  CERTIFICATE_TOKEN_BYTES,
  formatDuration,
  formatWarrantyNumber,
  WARRANTY_TIMELINE_KINDS,
  warrantyTypeLabel,
  type DurationUnit,
} from '@/modules/warranties/domain/warranty';
import { warrantyCertificates } from '@/modules/warranties/infrastructure/schema';
import { listCoverageItems, loadWarranty, writeWarrantyTimeline } from './warranty-service';

/**
 * CERTIFICADO DE GARANTIA (Prompt 13, itens 18 a 21, 55 e 123).
 *
 * O QUE ESTE MODULO ENTREGA, DITO SEM EUFEMISMO: um documento HTML pronto
 * para impressao, com snapshot e checksum. NAO ha geracao de PDF.
 *
 * POR QUE NAO HA PDF. A stack atual — Next.js sobre Node, sem servico de
 * renderizacao — nao produz PDF sem trazer uma dependencia pesada (Chromium
 * headless ou uma biblioteca de layout), e nenhuma das duas cabe neste prompt
 * sem decisao de infraestrutura propria. Chamar de "PDF" um HTML que o
 * navegador imprime seria exatamente o tipo de promessa que o item 130 proibe.
 *
 * O QUE FICA PREPARADO: `format` e coluna, e o snapshot e completo e
 * determinístico. Quando houver provider de PDF, ele le o MESMO snapshot e
 * grava `format = 'pdf'` — sem tocar em nada do que ja foi emitido.
 */

export interface CertificateSnapshot {
  emitidoEm: string;
  empresa: { nome: string; unidade: string };
  garantia: {
    numero: string;
    tipo: string;
    vigencia: { inicio: string; fim: string };
    duracao: string;
    cobreServicoInteiro: boolean;
  };
  cliente: { nome: string };
  equipamento: { descricao: string; marca: string | null; modelo: string | null };
  ordemDeServico: { numero: number } | null;
  cobertura: Array<{ tipo: string; descricao: string }>;
  exclusoes: string | null;
  termos: string | null;
}

/**
 * Monta o documento a partir da GARANTIA, nunca da politica (item 20).
 *
 * Esta funcao nao consulta `warranty_policies` em lugar nenhum — e essa
 * ausencia e o ponto. A politica pode ter mudado, sido desativada ou
 * excluida; o certificado continua dizendo o que foi prometido.
 */
async function buildSnapshot(
  context: TenantContext,
  warrantyId: string,
): Promise<CertificateSnapshot> {
  const warranty = await loadWarranty(context, warrantyId);
  const db = getDb();

  const [[tenant], [unit], [cliente], [aparelho], cobertura] = await Promise.all([
    db
      .select({ name: tenants.name })
      .from(tenants)
      .where(eq(tenants.id, context.tenantId))
      .limit(1),
    db.select({ name: units.name }).from(units).where(eq(units.id, warranty.unitId)).limit(1),
    db
      .select({ name: customers.name })
      .from(customers)
      .where(eq(customers.id, warranty.customerId))
      .limit(1),
    db
      .select({ kind: equipment.kind, brand: equipment.brand, model: equipment.model })
      .from(equipment)
      .where(eq(equipment.id, warranty.equipmentId))
      .limit(1),
    listCoverageItems(context, warrantyId),
  ]);

  const os = warranty.serviceOrderId
    ? await db
        .select({ number: serviceOrders.number })
        .from(serviceOrders)
        .where(eq(serviceOrders.id, warranty.serviceOrderId))
        .limit(1)
    : [];

  return {
    emitidoEm: new Date().toISOString().slice(0, 10),
    empresa: { nome: tenant?.name ?? '', unidade: unit?.name ?? '' },
    garantia: {
      numero: formatWarrantyNumber(warranty.number),
      tipo: warrantyTypeLabel(warranty.type),
      vigencia: { inicio: warranty.startsOn, fim: warranty.endsOn },
      duracao: formatDuration(warranty.durationAmount, warranty.durationUnit as DurationUnit),
      cobreServicoInteiro: warranty.coversWholeService === 1,
    },
    /** SO o nome. Sem CPF, telefone, e-mail ou endereco (item 120). */
    cliente: { nome: cliente?.name ?? '' },
    /**
     * Marca, modelo e tipo — e NAO o serial completo (item 85 e 120).
     *
     * O serial identifica o aparelho de forma unica e circula em garantia de
     * fabrica, revenda e seguro. Num documento que o cliente carrega e
     * fotografa, ele nao acrescenta nada que a loja precise e acrescenta tudo
     * que alguem mal-intencionado gostaria de ter.
     */
    equipamento: {
      descricao: aparelho ? equipmentTitle(aparelho) : '',
      marca: aparelho?.brand ?? null,
      modelo: aparelho?.model ?? null,
    },
    ordemDeServico: os[0] ? { numero: os[0].number } : null,
    cobertura: cobertura.map((item) => ({ tipo: item.kind, descricao: item.description })),
    exclusoes: warranty.exclusions,
    termos: warranty.terms,
  };
}

/**
 * Emite (ou regenera) o certificado.
 *
 * REGENERAR NAO ACUMULA ARQUIVO (item 55): `UNIQUE(warranty_id)` garante um
 * certificado por garantia, e o retry substitui o conteudo em vez de criar o
 * decimo documento identico.
 *
 * O TOKEN, uma vez criado, NAO MUDA. Um QR ja impresso continua valendo — e
 * um token novo a cada regeracao transformaria cada reimpressao numa
 * invalidacao silenciosa do papel que o cliente tem em casa.
 */
export async function issueCertificate(
  context: TenantContext,
  warrantyId: string,
): Promise<{ certificateId: string; token: string; checksum: string; reused: boolean }> {
  const warranty = await loadWarranty(context, warrantyId);

  await authorize(context, {
    permission: PERMISSIONS.WARRANTIES_ISSUE,
    featureKey: FEATURES.OPERATIONS_WARRANTIES,
    unitId: warranty.unitId,
  });

  if (warranty.status !== 'active') {
    throw new BusinessRuleError(
      'So uma garantia ativa tem certificado. Cancelada ou revogada nao gera documento novo.',
    );
  }

  const snapshot = await buildSnapshot(context, warrantyId);
  const serialized = JSON.stringify(snapshot);
  const checksum = createHash('sha256').update(serialized).digest('hex');

  const [existing] = await getDb()
    .select({ id: warrantyCertificates.id, token: warrantyCertificates.token })
    .from(warrantyCertificates)
    .where(
      and(
        eq(warrantyCertificates.tenantId, context.tenantId),
        eq(warrantyCertificates.warrantyId, warrantyId),
      ),
    )
    .limit(1);

  const certificateId = existing?.id ?? newId();
  /** Token opaco e nao enumeravel. Preservado entre regeracoes. */
  const token = existing?.token ?? randomBytes(CERTIFICATE_TOKEN_BYTES).toString('base64url');
  const now = new Date();

  await runInTransaction(async (tx, emit) => {
    if (existing) {
      await tx
        .update(warrantyCertificates)
        .set({
          snapshot: serialized,
          checksum,
          issuedAt: now,
          issuedBy: context.userId,
          updatedAt: now,
        })
        .where(eq(warrantyCertificates.id, certificateId));
    } else {
      await tx.insert(warrantyCertificates).values({
        id: certificateId,
        tenantId: context.tenantId,
        warrantyId,
        token,
        format: 'html',
        snapshot: serialized,
        checksum,
        issuedAt: now,
        issuedBy: context.userId,
        createdAt: now,
        updatedAt: now,
      });
    }

    await writeWarrantyTimeline(tx as TransactionExecutor, {
      tenantId: context.tenantId,
      warrantyId,
      kind: WARRANTY_TIMELINE_KINDS.CERTIFICATE_ISSUED,
      summary: existing ? 'Certificado gerado novamente' : 'Certificado gerado',
      actorId: context.userId,
      occurredAt: now,
    });

    await recordAudit(
      {
        action: AUDIT_ACTIONS.WARRANTY_CERTIFICATE_ISSUED,
        entityType: 'warranty_certificate',
        entityId: certificateId,
        tenantId: context.tenantId,
        unitId: warranty.unitId,
        userId: context.userId,
        after: { warrantyId, checksum, regenerated: Boolean(existing) },
      },
      tx,
    );

    await emit({
      type: EVENT_TYPES.WARRANTY_CERTIFICATE_ISSUED,
      tenantId: context.tenantId,
      /** Nem o token, nem o snapshot: identificadores e a impressao digital. */
      payload: { warrantyId, certificateId, checksum },
    });
  });

  return { certificateId, token, checksum, reused: Boolean(existing) };
}

export async function loadCertificate(context: TenantContext, warrantyId: string) {
  const [row] = await getDb()
    .select({
      id: warrantyCertificates.id,
      token: warrantyCertificates.token,
      format: warrantyCertificates.format,
      snapshot: warrantyCertificates.snapshot,
      checksum: warrantyCertificates.checksum,
      issuedAt: warrantyCertificates.issuedAt,
    })
    .from(warrantyCertificates)
    .where(
      and(
        eq(warrantyCertificates.tenantId, context.tenantId),
        eq(warrantyCertificates.warrantyId, warrantyId),
      ),
    )
    .limit(1);

  if (!row) return null;
  return { ...row, snapshot: JSON.parse(row.snapshot) as CertificateSnapshot };
}

/**
 * Resolve o token do QR.
 *
 * O TOKEN IDENTIFICA, NAO AUTORIZA (item 21). Esta funcao exige contexto de
 * tenant e so devolve certificado daquele tenant — quem fotografou o QR na
 * fila do balcao nao ganha acesso a nada sem sessao valida.
 */
export async function findCertificateByToken(context: TenantContext, token: string) {
  const [row] = await getDb()
    .select({
      warrantyId: warrantyCertificates.warrantyId,
      snapshot: warrantyCertificates.snapshot,
      checksum: warrantyCertificates.checksum,
      issuedAt: warrantyCertificates.issuedAt,
    })
    .from(warrantyCertificates)
    .where(
      and(
        eq(warrantyCertificates.tenantId, context.tenantId),
        eq(warrantyCertificates.token, token),
      ),
    )
    .limit(1);

  if (!row) throw new NotFoundError('Certificado nao encontrado.');
  return { ...row, snapshot: JSON.parse(row.snapshot) as CertificateSnapshot };
}
