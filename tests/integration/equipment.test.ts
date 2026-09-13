import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { runWithContext } from '@/core/context/request-context';
import { getDb } from '@/core/db/client';
import { NotFoundError, ValidationError } from '@/core/errors';
import { setFileStorageForTesting } from '@/core/storage/file-storage';
import { auditLogs } from '@/modules/audit/infrastructure/schema';
import { createCustomer } from '@/modules/customers/application/customer-service';
import {
  createEquipment,
  setEquipmentStatus,
  updateEquipment,
} from '@/modules/equipment/application/equipment-service';
import {
  findEquipmentDetail,
  findSimilarEquipment,
  listEquipment,
  listIntakes,
} from '@/modules/equipment/application/equipment-queries';
import { createIntake } from '@/modules/equipment/application/intake-service';
import { attachMedia, readMedia, removeMedia } from '@/modules/equipment/application/media-service';
import { equipment, equipmentMedia } from '@/modules/equipment/infrastructure/schema';
import { closeTestDatabase, migrateTestDatabase, truncateAll } from '../helpers/database';
import { InMemoryStorage, makeJpeg } from '../helpers/fake-storage';
import {
  createTenantFixture,
  createUnit,
  seedCatalog,
  type TenantFixture,
} from '../helpers/fixtures';

/**
 * EQUIPAMENTOS E RECEBIMENTO (Prompt 06, itens 105 a 109).
 *
 * O foco e a divisao de ownership: equipamento e do TENANT, recebimento e da
 * UNIDADE. Tudo mais depende disso estar certo.
 */

let tenantA: TenantFixture;
let tenantB: TenantFixture;
let clienteA: string;
let clienteB: string;
let storage: InMemoryStorage;

const run = <T>(work: () => Promise<T>) => runWithContext({ origin: 'test' }, work);

/** Concatena mensagem e causas de um erro, para inspecionar o motivo real. */
function causesOf(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    const candidate = current as { message?: string; code?: string; cause?: unknown };
    if (candidate.message) parts.push(candidate.message);
    if (candidate.code) parts.push(candidate.code);
    current = candidate.cause;
  }
  return parts.join(' | ');
}

const clienteBase = {
  kind: 'individual' as const,
  name: 'Dono do Aparelho',
  contacts: [{ type: 'phone' as const, value: '11988887777', isWhatsapp: false }],
};

function equipamento(overrides: Record<string, unknown> = {}) {
  return {
    customerId: clienteA,
    kind: 'Receiver',
    brand: 'Yamaha',
    model: 'RX-V385',
    serial: 'Y12345678',
    voltage: 'bivolt',
    ...overrides,
  };
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
  tenantA = await createTenantFixture('equip-a', planId);
  tenantB = await createTenantFixture('equip-b', planId);

  clienteA = (await run(() => createCustomer(tenantA.context, clienteBase))).customerId;
  clienteB = (await run(() => createCustomer(tenantB.context, clienteBase))).customerId;

  storage = new InMemoryStorage();
  setFileStorageForTesting(storage);
});

afterEach(() => {
  setFileStorageForTesting(null);
});

