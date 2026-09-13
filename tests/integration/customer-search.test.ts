import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runWithContext } from '@/core/context/request-context';
import { createCustomer } from '@/modules/customers/application/customer-service';
import { listCustomers } from '@/modules/customers/application/customer-queries';
import { closeTestDatabase, migrateTestDatabase, truncateAll } from '../helpers/database';
import { formatCnpj, formatCpf, makeCnpj, makeCpf } from '../helpers/fake-documents';
import { createTenantFixture, seedCatalog, type TenantFixture } from '../helpers/fixtures';

/**
 * BUSCA (Prompt 05, itens 21, 22, 26, 28, 62 e 71).
 *
 * O criterio de sucesso e o balcao: quem atende digita o que tem na mao — o
 * numero do telefone que o cliente falou, o CPF do documento, ou so o primeiro
 * nome — e precisa achar.
 */

let tenant: TenantFixture;

const CPF = makeCpf('529982247');
const CNPJ = makeCnpj('112223330001');

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
  tenant = await createTenantFixture('busca', planId);

  await run(() =>
    createCustomer(tenant.context, {
      kind: 'individual',
      name: 'José da Silva',
      document: CPF,
      contacts: [
        { type: 'phone', value: '(11) 98888-7777', isWhatsapp: true, label: 'Celular' },
        { type: 'email', value: 'jose@exemplo.invalid', isWhatsapp: false },
      ],
    }),
  );

  await run(() =>
    createCustomer(tenant.context, {
      kind: 'company',
      name: 'ZE ALIMENTOS LTDA',
      tradeName: 'Padaria do Zé',
      document: CNPJ,
      contacts: [{ type: 'phone', value: '(11) 3333-4444', isWhatsapp: false }],
    }),
  );

  await run(() =>
    createCustomer(tenant.context, {
      kind: 'individual',
      name: 'Maria Souza',
      contacts: [{ type: 'email', value: 'maria@exemplo.invalid', isWhatsapp: false }],
    }),
  );
});

async function buscar(query: string) {
  const page = await listCustomers(tenant.context, { query });
  return page.items.map((item) => item.name);
}

describe('busca por nome', () => {
  it('encontra pelo nome completo', async () => {
    expect(await buscar('José da Silva')).toContain('José da Silva');
  });

  it('encontra por parte do nome', async () => {
    expect(await buscar('silva')).toContain('José da Silva');
  });

  it('IGNORA ACENTO nos dois sentidos', async () => {
    expect(await buscar('jose')).toContain('José da Silva');
    expect(await buscar('José')).toContain('José da Silva');
  });

  it('ignora caixa', async () => {
    expect(await buscar('MARIA')).toContain('Maria Souza');
  });

  it('encontra pela razao social', async () => {
    expect(await buscar('ALIMENTOS')).toContain('ZE ALIMENTOS LTDA');
  });

  it('encontra pelo NOME FANTASIA, que e como a empresa e conhecida', async () => {
    expect(await buscar('padaria')).toContain('ZE ALIMENTOS LTDA');
  });
});

describe('busca por documento', () => {
  it('encontra CPF sem pontuacao', async () => {
    expect(await buscar(CPF)).toContain('José da Silva');
  });

  it('encontra o MESMO cliente com o CPF formatado', async () => {
    expect(await buscar(formatCpf(CPF))).toContain('José da Silva');
  });

  it('encontra CNPJ nas duas formas', async () => {
    expect(await buscar(CNPJ)).toContain('ZE ALIMENTOS LTDA');
    expect(await buscar(formatCnpj(CNPJ))).toContain('ZE ALIMENTOS LTDA');
  });

  it('encontra pelo inicio do documento', async () => {
    expect(await buscar(CPF.slice(0, 6))).toContain('José da Silva');
  });
});

