import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { runWithContext } from '@/core/context/request-context';
import { getDb } from '@/core/db/client';
import { ConflictError, NotFoundError, ValidationError } from '@/core/errors';
import {
  createCustomer,
  findByDocument,
  setCustomerStatus,
  updateCustomer,
} from '@/modules/customers/application/customer-service';
import {
  findCustomerDetail,
  findSimilarByContact,
  listCustomers,
} from '@/modules/customers/application/customer-queries';
import {
  customerAddresses,
  customerContacts,
  customers,
} from '@/modules/customers/infrastructure/schema';
import { auditLogs } from '@/modules/audit/infrastructure/schema';
import { closeTestDatabase, migrateTestDatabase, truncateAll } from '../helpers/database';
import { formatCnpj, formatCpf, makeCnpj, makeCpf } from '../helpers/fake-documents';
import {
  createTenantFixture,
  createUnit,
  seedCatalog,
  type TenantFixture,
} from '../helpers/fixtures';

/**
 * CLIENTES — regras de dominio (Prompt 05, itens 57, 59, 62, 85 a 88).
 */

let tenantA: TenantFixture;
let tenantB: TenantFixture;

const CPF = makeCpf('529982247');
const OUTRO_CPF = makeCpf('111222333');
const CNPJ = makeCnpj('112223330001');

/** Entrada minima de PF: nome + um contato. Nada mais e exigido (item 6). */
function pessoaFisica(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'individual',
    name: 'Joao da Silva',
    contacts: [{ type: 'phone', value: '(11) 98888-7777', isWhatsapp: true, label: 'Celular' }],
    ...overrides,
  };
}

function pessoaJuridica(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'company',
    name: 'ZE ALIMENTOS LTDA',
    tradeName: 'Padaria do Ze',
    contacts: [{ type: 'email', value: 'contato@padaria.invalid', isWhatsapp: false }],
    ...overrides,
  };
}

const run = <T>(work: () => Promise<T>) => runWithContext({ origin: 'test' }, work);

beforeAll(async () => {
  await migrateTestDatabase();
});

afterAll(async () => {
  await closeTestDatabase();
});

beforeEach(async () => {
  await truncateAll();
  const planId = await seedCatalog();
  tenantA = await createTenantFixture('clientes-a', planId);
  tenantB = await createTenantFixture('clientes-b', planId);
});

describe('criacao (itens 5, 6 e 7)', () => {
  it('cria pessoa fisica com o minimo: nome e um contato', async () => {
    const { customerId } = await run(() => createCustomer(tenantA.context, pessoaFisica()));

    const detail = await findCustomerDetail(tenantA.context, customerId);
    expect(detail?.customer.kind).toBe('individual');
    expect(detail?.customer.name).toBe('Joao da Silva');
    expect(detail?.customer.status).toBe('active');
    expect(detail?.contacts).toHaveLength(1);
  });

  it('cria pessoa juridica com razao social e fantasia', async () => {
    const { customerId } = await run(() => createCustomer(tenantA.context, pessoaJuridica()));

    const detail = await findCustomerDetail(tenantA.context, customerId);
    expect(detail?.customer.kind).toBe('company');
    expect(detail?.customer.tradeName).toBe('Padaria do Ze');
  });

  it('CLIENTE SEM DOCUMENTO e aceito — e o caso mais comum no balcao (item 85)', async () => {
    const { customerId } = await run(() => createCustomer(tenantA.context, pessoaFisica()));

    const detail = await findCustomerDetail(tenantA.context, customerId);
    expect(detail?.customer.documentDigits).toBeNull();
    expect(detail?.customer.documentType).toBeNull();
  });

  it('varios clientes sem documento convivem — o UNIQUE nao atrapalha (item 9)', async () => {
    await run(() => createCustomer(tenantA.context, pessoaFisica({ name: 'Sem Documento Um' })));
    await run(() => createCustomer(tenantA.context, pessoaFisica({ name: 'Sem Documento Dois' })));
    await run(() => createCustomer(tenantA.context, pessoaFisica({ name: 'Sem Documento Tres' })));

    const page = await listCustomers(tenantA.context, {});
    expect(page.total).toBe(3);
  });

  it('CLIENTE SEM E-MAIL e aceito quando ha telefone (item 86)', async () => {
    const { customerId } = await run(() => createCustomer(tenantA.context, pessoaFisica()));
    const detail = await findCustomerDetail(tenantA.context, customerId);
    expect(detail?.contacts[0]?.type).toBe('phone');
  });

  it('CLIENTE SEM TELEFONE e aceito quando ha e-mail (item 87)', async () => {
    const { customerId } = await run(() =>
      createCustomer(
        tenantA.context,
        pessoaFisica({
          contacts: [{ type: 'email', value: 'so@email.invalid', isWhatsapp: false }],
        }),
      ),
    );
    const detail = await findCustomerDetail(tenantA.context, customerId);
    expect(detail?.contacts[0]?.type).toBe('email');
  });

  it('CLIENTE SEM NENHUM CONTATO e recusado, com mensagem que explica (item 88)', async () => {
    await expect(
      run(() => createCustomer(tenantA.context, pessoaFisica({ contacts: [] }))),
    ).rejects.toThrow(/pelo menos um telefone, WhatsApp ou e-mail/i);
  });

  it('grava a unidade ativa como PROCEDENCIA, nao como dono', async () => {
    const { customerId } = await run(() => createCustomer(tenantA.context, pessoaFisica()));
    const detail = await findCustomerDetail(tenantA.context, customerId);
    expect(detail?.customer.originUnitId).toBe(tenantA.context.activeUnitId);
  });
});

