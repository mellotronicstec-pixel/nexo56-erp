import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { runWithContext } from '@/core/context/request-context';
import { getDb } from '@/core/db/client';
import { AuthorizationError, NotFoundError } from '@/core/errors';
import { getFileStorage } from '@/core/storage/file-storage';
import { auditLogs } from '@/modules/audit/infrastructure/schema';
import { createCustomer } from '@/modules/customers/application/customer-service';
import { customers } from '@/modules/customers/infrastructure/schema';
import { createEquipment } from '@/modules/equipment/application/equipment-service';
import { setTenantFeature } from '@/modules/features/application/tenant-configuration';
import { FEATURES } from '@/modules/features/domain/catalog';
import { createServiceOrder } from '@/modules/service-orders/application/service-order-service';
import { transitionServiceOrder } from '@/modules/service-orders/application/workflow-service';
import type { ServiceOrderStatus } from '@/modules/service-orders/domain/workflow';
import {
  ensureCertificatePdf,
  readCertificatePdf,
} from '@/modules/warranties/application/warranty-certificate-pdf-service';
import { issueCertificate } from '@/modules/warranties/application/warranty-certificate-service';
import { updateWarrantyPolicy } from '@/modules/warranties/application/warranty-policy-service';
import { createWarrantyPolicy } from '@/modules/warranties/application/warranty-policy-service';
import { issueWarranty, revokeWarranty } from '@/modules/warranties/application/warranty-service';
import { warrantyCertificates, warrantyTimeline } from '@/modules/warranties/infrastructure/schema';
import { closeTestDatabase, migrateTestDatabase, truncateAll } from '../helpers/database';
import {
  clearTenantRoles,
  contextFor,
  createTenantFixture,
  seedCatalog,
  type TenantFixture,
} from '../helpers/fixtures';
import { extractPdf, hasPdfMagicBytes } from '../helpers/pdf';

/**
 * CERTIFICADO EM PDF — CICLO COMPLETO (Prompt 13.1, itens 63 a 69).
 *
 * O eixo: o PDF e uma REPRESENTACAO do snapshot historico. Ele nao e a
 * garantia, nao altera nada e nao envelhece quando a empresa muda de ideia.
 */

let tenantA: TenantFixture;
let tenantB: TenantFixture;
let clienteA: string;
let equipamentoA: string;

function run<T>(work: () => Promise<T>): Promise<T> {
  return runWithContext({ origin: 'test' }, work);
}

beforeAll(async () => {
  await migrateTestDatabase();
});

afterAll(async () => {
  await closeTestDatabase();
});

beforeEach(async () => {
  await truncateAll();
  const planId = await seedCatalog();
  tenantA = await createTenantFixture('pdf-a', planId);
  tenantB = await createTenantFixture('pdf-b', planId);

  for (const t of [tenantA, tenantB]) {
    await run(() =>
      setTenantFeature(t.context, { featureKey: FEATURES.OPERATIONS_WARRANTIES, enabled: true }),
    );
  }
  tenantA.context = await contextFor(tenantA.tenantId, tenantA.adminUserId, tenantA.unitId);
  tenantB.context = await contextFor(tenantB.tenantId, tenantB.adminUserId, tenantB.unitId);

  clienteA = (
    await run(() =>
      createCustomer(tenantA.context, {
        kind: 'individual',
        name: 'João Gonçalves de Araújo',
        contacts: [{ type: 'phone', value: '11988887777', isWhatsapp: false }],
      }),
    )
  ).customerId;

  equipamentoA = (
    await run(() =>
      createEquipment(tenantA.context, {
        customerId: clienteA,
        kind: 'Receiver',
        brand: 'Yamaha',
        model: 'RX-V385',
        voltage: 'bivolt',
      }),
    )
  ).equipmentId;
});

async function osFinalizada(): Promise<string> {
  const criada = await run(() =>
    createServiceOrder(tenantA.context, {
      equipmentId: equipamentoA,
      customerReport: 'Nao liga.',
    }),
  );

  const caminho: Array<[ServiceOrderStatus, string | undefined]> = [
    ['awaiting_repair', undefined],
    ['repair_completed', undefined],
    ['awaiting_delivery_preparation', undefined],
    ['awaiting_customer_pickup', 'delivery_ready'],
    ['completed', undefined],
  ];
  for (const [to, via] of caminho) {
    await run(() =>
      transitionServiceOrder(tenantA.context, {
        serviceOrderId: criada.serviceOrderId,
        to,
        ...(via ? { via } : {}),
      }),
    );
  }
  return criada.serviceOrderId;
}

