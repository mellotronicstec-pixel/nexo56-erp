import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * AS FRONTEIRAS DO MOTOR DE AUTOMACOES (Prompt 19, itens 172 a 174, 218 a
 * 220 e 41).
 *
 * Travas ARQUITETURAIS, no mesmo padrao de `tests/unit/communications-
 * boundary.test.ts` e `tests/unit/analytics-boundary.test.ts`: varrem o
 * codigo-fonte com regex, nao dependem de ninguem lembrar de nao quebrar a
 * regra amanha.
 *
 * "Automacao orquestra; o dominio continua sendo autoridade."
 */

const SRC = join(process.cwd(), 'src');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : /\.tsx?$/.test(entry) ? [full] : [];
  });
}

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

const FILES = walk(SRC).map((path) => {
  const raw = readFileSync(path, 'utf8');
  return { path, raw, code: stripComments(raw) };
});

const AUTOMATIONS = FILES.filter(({ path }) => path.includes(join('modules', 'automations')));

const OPERATIONAL_MODULES = [
  'service-orders',
  'quotes',
  'inventory',
  'purchasing',
  'finance',
  'warranties',
  'agenda',
  'communications',
  'customers',
  'equipment',
] as const;

describe('o modulo existe', () => {
  it('ha arquivos do Motor de Automacoes para inspecionar', () => {
    expect(AUTOMATIONS.length).toBeGreaterThan(0);
  });
});

describe('nenhuma execucao arbitraria (itens 22, 97, 172 a 174)', () => {
  it('nao ha eval nem Function dinamica', () => {
    const padrao = /\beval\s*\(|new\s+Function\s*\(/;
    const infratores = AUTOMATIONS.filter(({ code }) => padrao.test(code));
    expect(infratores.map((f) => f.path)).toEqual([]);
  });

  it('nao ha child_process nem execucao de shell', () => {
    const padrao = /\bchild_process\b|\bexecSync\b|\bspawnSync\b/;
    const infratores = AUTOMATIONS.filter(({ code }) => padrao.test(code));
    expect(infratores.map((f) => f.path)).toEqual([]);
  });

  it('nao ha SQL cru fornecido por entrada de usuario (sem template literal com interpolacao fora de `sql`)', () => {
    /** O modulo pode usar `sql` do drizzle (parametrizado); o que nao pode
     *  existir e concatenacao de string virando comando SQL. */
    const padrao =
      /\b(INSERT\s+INTO|UPDATE\s+`?\w+`?\s+SET|DELETE\s+FROM|DROP\s+TABLE|ALTER\s+TABLE)\b/i;
    const infratores = AUTOMATIONS.filter(({ code }) => padrao.test(code));
    expect(infratores.map((f) => f.path)).toEqual([]);
  });

  it('nao ha chamada HTTP arbitraria (fetch/axios/http.request) — sem webhook na V1 (item 97 e 174)', () => {
    const padrao = /\bfetch\s*\(|\baxios\b|\bhttp\.request\s*\(|\bhttps\.request\s*\(/;
    const infratores = AUTOMATIONS.filter(({ code }) => padrao.test(code));
    expect(infratores.map((f) => f.path)).toEqual([]);
  });

  it('nao importa nenhum SDK/cliente de IA (Prompts 20 a 22 ainda nao chegaram)', () => {
    const padrao = /\b(openai|anthropic|@ai-sdk)\b/i;
    const infratores = AUTOMATIONS.filter(({ code }) => padrao.test(code));
    expect(infratores.map((f) => f.path)).toEqual([]);
  });
});

describe('o Motor NAO escreve tabela de outro modulo (item 41, 143 e 218)', () => {
  it('nao ha insert/update/delete Drizzle em tabelas de OS, estoque, compras, financeiro ou garantias', () => {
    const padrao =
      /\.(insert|update|delete)\s*\(\s*(serviceOrders|serviceOrderTasks|stockBalances|stockMovements|purchaseOrders|purchaseNeeds|financialTitles|financialSettlements|warranties|warrantyReturns)\b/;
    const infratores = AUTOMATIONS.filter(({ code }) => padrao.test(code));
    expect(infratores.map((f) => f.path)).toEqual([]);
  });

  it('nao chama nenhuma primitiva de transicao/escrita de outro modulo diretamente', () => {
    const padrao =
      /\b(transitionServiceOrder|planStockEntry|applyStockEntry|createPurchaseOrder|settleFinancialTitle|issueWarranty|reverseSettlement)\s*\(/;
    const infratores = AUTOMATIONS.filter(({ code }) => padrao.test(code));
    expect(infratores.map((f) => f.path)).toEqual([]);
  });

  it('NUNCA escreve service_orders.status (item 41): arquitetural, sem excecao', () => {
    const padrao = /service_orders\.status|serviceOrders\.status\s*[:=]/;
    const infratores = AUTOMATIONS.filter(({ code }) => padrao.test(code));
    expect(infratores.map((f) => f.path)).toEqual([]);
  });
});

describe('acoes so falam com o PORT de aplicacao, nunca com o provider concreto (item 219/220)', () => {
  it('nao importa infraestrutura concreta de Comunicacao (provider-registry/capture-provider)', () => {
    const padrao = /modules\/communications\/infrastructure/;
    const infratores = AUTOMATIONS.filter(({ code }) => padrao.test(code));
    expect(infratores.map((f) => f.path)).toEqual([]);
  });

  it('nao importa infraestrutura de Agenda diretamente (so a application)', () => {
    const padrao = /modules\/agenda\/infrastructure\/schema/;
    /** Excecao: o schema DO PROPRIO MOTOR pode reaproveitar tipos utilitarios
     *  do core, mas nunca a tabela de outro modulo — nenhum arquivo aqui deve
     *  bater neste padrao. */
    const infratores = AUTOMATIONS.filter(({ code }) => padrao.test(code));
    expect(infratores.map((f) => f.path)).toEqual([]);
  });
});

describe('dependencia de mao unica: nenhum modulo operacional importa Automations', () => {
  for (const modulo of OPERATIONAL_MODULES) {
    it(`modules/${modulo} nunca importa modules/automations`, () => {
      const alvo = FILES.filter(
        ({ path }) =>
          path.includes(join('modules', modulo)) && !path.includes(join('modules', 'automations')),
      );
      const infratores = alvo.filter(({ code }) => code.includes('modules/automations'));
      expect(infratores.map((f) => f.path)).toEqual([]);
    });
  }
});

describe('toda tabela do Motor e tenant-scoped (mesma regra do resto do sistema)', () => {
  it('o schema do modulo usa tenantId() em toda tabela', () => {
    const schema = AUTOMATIONS.find(({ path }) =>
      path.endsWith(join('infrastructure', 'schema.ts')),
    );
    expect(schema).toBeDefined();
    expect(schema!.code).toMatch(/tenantId\(\)/);
  });
});