describe('cadastro de equipamento (itens 4, 9 e 56)', () => {
  it('cria com identificacao completa', async () => {
    const { equipmentId } = await run(() => createEquipment(tenantA.context, equipamento()));

    const detail = await findEquipmentDetail(tenantA.context, equipmentId);
    expect(detail?.equipment.brand).toBe('Yamaha');
    expect(detail?.equipment.serialNormalized).toBe('Y12345678');
    expect(detail?.equipment.voltage).toBe('bivolt');
    expect(detail?.customer?.id).toBe(clienteA);
  });

  it('EQUIPAMENTO SEM SERIAL e aceito — etiqueta ilegivel e rotina (item 56)', async () => {
    const { equipmentId } = await run(() =>
      createEquipment(tenantA.context, equipamento({ serial: '', brand: '', model: '' })),
    );

    const detail = await findEquipmentDetail(tenantA.context, equipmentId);
    expect(detail?.equipment.serial).toBeNull();
    expect(detail?.equipment.serialNormalized).toBeNull();
    // Nao inventa serial nenhum.
    expect(detail?.equipment.kind).toBe('Receiver');
  });

  it('so o tipo e obrigatorio', async () => {
    await expect(
      run(() => createEquipment(tenantA.context, equipamento({ kind: '' }))),
    ).rejects.toThrow(/tipo do equipamento/i);
  });

  it('recusa cliente de OUTRO tenant', async () => {
    await expect(
      run(() => createEquipment(tenantA.context, equipamento({ customerId: clienteB }))),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('grava a unidade ativa como procedencia, nao como dono', async () => {
    const { equipmentId } = await run(() => createEquipment(tenantA.context, equipamento()));
    const detail = await findEquipmentDetail(tenantA.context, equipmentId);
    expect(detail?.equipment.originUnitId).toBe(tenantA.context.activeUnitId);
  });
});

describe('FK composta cliente x tenant (item 103 — obrigatorio)', () => {
  it('o BANCO recusa equipamento do tenant A apontando para cliente do tenant B', async () => {
    const db = getDb();

    // SQL direto, ignorando toda a aplicacao: e o banco que precisa recusar.
    const tentativa = db.execute(sql`
      INSERT INTO equipment
        (id, tenant_id, customer_id, kind, kind_normalized, voltage, status, created_at, updated_at)
      VALUES
        (${'11111111-1111-7111-8111-111111111111'}, ${tenantA.tenantId}, ${clienteB},
         'TV', 'tv', 'unknown', 'active', NOW(3), NOW(3))
    `);

    /**
     * O Drizzle embrulha o erro do driver em "Failed query", entao a mensagem
     * do topo nao traz o codigo. A verificacao percorre a cadeia de causas ate
     * achar o ER_NO_REFERENCED_ROW do InnoDB — que e a prova de que quem
     * recusou foi o BANCO, e nao a aplicacao.
     */
    const erro = await tentativa.then(
      () => null,
      (caught: unknown) => caught,
    );

    expect(erro, 'o banco precisava recusar esta insercao').not.toBeNull();
    expect(causesOf(erro)).toMatch(/foreign key|1452|ER_NO_REFERENCED_ROW/i);
  });
});

describe('edicao (itens 64 e 65)', () => {
  it('corrige a identificacao', async () => {
    const { equipmentId } = await run(() => createEquipment(tenantA.context, equipamento()));

    await run(() =>
      updateEquipment(
        tenantA.context,
        equipmentId,
        equipamento({ model: 'RX-V485', voltage: 'v220' }),
      ),
    );

    const detail = await findEquipmentDetail(tenantA.context, equipmentId);
    expect(detail?.equipment.model).toBe('RX-V485');
    expect(detail?.equipment.voltage).toBe('v220');
  });

  it('BLOQUEIA a transferencia para outro cliente (item 65)', async () => {
    const outroCliente = (
      await run(() => createCustomer(tenantA.context, { ...clienteBase, name: 'Outro Dono' }))
    ).customerId;

    const { equipmentId } = await run(() => createEquipment(tenantA.context, equipamento()));

    await expect(
      run(() =>
        updateEquipment(tenantA.context, equipmentId, equipamento({ customerId: outroCliente })),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('equipamento de outro tenant nao e editavel nem com o ID em maos', async () => {
    const { equipmentId } = await run(() => createEquipment(tenantA.context, equipamento()));

    await expect(
      run(() =>
        updateEquipment(tenantB.context, equipmentId, equipamento({ customerId: clienteB })),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('inativa e reativa sem apagar', async () => {
    const { equipmentId } = await run(() => createEquipment(tenantA.context, equipamento()));

    await run(() => setEquipmentStatus(tenantA.context, equipmentId, 'inactive'));
    expect((await findEquipmentDetail(tenantA.context, equipmentId))?.equipment.status).toBe(
      'inactive',
    );

    await run(() => setEquipmentStatus(tenantA.context, equipmentId, 'active'));
    const rows = await getDb().select().from(equipment).where(eq(equipment.id, equipmentId));
    expect(rows).toHaveLength(1);
  });
});

describe('duplicidade avisa, nunca bloqueia (item 55)', () => {
  it('encontra parecidos pelo serial', async () => {
    await run(() => createEquipment(tenantA.context, equipamento()));

    const parecidos = await findSimilarEquipment(tenantA.context, {
      customerId: clienteA,
      serial: 'y-1234 5678',
    });

    expect(parecidos).toHaveLength(1);
  });

  it('mas o cadastro do segundo aparelho PASSA', async () => {
    await run(() => createEquipment(tenantA.context, equipamento()));
    const segundo = await run(() => createEquipment(tenantA.context, equipamento()));
    expect(segundo.equipmentId).toBeTruthy();
  });

  it('nunca revela equipamento de outro tenant', async () => {
    await run(() => createEquipment(tenantA.context, equipamento()));

    const parecidos = await findSimilarEquipment(tenantB.context, {
      customerId: clienteB,
      serial: 'Y12345678',
    });
    expect(parecidos).toHaveLength(0);
  });
});

describe('recebimento e da UNIDADE (itens 6, 67 e 108)', () => {
  it('registra a unidade ATIVA, nunca uma vinda da entrada', async () => {
    const { equipmentId } = await run(() => createEquipment(tenantA.context, equipamento()));

    const { intakeId } = await run(() =>
      createIntake(tenantA.context, {
        equipmentId,
        powerCable: 'yes',
        accessories: [{ label: 'Controle remoto', quantity: 1 }],
        conditions: [{ key: 'scratches', note: 'na tampa' }],
        inspectionNotes: 'Aparelho empoeirado.',
      }),
    );

    const detail = await findEquipmentDetail(tenantA.context, equipmentId);
    const intake = detail?.intakes.find((item) => item.intake.id === intakeId);

    expect(intake?.intake.unitId).toBe(tenantA.context.activeUnitId);
    expect(intake?.accessories).toHaveLength(1);
    expect(intake?.conditions).toHaveLength(1);
    expect(intake?.intake.powerCable).toBe('yes');
  });

  it('SEM UNIDADE ATIVA o recebimento e recusado com explicacao', async () => {
    const { equipmentId } = await run(() => createEquipment(tenantA.context, equipamento()));
    const semUnidade = { ...tenantA.context, activeUnitId: null };

    await expect(
      run(() => createIntake(semUnidade, { equipmentId, accessories: [], conditions: [] })),
    ).rejects.toThrow(/unidade/i);
  });

  it('descarta condicao que nao existe no catalogo', async () => {
    const { equipmentId } = await run(() => createEquipment(tenantA.context, equipamento()));

    const { intakeId } = await run(() =>
      createIntake(tenantA.context, {
        equipmentId,
        accessories: [],
        conditions: [
          { key: 'placa_queimada', note: '' },
          { key: 'dents', note: '' },
        ],
      }),
    );

    const detail = await findEquipmentDetail(tenantA.context, equipmentId);
    const intake = detail?.intakes.find((item) => item.intake.id === intakeId);
    expect(intake?.conditions.map((c) => c.conditionKey)).toEqual(['dents']);
  });

  it('O MESMO EQUIPAMENTO ACUMULA RECEBIMENTOS — nada e sobrescrito (item 8)', async () => {
    const { equipmentId } = await run(() => createEquipment(tenantA.context, equipamento()));

    await run(() =>
      createIntake(tenantA.context, { equipmentId, accessories: [], conditions: [] }),
    );
    await run(() =>
      createIntake(tenantA.context, { equipmentId, accessories: [], conditions: [] }),
    );

    const detail = await findEquipmentDetail(tenantA.context, equipmentId);
    expect(detail?.intakes).toHaveLength(2);
  });

  it('recebimento em OUTRA unidade do mesmo tenant fica com a unidade dele', async () => {
    const unidade2 = await createUnit(tenantA.tenantId, 'Unidade Norte');
    const { equipmentId } = await run(() => createEquipment(tenantA.context, equipamento()));

    await run(() =>
      createIntake(tenantA.context, { equipmentId, accessories: [], conditions: [] }),
    );
    await run(() =>
      createIntake(
        { ...tenantA.context, activeUnitId: unidade2 },
        { equipmentId, accessories: [], conditions: [] },
      ),
    );

    const detail = await findEquipmentDetail(tenantA.context, equipmentId);
    const unidades = detail?.intakes.map((item) => item.intake.unitId) ?? [];
    expect(new Set(unidades).size).toBe(2);
  });

  it('a LISTA de recebimentos e da unidade ativa — trocar de unidade muda o que aparece', async () => {
    const unidade2 = await createUnit(tenantA.tenantId, 'Unidade Sul');
    const { equipmentId } = await run(() => createEquipment(tenantA.context, equipamento()));

    await run(() =>
      createIntake(tenantA.context, { equipmentId, accessories: [], conditions: [] }),
    );

    const naUnidade1 = await listIntakes(tenantA.context);
    const naUnidade2 = await listIntakes({ ...tenantA.context, activeUnitId: unidade2 });

    expect(naUnidade1.total).toBe(1);
    expect(naUnidade2.total).toBe(0);
  });

  it('o EQUIPAMENTO continua visivel em qualquer unidade — ele e do tenant (item 68)', async () => {
    const unidade2 = await createUnit(tenantA.tenantId, 'Unidade Leste');
    const { equipmentId } = await run(() => createEquipment(tenantA.context, equipamento()));

    const daUnidade2 = await findEquipmentDetail(
      { ...tenantA.context, activeUnitId: unidade2 },
      equipmentId,
    );
    expect(daUnidade2?.equipment.id).toBe(equipmentId);

    const lista = await listEquipment({ ...tenantA.context, activeUnitId: unidade2 }, {});
    expect(lista.items.map((item) => item.id)).toContain(equipmentId);
  });

  it('recebimento nao aceita equipamento de outro tenant', async () => {
    const { equipmentId } = await run(() => createEquipment(tenantA.context, equipamento()));

    await expect(
      run(() => createIntake(tenantB.context, { equipmentId, accessories: [], conditions: [] })),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('isolamento entre tenants (item 107)', () => {
  it('a listagem de um tenant nunca mostra equipamento do outro', async () => {
    await run(() => createEquipment(tenantA.context, equipamento()));

    expect((await listEquipment(tenantB.context, {})).total).toBe(0);
  });

  it('a ficha por ID conhecido de outro tenant devolve nada', async () => {
    const { equipmentId } = await run(() => createEquipment(tenantA.context, equipamento()));
    expect(await findEquipmentDetail(tenantB.context, equipmentId)).toBeNull();
  });

  it('a busca por serial nao atravessa tenant', async () => {
    await run(() => createEquipment(tenantA.context, equipamento()));
    expect((await listEquipment(tenantB.context, { query: 'Y12345678' })).total).toBe(0);
  });
});

describe('busca (item 53)', () => {
  it('encontra por marca, modelo, tipo e serial em qualquer formato', async () => {
    await run(() => createEquipment(tenantA.context, equipamento()));

    for (const termo of ['yamaha', 'RX-V385', 'receiver', 'y-1234 5678', 'Y12345678']) {
      const page = await listEquipment(tenantA.context, { query: termo });
      expect(page.total, `busca por ${termo}`).toBe(1);
    }
  });

  it('pagina no servidor com ordenacao deterministica', async () => {
    for (let index = 0; index < 3; index += 1) {
      await run(() =>
        createEquipment(
          tenantA.context,
          equipamento({ serial: `SERIE${index}`, model: `M${index}` }),
        ),
      );
    }

    const primeira = await listEquipment(tenantA.context, { pageSize: 2, page: 1 });
    const segunda = await listEquipment(tenantA.context, { pageSize: 2, page: 2 });

    expect(primeira.items).toHaveLength(2);
    expect(segunda.items).toHaveLength(1);
    const ids = [...primeira.items, ...segunda.items].map((item) => item.id);
    expect(new Set(ids).size).toBe(3);
  });
});

describe('fotos (itens 28, 29 e 109)', () => {
  it('anexa foto guardando METADADOS no banco e bytes no storage', async () => {
    const { equipmentId } = await run(() => createEquipment(tenantA.context, equipamento()));

    const { mediaId } = await run(() =>
      attachMedia(tenantA.context, {
        equipmentId,
        kind: 'label',
        data: makeJpeg(60, 40),
        originalName: 'etiqueta.jpg',
      }),
    );

    const [row] = await getDb().select().from(equipmentMedia).where(eq(equipmentMedia.id, mediaId));

    expect(row?.mimeType).toBe('image/jpeg');
    expect(row?.width).toBe(60);
    expect(row?.height).toBe(40);
    expect(row?.kind).toBe('label');
    expect(row?.checksum).toHaveLength(64);
    // O binario NAO fica no banco.
    expect(Object.values(row ?? {}).some((value) => Buffer.isBuffer(value))).toBe(false);
    expect(storage.files.size).toBe(1);
  });

  it('RECUSA arquivo que so parece imagem pelo nome', async () => {
    const { equipmentId } = await run(() => createEquipment(tenantA.context, equipamento()));

    await expect(
      run(() =>
        attachMedia(tenantA.context, {
          equipmentId,
          kind: 'general',
          data: Buffer.from('<?php system($_GET["c"]); ?>'),
          originalName: 'foto.jpg',
        }),
      ),
    ).rejects.toThrow(/nao reconhecido como imagem/i);
  });

  it('recusa arquivo acima do limite', async () => {
    const { equipmentId } = await run(() => createEquipment(tenantA.context, equipamento()));
    const enorme = Buffer.alloc(9 * 1024 * 1024);
    Buffer.from([0xff, 0xd8, 0xff]).copy(enorme, 0);

    await expect(
      run(() => attachMedia(tenantA.context, { equipmentId, kind: 'general', data: enorme })),
    ).rejects.toThrow(/8 MB/i);
  });

  it('a CHAVE do arquivo e gerada pelo servidor — nome malicioso nao vira caminho', async () => {
    const { equipmentId } = await run(() => createEquipment(tenantA.context, equipamento()));

    const { mediaId } = await run(() =>
      attachMedia(tenantA.context, {
        equipmentId,
        kind: 'general',
        data: makeJpeg(),
        originalName: '../../../etc/passwd',
      }),
    );

    const [row] = await getDb().select().from(equipmentMedia).where(eq(equipmentMedia.id, mediaId));
    expect(row?.storageKey).not.toContain('..');
    expect(row?.storageKey).not.toContain('passwd');
    expect(row?.storageKey).toContain(tenantA.tenantId);
  });

  it('midia de OUTRO tenant nao e legivel nem com o ID em maos (item 109)', async () => {
    const { equipmentId } = await run(() => createEquipment(tenantA.context, equipamento()));
    const { mediaId } = await run(() =>
      attachMedia(tenantA.context, { equipmentId, kind: 'general', data: makeJpeg() }),
    );

    expect(await readMedia(tenantB.context, mediaId)).toBeNull();
    await expect(run(() => removeMedia(tenantB.context, mediaId))).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('foto nao pode ser anexada a equipamento de outro tenant', async () => {
    const { equipmentId } = await run(() => createEquipment(tenantA.context, equipamento()));

    await expect(
      run(() => attachMedia(tenantB.context, { equipmentId, kind: 'general', data: makeJpeg() })),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('remove a foto do banco e do storage', async () => {
    const { equipmentId } = await run(() => createEquipment(tenantA.context, equipamento()));
    const { mediaId } = await run(() =>
      attachMedia(tenantA.context, { equipmentId, kind: 'general', data: makeJpeg() }),
    );

    await run(() => removeMedia(tenantA.context, mediaId));

    expect(await readMedia(tenantA.context, mediaId)).toBeNull();
    expect(storage.files.size).toBe(0);
  });

  it('foto do recebimento SOBREVIVE a edicao do equipamento (item 63)', async () => {
    const { equipmentId } = await run(() => createEquipment(tenantA.context, equipamento()));
    const { intakeId } = await run(() =>
      createIntake(tenantA.context, { equipmentId, accessories: [], conditions: [] }),
    );
    const { mediaId } = await run(() =>
      attachMedia(tenantA.context, { equipmentId, intakeId, kind: 'damage', data: makeJpeg() }),
    );

    await run(() =>
      updateEquipment(tenantA.context, equipmentId, equipamento({ model: 'OUTRO MODELO' })),
    );

    const media = await readMedia(tenantA.context, mediaId);
    expect(media).not.toBeNull();
  });
});

describe('auditoria e eventos (itens 75 a 77)', () => {
  it('registra criacao de equipamento, recebimento e foto', async () => {
    const { equipmentId } = await run(() => createEquipment(tenantA.context, equipamento()));
    await run(() =>
      createIntake(tenantA.context, { equipmentId, accessories: [], conditions: [] }),
    );
    await run(() =>
      attachMedia(tenantA.context, { equipmentId, kind: 'general', data: makeJpeg() }),
    );

    const rows = await getDb().select().from(auditLogs);
    const acoes = rows.map((row) => row.action);

    expect(acoes).toContain('equipment.created');
    expect(acoes).toContain('equipment_intake.created');
    expect(acoes).toContain('equipment_media.added');
  });

  it('a auditoria da foto guarda METADADO, nunca o binario (item 76)', async () => {
    const { equipmentId } = await run(() => createEquipment(tenantA.context, equipamento()));
    await run(() =>
      attachMedia(tenantA.context, { equipmentId, kind: 'general', data: makeJpeg() }),
    );

    const rows = await getDb()
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'equipment_media.added'));

    const serializado = JSON.stringify(rows);
    expect(serializado).toContain('byteSize');
    expect(serializado).toContain('image/jpeg');
    // Nada de base64 nem de conteudo de arquivo.
    expect(serializado).not.toContain('storageKey');
    expect(serializado.length).toBeLessThan(4000);
  });
});