/** Nomes dos arquivos de certificado hoje no disco. */
async function arquivosDeCertificado(): Promise<string[]> {
  const raiz = join(process.cwd(), process.env.STORAGE_ROOT ?? 'storage', 'warranty-certificates');
  return readdir(raiz).catch(() => [] as string[]);
}

/** Emite garantia + certificado e devolve o id da garantia. */
async function comCertificado(overrides: Record<string, unknown> = {}): Promise<string> {
  const osId = await osFinalizada();
  const { warrantyId } = await run(() =>
    issueWarranty(tenantA.context, {
      type: 'internal',
      equipmentId: equipamentoA,
      serviceOrderId: osId,
      durationAmount: 90,
      durationUnit: 'days',
      coversWholeService: true,
      coverageItems: [{ kind: 'labor', description: 'Reparo da fonte de alimentação' }],
      exclusions: 'Mau uso, queda e líquido.',
      terms: 'Apresentar o certificado no balcão.',
      ...overrides,
    }),
  );
  await run(() => issueCertificate(tenantA.context, warrantyId));
  return warrantyId;
}

describe('geracao do PDF a partir do snapshot (itens 3, 9 e 58)', () => {
  it('produz um arquivo PDF de verdade, guardado e referenciado', async () => {
    const warrantyId = await comCertificado();
    const artefato = await run(() => ensureCertificatePdf(tenantA.context, warrantyId));

    expect(artefato.reused).toBe(false);
    expect(artefato.byteSize).toBeGreaterThan(1000);
    expect(artefato.pageCount).toBeGreaterThanOrEqual(1);
    expect(artefato.filename).toMatch(/^certificado-garantia-gar-\d+\.pdf$/);

    const bytes = await getFileStorage().read(artefato.storageKey);
    expect(hasPdfMagicBytes(bytes)).toBe(true);
  });

  it('o conteudo sai do snapshot: cliente, tipo, vigencia e cobertura', async () => {
    const warrantyId = await comCertificado();
    const { bytes } = await run(() => readCertificatePdf(tenantA.context, warrantyId));
    const { text } = await extractPdf(bytes);

    expect(text).toContain('Certificado de Garantia');
    expect(text).toContain('João Gonçalves de Araújo');
    expect(text).toContain('Reparo da fonte de alimentação');
    expect(text).toMatch(/GAR \d{6}/);
  });

  it('a chave de armazenamento NAO carrega PII nem numero legivel (itens 26 e 27)', async () => {
    const warrantyId = await comCertificado();
    const artefato = await run(() => ensureCertificatePdf(tenantA.context, warrantyId));

    expect(artefato.storageKey).toMatch(/^warranty-certificates\/[0-9a-f]+\.pdf$/);
    expect(artefato.storageKey).not.toContain('João');
    expect(artefato.storageKey).not.toContain(tenantA.tenantId);
    expect(artefato.storageKey).not.toContain(warrantyId);
  });

  it('registra metadados do arquivo sem confundir os dois checksums (item 22)', async () => {
    const warrantyId = await comCertificado();
    const artefato = await run(() => ensureCertificatePdf(tenantA.context, warrantyId));

    const [linha] = await getDb()
      .select()
      .from(warrantyCertificates)
      .where(eq(warrantyCertificates.warrantyId, warrantyId));

    expect(linha!.pdfMimeType).toBe('application/pdf');
    expect(linha!.pdfChecksum).toBe(artefato.checksum);
    expect(linha!.pdfSnapshotChecksum).toBe(linha!.checksum);
    /** Um prova o documento; o outro prova o arquivo. Nunca sao o mesmo. */
    expect(linha!.pdfChecksum).not.toBe(linha!.checksum);
    expect(linha!.pdfRenderer).toBeTruthy();
    expect(linha!.pdfGeneratedAt).toBeInstanceOf(Date);
  });

  it('garantia sem certificado emitido recusa com explicacao', async () => {
    const osId = await osFinalizada();
    const { warrantyId } = await run(() =>
      issueWarranty(tenantA.context, {
        type: 'internal',
        equipmentId: equipamentoA,
        serviceOrderId: osId,
        durationAmount: 30,
        durationUnit: 'days',
        coversWholeService: true,
        coverageItems: [{ kind: 'labor', description: 'Reparo' }],
      }),
    );

    await expect(
      run(() => ensureCertificatePdf(tenantA.context, warrantyId)),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('o snapshot e a autoridade (itens 3, 4, 63 e 64)', () => {
  it('ALTERAR A POLITICA depois nao muda o PDF ja gerado', async () => {
    const { policyId } = await run(() =>
      createWarrantyPolicy(tenantA.context, {
        name: 'Padrao de bancada',
        type: 'internal',
        durationAmount: 90,
        durationUnit: 'days',
        coverageSummary: 'Mao de obra do reparo.',
        exclusions: 'Texto ORIGINAL da politica.',
        terms: 'Termos ORIGINAIS da casa.',
      }),
    );

    const osId = await osFinalizada();
    const { warrantyId } = await run(() =>
      issueWarranty(tenantA.context, {
        type: 'internal',
        equipmentId: equipamentoA,
        serviceOrderId: osId,
        policyId,
        coversWholeService: true,
        coverageItems: [{ kind: 'labor', description: 'Reparo' }],
      }),
    );
    await run(() => issueCertificate(tenantA.context, warrantyId));
    const antes = await run(() => readCertificatePdf(tenantA.context, warrantyId));
    const textoAntes = (await extractPdf(antes.bytes)).text;
    expect(textoAntes).toContain('Termos ORIGINAIS da casa');

    await run(() =>
      updateWarrantyPolicy(tenantA.context, policyId, {
        name: 'Padrao de bancada',
        type: 'internal',
        durationAmount: 7,
        durationUnit: 'days',
        coverageSummary: 'REESCRITO',
        exclusions: 'REESCRITO',
        terms: 'TERMOS NOVOS, MUITO PIORES',
      }),
    );

    const depois = await run(() => readCertificatePdf(tenantA.context, warrantyId));
    const textoDepois = (await extractPdf(depois.bytes)).text;

    expect(textoDepois).toContain('Termos ORIGINAIS da casa');
    expect(textoDepois).not.toContain('TERMOS NOVOS');
    /** Byte a byte: nem o arquivo mudou. */
    expect(depois.bytes.equals(antes.bytes)).toBe(true);
  });

  it('ALTERAR O CLIENTE depois nao reescreve o documento historico', async () => {
    const warrantyId = await comCertificado();
    const antes = await run(() => readCertificatePdf(tenantA.context, warrantyId));
    expect((await extractPdf(antes.bytes)).text).toContain('João Gonçalves de Araújo');

    await getDb()
      .update(customers)
      .set({ name: 'Nome Completamente Diferente' })
      .where(eq(customers.id, clienteA));

    const depois = await run(() => readCertificatePdf(tenantA.context, warrantyId));
    const texto = (await extractPdf(depois.bytes)).text;

    expect(texto).toContain('João Gonçalves de Araújo');
    expect(texto).not.toContain('Nome Completamente Diferente');
  });

  it('certificado gerado ANTES do PDF existir gera arquivo sem reemitir a garantia (item 67)', async () => {
    const warrantyId = await comCertificado();

    /** Simula o estado anterior ao Prompt 13.1: certificado sem PDF. */
    await getDb()
      .update(warrantyCertificates)
      .set({
        pdfStorageKey: null,
        pdfChecksum: null,
        pdfSnapshotChecksum: null,
        pdfByteSize: null,
        pdfPageCount: null,
        pdfGeneratedAt: null,
        pdfRenderer: null,
      })
      .where(eq(warrantyCertificates.warrantyId, warrantyId));

    const [antes] = await getDb()
      .select()
      .from(warrantyCertificates)
      .where(eq(warrantyCertificates.warrantyId, warrantyId));

    const artefato = await run(() => ensureCertificatePdf(tenantA.context, warrantyId));
    expect(hasPdfMagicBytes(await getFileStorage().read(artefato.storageKey))).toBe(true);

    const [depois] = await getDb()
      .select()
      .from(warrantyCertificates)
      .where(eq(warrantyCertificates.warrantyId, warrantyId));

    /** Mesmo certificado, mesmo token, mesmo snapshot: nada foi reemitido. */
    expect(depois!.id).toBe(antes!.id);
    expect(depois!.token).toBe(antes!.token);
    expect(depois!.snapshot).toBe(antes!.snapshot);
    expect(depois!.checksum).toBe(antes!.checksum);
  });
});

describe('idempotencia e reaproveitamento (itens 24, 54 e 68)', () => {
  it('dez geracoes sequenciais produzem UM artefato logico', async () => {
    const warrantyId = await comCertificado();

    const primeiro = await run(() => ensureCertificatePdf(tenantA.context, warrantyId));
    const chaves = new Set<string>([primeiro.storageKey]);

    for (let i = 0; i < 9; i += 1) {
      const artefato = await run(() => ensureCertificatePdf(tenantA.context, warrantyId));
      expect(artefato.reused).toBe(true);
      chaves.add(artefato.storageKey);
    }

    expect(chaves.size).toBe(1);
  });

  it('o arquivo e REUTILIZADO, nao renderizado de novo a cada download', async () => {
    const warrantyId = await comCertificado();
    const primeiro = await run(() => ensureCertificatePdf(tenantA.context, warrantyId));
    const segundo = await run(() => ensureCertificatePdf(tenantA.context, warrantyId));

    expect(segundo.reused).toBe(true);
    expect(segundo.storageKey).toBe(primeiro.storageKey);
    expect(segundo.checksum).toBe(primeiro.checksum);
  });

  it('a linha do tempo registra a geracao UMA vez, nao a cada clique (item 50)', async () => {
    const warrantyId = await comCertificado();
    for (let i = 0; i < 5; i += 1) {
      await run(() => ensureCertificatePdf(tenantA.context, warrantyId));
    }

    const eventos = await getDb()
      .select()
      .from(warrantyTimeline)
      .where(eq(warrantyTimeline.warrantyId, warrantyId));

    const pdfGerado = eventos.filter((e) => e.kind === 'certificate_pdf_generated');
    expect(pdfGerado).toHaveLength(1);
  });

  it('a auditoria registra a geracao sem guardar conteudo do documento (item 49)', async () => {
    const warrantyId = await comCertificado();
    await run(() => ensureCertificatePdf(tenantA.context, warrantyId));

    const registros = await getDb()
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'warranty_certificate.pdf_generated'));

    expect(registros).toHaveLength(1);
    const depois = JSON.stringify(registros[0]!.after);
    expect(depois).toContain('pdfChecksum');
    expect(depois).not.toContain('João');
    expect(depois).not.toContain('Termos');
  });

  it('arquivo APAGADO do disco e regerado a partir do snapshot (item 37)', async () => {
    const warrantyId = await comCertificado();
    const primeiro = await run(() => ensureCertificatePdf(tenantA.context, warrantyId));

    await getFileStorage().remove(primeiro.storageKey);

    const segundo = await run(() => readCertificatePdf(tenantA.context, warrantyId));
    expect(hasPdfMagicBytes(segundo.bytes)).toBe(true);
    /** Mesmo snapshot, mesmos bytes: o documento nao mudou ao ser refeito. */
    expect(segundo.checksum).toBe(primeiro.checksum);
  });

  it('arquivo CORROMPIDO no disco e detectado pelo checksum e regerado (item 38)', async () => {
    const warrantyId = await comCertificado();
    const primeiro = await run(() => ensureCertificatePdf(tenantA.context, warrantyId));

    /** Troca o conteudo por HTML mantendo a chave: o pior caso possivel. */
    const storage = getFileStorage();
    await storage.remove(primeiro.storageKey);
    const falso = await storage.save({
      data: Buffer.from('<html>nao sou um pdf</html>'),
      extension: 'pdf',
      scope: 'warranty-certificates',
    });
    await getDb()
      .update(warrantyCertificates)
      .set({ pdfStorageKey: falso.key })
      .where(eq(warrantyCertificates.warrantyId, warrantyId));

    const recuperado = await run(() => readCertificatePdf(tenantA.context, warrantyId));
    expect(hasPdfMagicBytes(recuperado.bytes)).toBe(true);
    expect(recuperado.checksum).toBe(primeiro.checksum);
  });
});

describe('autorizacao do download (itens 30, 32, 33 e 66)', () => {
  it('o tenant B nao gera nem baixa o PDF da garantia do A', async () => {
    const warrantyId = await comCertificado();

    await expect(
      run(() => ensureCertificatePdf(tenantB.context, warrantyId)),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(run(() => readCertificatePdf(tenantB.context, warrantyId))).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('sem a feature de Garantias, o download e recusado', async () => {
    const warrantyId = await comCertificado();

    await run(() =>
      setTenantFeature(tenantA.context, {
        featureKey: FEATURES.OPERATIONS_WARRANTIES,
        enabled: false,
      }),
    );
    const semFeature = await contextFor(tenantA.tenantId, tenantA.adminUserId, tenantA.unitId);

    await expect(run(() => readCertificatePdf(semFeature, warrantyId))).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it('sem permissao de ver garantias, o download e recusado', async () => {
    const warrantyId = await comCertificado();

    await clearTenantRoles(tenantA.adminUserId);
    const semPapel = await contextFor(tenantA.tenantId, tenantA.adminUserId, tenantA.unitId);

    await expect(run(() => readCertificatePdf(semPapel, warrantyId))).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it('garantia revogada continua tendo certificado baixavel: o historico nao some', async () => {
    const warrantyId = await comCertificado();
    await run(() => ensureCertificatePdf(tenantA.context, warrantyId));
    await run(() =>
      revokeWarranty(tenantA.context, warrantyId, 'Lacre rompido por terceiro, conforme laudo.'),
    );

    const pdf = await run(() => readCertificatePdf(tenantA.context, warrantyId));
    expect(hasPdfMagicBytes(pdf.bytes)).toBe(true);
  });
});

describe('concorrencia real em MariaDB (itens 55, 56 e 69)', () => {
  /**
   * UM ARTEFATO LOGICO, SEMPRE.
   *
   * Cinco pessoas clicando "Baixar PDF" no mesmo segundo nao podem produzir
   * cinco arquivos. Como a renderizacao e deterministica, todas produzem os
   * MESMOS bytes; o compare-and-swap escolhe um vencedor e os demais apagam o
   * proprio arquivo. O que se prova aqui e o resultado no banco e no disco —
   * nao a intencao do codigo.
   */
  it('cinco geracoes SIMULTANEAS produzem UMA chave, e todas recebem referencia valida', async () => {
    const warrantyId = await comCertificado();

    const resultados = await Promise.allSettled(
      Array.from({ length: 5 }, () => run(() => ensureCertificatePdf(tenantA.context, warrantyId))),
    );

    const ok = resultados.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    expect(ok).toHaveLength(5);

    /** O banco guarda UMA chave, e todas as respostas apontam para ela. */
    const [linha] = await getDb()
      .select()
      .from(warrantyCertificates)
      .where(eq(warrantyCertificates.warrantyId, warrantyId));

    const chaves = new Set(ok.map((r) => r.storageKey));
    expect(chaves.size).toBe(1);
    expect([...chaves][0]).toBe(linha!.pdfStorageKey);

    /** Todas as respostas descrevem o mesmo documento. */
    expect(new Set(ok.map((r) => r.checksum)).size).toBe(1);
  });

  it('nenhum arquivo orfao sobra no disco depois da disputa', async () => {
    const warrantyId = await comCertificado();

    /**
     * A comparacao e ANTES x DEPOIS, nao o total do diretorio: a limpeza
     * entre testes zera o banco, nao o disco, e contar tudo mediria os
     * arquivos dos outros testes em vez desta disputa.
     */
    const antes = await arquivosDeCertificado();

    await Promise.allSettled(
      Array.from({ length: 5 }, () => run(() => ensureCertificatePdf(tenantA.context, warrantyId))),
    );

    const depois = await arquivosDeCertificado();
    const novos = depois.filter((nome) => !antes.includes(nome));

    const [linha] = await getDb()
      .select()
      .from(warrantyCertificates)
      .where(eq(warrantyCertificates.warrantyId, warrantyId));

    /** Cinco chamadas, UM arquivo — e e exatamente o que o banco referencia. */
    expect(novos).toHaveLength(1);
    expect(linha!.pdfStorageKey).toContain(novos[0]!);
  });

  it('a linha do tempo nao duplica quando cinco chamadas correm juntas', async () => {
    const warrantyId = await comCertificado();

    await Promise.allSettled(
      Array.from({ length: 5 }, () => run(() => ensureCertificatePdf(tenantA.context, warrantyId))),
    );

    const eventos = await getDb()
      .select()
      .from(warrantyTimeline)
      .where(eq(warrantyTimeline.warrantyId, warrantyId));

    expect(eventos.filter((e) => e.kind === 'certificate_pdf_generated')).toHaveLength(1);
  });

  it('cinco DOWNLOADS simultaneos entregam o mesmo arquivo, todos validos', async () => {
    const warrantyId = await comCertificado();

    const resultados = await Promise.all(
      Array.from({ length: 5 }, () => run(() => readCertificatePdf(tenantA.context, warrantyId))),
    );

    for (const r of resultados) expect(hasPdfMagicBytes(r.bytes)).toBe(true);
    expect(new Set(resultados.map((r) => r.checksum)).size).toBe(1);
    expect(new Set(resultados.map((r) => r.bytes.toString('base64'))).size).toBe(1);
  });
});