describe('documento (itens 8 e 20)', () => {
  it('aceita CPF valido e o grava so com digitos', async () => {
    const { customerId } = await run(() =>
      createCustomer(tenantA.context, pessoaFisica({ document: formatCpf(CPF) })),
    );

    const detail = await findCustomerDetail(tenantA.context, customerId);
    expect(detail?.customer.documentDigits).toBe(CPF);
    expect(detail?.customer.documentType).toBe('cpf');
  });

  it('recusa CPF invalido com mensagem especifica', async () => {
    await expect(
      run(() => createCustomer(tenantA.context, pessoaFisica({ document: '111.111.111-11' }))),
    ).rejects.toThrow(/CPF invalido/i);
  });

  it('aceita CNPJ valido', async () => {
    const { customerId } = await run(() =>
      createCustomer(tenantA.context, pessoaJuridica({ document: formatCnpj(CNPJ) })),
    );
    const detail = await findCustomerDetail(tenantA.context, customerId);
    expect(detail?.customer.documentDigits).toBe(CNPJ);
  });

  it('recusa CNPJ invalido', async () => {
    await expect(
      run(() =>
        createCustomer(tenantA.context, pessoaJuridica({ document: '11.111.111/1111-11' })),
      ),
    ).rejects.toThrow(/CNPJ invalido/i);
  });

  it('recusa CPF em PJ e CNPJ em PF — o tipo manda (item 7)', async () => {
    await expect(
      run(() => createCustomer(tenantA.context, pessoaJuridica({ document: formatCpf(CPF) }))),
    ).rejects.toThrow(/CNPJ deve ter 14 digitos/i);

    await expect(
      run(() => createCustomer(tenantA.context, pessoaFisica({ document: formatCnpj(CNPJ) }))),
    ).rejects.toThrow(/CPF deve ter 11 digitos/i);
  });

  it('BLOQUEIA documento duplicado no mesmo tenant', async () => {
    await run(() => createCustomer(tenantA.context, pessoaFisica({ document: CPF })));

    await expect(
      run(() =>
        createCustomer(tenantA.context, pessoaFisica({ name: 'Outro Joao', document: CPF })),
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('bloqueia mesmo quando o segundo cadastro vem FORMATADO', async () => {
    await run(() => createCustomer(tenantA.context, pessoaFisica({ document: CPF })));

    await expect(
      run(() =>
        createCustomer(
          tenantA.context,
          pessoaFisica({ name: 'Terceiro', document: formatCpf(CPF) }),
        ),
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('O MESMO DOCUMENTO PODE EXISTIR EM TENANTS DIFERENTES', async () => {
    await run(() => createCustomer(tenantA.context, pessoaFisica({ document: CPF })));

    // A mesma pessoa e cliente de duas assistencias diferentes: normal num SaaS.
    const outro = await run(() => createCustomer(tenantB.context, pessoaFisica({ document: CPF })));
    expect(outro.customerId).toBeTruthy();
  });

  it('a corrida entre dois cadastros simultaneos e barrada pelo banco (item 53)', async () => {
    const resultados = await Promise.allSettled([
      run(() =>
        createCustomer(tenantA.context, pessoaFisica({ name: 'Simultaneo A', document: CPF })),
      ),
      run(() =>
        createCustomer(tenantA.context, pessoaFisica({ name: 'Simultaneo B', document: CPF })),
      ),
    ]);

    const aceitos = resultados.filter((r) => r.status === 'fulfilled');
    expect(aceitos).toHaveLength(1);

    const page = await listCustomers(tenantA.context, { query: CPF });
    expect(page.total).toBe(1);
  });

  it('findByDocument encontra dentro do tenant e ignora o proprio cliente', async () => {
    const { customerId } = await run(() =>
      createCustomer(tenantA.context, pessoaFisica({ document: CPF })),
    );

    expect(await findByDocument(tenantA.context, formatCpf(CPF))).toMatchObject({ id: customerId });
    expect(await findByDocument(tenantA.context, CPF, customerId)).toBeNull();
    // Nunca enxerga o cliente de outra empresa.
    expect(await findByDocument(tenantB.context, CPF)).toBeNull();
  });
});

describe('contatos (itens 10 a 14)', () => {
  it('aceita varios contatos e elege o primeiro como principal', async () => {
    const { customerId } = await run(() =>
      createCustomer(
        tenantA.context,
        pessoaFisica({
          contacts: [
            { type: 'phone', value: '(11) 98888-7777', isWhatsapp: true, label: 'Celular' },
            { type: 'phone', value: '(11) 3333-4444', isWhatsapp: false, label: 'Comercial' },
            { type: 'email', value: 'Joao@Empresa.COM', isWhatsapp: false },
          ],
        }),
      ),
    );

    const detail = await findCustomerDetail(tenantA.context, customerId);
    expect(detail?.contacts).toHaveLength(3);

    const principais = detail?.contacts.filter((c) => c.isPrimary) ?? [];
    expect(principais).toHaveLength(1);
    expect(principais[0]?.label).toBe('Celular');
  });

  it('normaliza telefone para digitos e e-mail para minusculas', async () => {
    const { customerId } = await run(() =>
      createCustomer(
        tenantA.context,
        pessoaFisica({
          contacts: [
            { type: 'phone', value: '(11) 98888-7777', isWhatsapp: false },
            { type: 'email', value: '  Joao@Empresa.COM  ', isWhatsapp: false },
          ],
        }),
      ),
    );

    const detail = await findCustomerDetail(tenantA.context, customerId);
    const phone = detail?.contacts.find((c) => c.type === 'phone');
    const email = detail?.contacts.find((c) => c.type === 'email');

    expect(phone?.valueNormalized).toBe('11988887777');
    expect(email?.valueNormalized).toBe('joao@empresa.com');
    // O valor de exibicao preserva o que a pessoa digitou.
    expect(phone?.value).toBe('(11) 98888-7777');
  });

  it('WhatsApp e caracteristica do telefone, nao um segundo contato (item 13)', async () => {
    const { customerId } = await run(() =>
      createCustomer(
        tenantA.context,
        pessoaFisica({
          contacts: [{ type: 'phone', value: '11988887777', isWhatsapp: true }],
        }),
      ),
    );

    const detail = await findCustomerDetail(tenantA.context, customerId);
    expect(detail?.contacts).toHaveLength(1);
    expect(detail?.contacts[0]?.isWhatsapp).toBe(true);
  });

  it('descarta contato repetido no mesmo envio', async () => {
    const { customerId } = await run(() =>
      createCustomer(
        tenantA.context,
        pessoaFisica({
          contacts: [
            { type: 'phone', value: '(11) 98888-7777', isWhatsapp: false },
            { type: 'phone', value: '11988887777', isWhatsapp: false },
          ],
        }),
      ),
    );

    const detail = await findCustomerDetail(tenantA.context, customerId);
    expect(detail?.contacts).toHaveLength(1);
  });

  it('recusa telefone e e-mail invalidos com mensagem propria', async () => {
    await expect(
      run(() =>
        createCustomer(
          tenantA.context,
          pessoaFisica({ contacts: [{ type: 'phone', value: '123', isWhatsapp: false }] }),
        ),
      ),
    ).rejects.toThrow(/Telefone invalido/i);

    await expect(
      run(() =>
        createCustomer(
          tenantA.context,
          pessoaFisica({ contacts: [{ type: 'email', value: 'nao-e-email', isWhatsapp: false }] }),
        ),
      ),
    ).rejects.toThrow(/E-mail invalido/i);
  });

  it('telefone repetido entre clientes e AVISO, nunca bloqueio (itens 20 e 89)', async () => {
    await run(() =>
      createCustomer(
        tenantA.context,
        pessoaFisica({
          name: 'Maria Souza',
          contacts: [{ type: 'phone', value: '11988887777', isWhatsapp: false }],
        }),
      ),
    );

    // Casal usando o mesmo celular: o segundo cadastro PASSA.
    const segundo = await run(() =>
      createCustomer(
        tenantA.context,
        pessoaFisica({
          name: 'Jose Souza',
          contacts: [{ type: 'phone', value: '11988887777', isWhatsapp: false }],
        }),
      ),
    );
    expect(segundo.customerId).toBeTruthy();

    const semelhantes = await findSimilarByContact(tenantA.context, ['11988887777']);
    expect(semelhantes.length).toBe(2);
  });

  it('semelhantes nunca vazam cliente de outro tenant', async () => {
    await run(() =>
      createCustomer(
        tenantB.context,
        pessoaFisica({
          name: 'Cliente do Tenant B',
          contacts: [{ type: 'phone', value: '11988887777', isWhatsapp: false }],
        }),
      ),
    );

    expect(await findSimilarByContact(tenantA.context, ['11988887777'])).toHaveLength(0);
  });
});

describe('endereco (item 15)', () => {
  it('grava endereco quando informado', async () => {
    const { customerId } = await run(() =>
      createCustomer(
        tenantA.context,
        pessoaFisica({
          address: {
            zipCode: '01310-100',
            street: 'Avenida Paulista',
            number: '1000',
            district: 'Bela Vista',
            city: 'Sao Paulo',
            state: 'sp',
          },
        }),
      ),
    );

    const detail = await findCustomerDetail(tenantA.context, customerId);
    expect(detail?.addresses).toHaveLength(1);
    expect(detail?.addresses[0]?.zipCode).toBe('01310100');
    expect(detail?.addresses[0]?.state).toBe('SP');
  });

  it('nao cria endereco vazio quando nenhum campo foi preenchido', async () => {
    const { customerId } = await run(() =>
      createCustomer(
        tenantA.context,
        pessoaFisica({ address: { zipCode: '', street: '', city: '' } }),
      ),
    );

    const detail = await findCustomerDetail(tenantA.context, customerId);
    expect(detail?.addresses).toHaveLength(0);
  });
});

describe('edicao (item 33)', () => {
  it('atualiza cadastro e substitui contatos', async () => {
    const { customerId } = await run(() => createCustomer(tenantA.context, pessoaFisica()));

    await run(() =>
      updateCustomer(
        tenantA.context,
        customerId,
        pessoaFisica({
          name: 'Joao da Silva Junior',
          contacts: [{ type: 'email', value: 'novo@email.invalid', isWhatsapp: false }],
        }),
      ),
    );

    const detail = await findCustomerDetail(tenantA.context, customerId);
    expect(detail?.customer.name).toBe('Joao da Silva Junior');
    expect(detail?.contacts).toHaveLength(1);
    expect(detail?.contacts[0]?.type).toBe('email');
  });

  it('BLOQUEIA a troca de PF para PJ, com explicacao', async () => {
    const { customerId } = await run(() => createCustomer(tenantA.context, pessoaFisica()));

    await expect(
      run(() => updateCustomer(tenantA.context, customerId, pessoaJuridica())),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('impede assumir documento que ja pertence a outro cliente do tenant', async () => {
    await run(() => createCustomer(tenantA.context, pessoaFisica({ document: CPF })));
    const { customerId } = await run(() =>
      createCustomer(tenantA.context, pessoaFisica({ name: 'Outro', document: OUTRO_CPF })),
    );

    await expect(
      run(() => updateCustomer(tenantA.context, customerId, pessoaFisica({ document: CPF }))),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('permite manter o proprio documento ao editar', async () => {
    const { customerId } = await run(() =>
      createCustomer(tenantA.context, pessoaFisica({ document: CPF })),
    );

    await run(() =>
      updateCustomer(
        tenantA.context,
        customerId,
        pessoaFisica({ name: 'Nome Novo', document: CPF }),
      ),
    );

    const detail = await findCustomerDetail(tenantA.context, customerId);
    expect(detail?.customer.name).toBe('Nome Novo');
  });

  it('cliente de outro tenant nao pode ser editado nem por ID conhecido', async () => {
    const { customerId } = await run(() => createCustomer(tenantA.context, pessoaFisica()));

    await expect(
      run(() => updateCustomer(tenantB.context, customerId, pessoaFisica({ name: 'Invadido' }))),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('situacao (itens 18 e 19)', () => {
  it('inativa e reativa preservando o cadastro', async () => {
    const { customerId } = await run(() => createCustomer(tenantA.context, pessoaFisica()));

    await run(() => setCustomerStatus(tenantA.context, customerId, 'inactive'));
    expect((await findCustomerDetail(tenantA.context, customerId))?.customer.status).toBe(
      'inactive',
    );

    await run(() => setCustomerStatus(tenantA.context, customerId, 'active'));
    const detail = await findCustomerDetail(tenantA.context, customerId);
    expect(detail?.customer.status).toBe('active');
    // O cadastro e os contatos sobreviveram aos dois ciclos.
    expect(detail?.contacts).toHaveLength(1);
  });

  it('inativar nao apaga linha nenhuma', async () => {
    const { customerId } = await run(() => createCustomer(tenantA.context, pessoaFisica()));
    await run(() => setCustomerStatus(tenantA.context, customerId, 'inactive'));

    const db = getDb();
    const rows = await db.select().from(customers).where(eq(customers.id, customerId));
    expect(rows).toHaveLength(1);
  });

  it('e idempotente', async () => {
    const { customerId } = await run(() => createCustomer(tenantA.context, pessoaFisica()));
    await run(() => setCustomerStatus(tenantA.context, customerId, 'inactive'));
    await run(() => setCustomerStatus(tenantA.context, customerId, 'inactive'));
    expect((await findCustomerDetail(tenantA.context, customerId))?.customer.status).toBe(
      'inactive',
    );
  });

  it('nao altera cliente de outro tenant', async () => {
    const { customerId } = await run(() => createCustomer(tenantA.context, pessoaFisica()));

    await expect(
      run(() => setCustomerStatus(tenantB.context, customerId, 'inactive')),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('isolamento entre tenants (item 58)', () => {
  it('a listagem de um tenant nunca mostra cliente do outro', async () => {
    await run(() => createCustomer(tenantA.context, pessoaFisica({ name: 'Cliente do A' })));
    await run(() => createCustomer(tenantB.context, pessoaFisica({ name: 'Cliente do B' })));

    const pageA = await listCustomers(tenantA.context, {});
    const pageB = await listCustomers(tenantB.context, {});

    expect(pageA.items.map((c) => c.name)).toEqual(['Cliente do A']);
    expect(pageB.items.map((c) => c.name)).toEqual(['Cliente do B']);
  });

  it('a ficha por ID conhecido de outro tenant devolve nada', async () => {
    const { customerId } = await run(() => createCustomer(tenantA.context, pessoaFisica()));
    expect(await findCustomerDetail(tenantB.context, customerId)).toBeNull();
  });

  it('a busca de um tenant nao encontra dado do outro nem por documento exato', async () => {
    await run(() => createCustomer(tenantA.context, pessoaFisica({ document: CPF })));
    const page = await listCustomers(tenantB.context, { query: CPF });
    expect(page.total).toBe(0);
  });
});

describe('MULTIUNIDADE — cliente pertence ao tenant (itens 2 e 59)', () => {
  it('cliente cadastrado na unidade 1 continua acessivel na unidade 2', async () => {
    // Tenant A com duas unidades; a fixture ja criou a primeira.
    const unidade2 = await createUnit(tenantA.tenantId, 'Unidade Norte');

    const { customerId } = await run(() =>
      createCustomer(tenantA.context, pessoaFisica({ name: 'Cliente da Unidade 1' })),
    );

    // Mesmo tenant, outra unidade ativa.
    const contextoUnidade2 = { ...tenantA.context, activeUnitId: unidade2 };

    const detail = await findCustomerDetail(contextoUnidade2, customerId);
    expect(detail?.customer.name).toBe('Cliente da Unidade 1');

    const page = await listCustomers(contextoUnidade2, {});
    expect(page.items.map((c) => c.id)).toContain(customerId);
  });

  it('a unidade de origem NAO filtra a listagem', async () => {
    const unidade2 = await createUnit(tenantA.tenantId, 'Unidade Sul');

    await run(() =>
      createCustomer(tenantA.context, pessoaFisica({ name: 'Nascido na Unidade 1' })),
    );
    await run(() =>
      createCustomer(
        { ...tenantA.context, activeUnitId: unidade2 },
        pessoaFisica({ name: 'Nascido na Unidade 2' }),
      ),
    );

    // As duas unidades enxergam os dois clientes.
    const daUnidade1 = await listCustomers(tenantA.context, {});
    const daUnidade2 = await listCustomers({ ...tenantA.context, activeUnitId: unidade2 }, {});

    expect(daUnidade1.total).toBe(2);
    expect(daUnidade2.total).toBe(2);
  });

  it('trocar de unidade nao altera o resultado da busca', async () => {
    const unidade2 = await createUnit(tenantA.tenantId, 'Unidade Leste');
    await run(() => createCustomer(tenantA.context, pessoaFisica({ document: CPF })));

    const encontrado1 = await listCustomers(tenantA.context, { query: formatCpf(CPF) });
    const encontrado2 = await listCustomers(
      { ...tenantA.context, activeUnitId: unidade2 },
      { query: formatCpf(CPF) },
    );

    expect(encontrado1.total).toBe(1);
    expect(encontrado2.total).toBe(1);
  });
});

describe('auditoria (item 48)', () => {
  it('registra criacao, atualizacao e mudanca de situacao', async () => {
    const { customerId } = await run(() => createCustomer(tenantA.context, pessoaFisica()));
    await run(() =>
      updateCustomer(tenantA.context, customerId, pessoaFisica({ name: 'Outro Nome' })),
    );
    await run(() => setCustomerStatus(tenantA.context, customerId, 'inactive'));

    const db = getDb();
    const rows = await db.select().from(auditLogs).where(eq(auditLogs.entityId, customerId));
    const acoes = rows.map((row) => row.action);

    expect(acoes).toContain('customer.created');
    expect(acoes).toContain('customer.updated');
    expect(acoes).toContain('customer.deactivated');
  });

  it('registra a troca de documento em trilha propria', async () => {
    const { customerId } = await run(() => createCustomer(tenantA.context, pessoaFisica()));
    await run(() => updateCustomer(tenantA.context, customerId, pessoaFisica({ document: CPF })));

    const db = getDb();
    const rows = await db.select().from(auditLogs).where(eq(auditLogs.entityId, customerId));
    expect(rows.map((r) => r.action)).toContain('customer.document_changed');
  });

  it('NAO copia CPF, telefone nem e-mail para a auditoria (item 48)', async () => {
    const { customerId } = await run(() =>
      createCustomer(
        tenantA.context,
        pessoaFisica({
          document: CPF,
          contacts: [{ type: 'email', value: 'segredo@cliente.invalid', isWhatsapp: false }],
        }),
      ),
    );

    const db = getDb();
    const rows = await db.select().from(auditLogs).where(eq(auditLogs.entityId, customerId));
    const serializado = JSON.stringify(rows);

    expect(serializado).not.toContain(CPF);
    expect(serializado).not.toContain('segredo@cliente.invalid');
    expect(serializado).not.toContain('98888');
    // Ainda assim guarda o suficiente para rastrear.
    expect(serializado).toContain('hasDocument');
  });
});

describe('cascata e integridade', () => {
  it('contatos e enderecos pertencem ao mesmo tenant do cliente', async () => {
    const { customerId } = await run(() =>
      createCustomer(
        tenantA.context,
        pessoaFisica({ address: { city: 'Sao Paulo', state: 'SP' } }),
      ),
    );

    const db = getDb();
    const [contato] = await db
      .select()
      .from(customerContacts)
      .where(eq(customerContacts.customerId, customerId));
    const [endereco] = await db
      .select()
      .from(customerAddresses)
      .where(eq(customerAddresses.customerId, customerId));

    expect(contato?.tenantId).toBe(tenantA.tenantId);
    expect(endereco?.tenantId).toBe(tenantA.tenantId);
  });
});