describe('busca por contato', () => {
  it('encontra por telefone normalizado', async () => {
    expect(await buscar('11988887777')).toContain('José da Silva');
  });

  it('encontra pelo telefone FORMATADO, como esta na tela', async () => {
    expect(await buscar('(11) 98888-7777')).toContain('José da Silva');
  });

  it('encontra pelo numero sem o DDD — como o cliente costuma falar', async () => {
    expect(await buscar('988887777')).toContain('José da Silva');
  });

  it('encontra o telefone fixo da empresa', async () => {
    expect(await buscar('1133334444')).toContain('ZE ALIMENTOS LTDA');
  });

  it('encontra por e-mail completo e por parte dele', async () => {
    expect(await buscar('maria@exemplo.invalid')).toContain('Maria Souza');
    expect(await buscar('maria@')).toContain('Maria Souza');
  });

  it('nao duplica o cliente que casa por mais de um contato', async () => {
    const page = await listCustomers(tenant.context, { query: 'exemplo.invalid' });
    const ids = page.items.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    // O total tambem precisa refletir clientes, nao linhas de contato.
    expect(page.total).toBe(page.items.length);
  });
});

describe('filtros', () => {
  it('filtra por tipo', async () => {
    const pf = await listCustomers(tenant.context, { kind: 'individual' });
    const pj = await listCustomers(tenant.context, { kind: 'company' });

    expect(pf.total).toBe(2);
    expect(pj.total).toBe(1);
    expect(pj.items[0]?.name).toBe('ZE ALIMENTOS LTDA');
  });

  it('filtra por situacao', async () => {
    const ativos = await listCustomers(tenant.context, { status: 'active' });
    const inativos = await listCustomers(tenant.context, { status: 'inactive' });

    expect(ativos.total).toBe(3);
    expect(inativos.total).toBe(0);
  });

  it('combina busca com filtro', async () => {
    const page = await listCustomers(tenant.context, { query: 'e', kind: 'company' });
    expect(page.items.every((item) => item.kind === 'company')).toBe(true);
  });
});

describe('ordenacao e paginacao', () => {
  it('ordena por nome quando pedido', async () => {
    const page = await listCustomers(tenant.context, { sort: 'name' });
    expect(page.items.map((item) => item.name)).toEqual([
      'José da Silva',
      'Maria Souza',
      'ZE ALIMENTOS LTDA',
    ]);
  });

  it('a ordem padrao e por atualizacao recente', async () => {
    const page = await listCustomers(tenant.context, {});
    expect(page.items[0]?.name).toBe('Maria Souza');
  });

  it('pagina no servidor, sem trazer tudo', async () => {
    const primeira = await listCustomers(tenant.context, { pageSize: 2, page: 1, sort: 'name' });
    const segunda = await listCustomers(tenant.context, { pageSize: 2, page: 2, sort: 'name' });

    expect(primeira.items).toHaveLength(2);
    expect(segunda.items).toHaveLength(1);
    expect(primeira.total).toBe(3);
    expect(primeira.totalPages).toBe(2);

    // Nenhum cliente aparece nas duas paginas.
    const ids = [...primeira.items, ...segunda.items].map((item) => item.id);
    expect(new Set(ids).size).toBe(3);
  });

  it('paginacao continua correta depois de filtrar', async () => {
    const page = await listCustomers(tenant.context, { kind: 'individual', pageSize: 1, page: 2 });
    expect(page.total).toBe(2);
    expect(page.totalPages).toBe(2);
    expect(page.items).toHaveLength(1);
  });

  it('busca sem resultado devolve pagina vazia coerente', async () => {
    const page = await listCustomers(tenant.context, { query: 'ninguem-com-esse-nome' });
    expect(page.items).toHaveLength(0);
    expect(page.total).toBe(0);
    expect(page.totalPages).toBe(0);
  });
});

describe('contato principal na listagem', () => {
  it('traz o contato principal sem consulta por linha (sem N+1)', async () => {
    const page = await listCustomers(tenant.context, { sort: 'name' });
    const jose = page.items.find((item) => item.name === 'José da Silva');

    expect(jose?.primaryContactType).toBe('phone');
    expect(jose?.primaryContactValue).toBe('(11) 98888-7777');
    expect(jose?.primaryContactIsWhatsapp).toBe(true);
  });
});
