import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * AS FRONTEIRAS DO NEXO56 AI (Prompt 20, itens 86 a 90, 176).
 *
 * Travas ARQUITETURAIS, no mesmo padrao de
 * `tests/unit/automations-boundary.test.ts`: varrem o codigo-fonte com
 * regex, nao dependem de ninguem lembrar de nao quebrar a regra amanha.
 *
 * "Nexo56 AI sugere; o humano decide." — nunca escreve domínio, nunca
 * substitui a autoridade dos módulos operacionais.
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

const AI_MODULE = FILES.filter(({ path }) => path.includes(join('modules', 'ai')));

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
  'automations',
  'portal',
] as const;

describe('o modulo existe', () => {
  it('ha arquivos do Nexo56 AI para inspecionar', () => {
    expect(AI_MODULE.length).toBeGreaterThan(0);
  });
});

describe('nenhuma execucao arbitraria', () => {
  it('nao ha eval nem Function dinamica', () => {
    const padrao = /\beval\s*\(|new\s+Function\s*\(/;
    const infratores = AI_MODULE.filter(({ code }) => padrao.test(code));
    expect(infratores.map((f) => f.path)).toEqual([]);
  });

  it('nao ha child_process nem execucao de shell', () => {
    const padrao = /\bchild_process\b|\bexecSync\b|\bspawnSync\b/;
    const infratores = AI_MODULE.filter(({ code }) => padrao.test(code));
    expect(infratores.map((f) => f.path)).toEqual([]);
  });

  it('nao ha chamada HTTP arbitraria (fetch/axios/http.request) — o provedor de captura nao usa rede', () => {
    const padrao = /\bfetch\s*\(|\baxios\b|\bhttp\.request\s*\(|\bhttps\.request\s*\(/;
    const infratores = AI_MODULE.filter(({ code }) => padrao.test(code));
    expect(infratores.map((f) => f.path)).toEqual([]);
  });

  it('nao importa nenhum SDK/cliente de IA (nenhum vendor foi decidido — item 35)', () => {
    const padrao = /\b(openai|anthropic|@ai-sdk|@google\/generative-ai)\b/i;
    const infratores = AI_MODULE.filter(({ code }) => padrao.test(code));
    expect(infratores.map((f) => f.path)).toEqual([]);
  });
});

describe('o Nexo56 AI NAO escreve tabela de outro modulo (itens 88, 176)', () => {
  it('nao ha insert/update/delete Drizzle em tabelas de OS, orcamento, comunicacao, estoque, compras, financeiro, garantias ou agenda', () => {
    const padrao =
      /\.(insert|update|delete)\s*\(\s*(serviceOrders|serviceOrderTasks|serviceOrderTimeline|quotes|quoteItems|communicationMessages|stockBalances|stockMovements|purchaseOrders|purchaseNeeds|financialTitles|financialSettlements|financialMovements|warranties|warrantyReturns|agendaTasks)\b/;
    const infratores = AI_MODULE.filter(({ code }) => padrao.test(code));
    expect(infratores.map((f) => f.path)).toEqual([]);
  });

  it('so importa infraestrutura (schema/tabela concreta) de tenancy e users, para as FKs da propria tabela', () => {
    const padrao = /from\s+'@\/modules\/([a-z-]+)\/infrastructure/g;
    const permitido = new Set(['ai', 'tenancy', 'users']);
    for (const { path, code } of AI_MODULE) {
      const matches = [...code.matchAll(padrao)];
      for (const match of matches) {
        expect(permitido.has(match[1]!), `${path} importa infraestrutura de ${match[1]}`).toBe(
          true,
        );
      }
    }
  });

  it('nao chama nenhuma primitiva de transicao/escrita de outro modulo diretamente', () => {
    const padrao =
      /\b(transitionServiceOrder|planStockEntry|applyStockEntry|createPurchaseOrder|settleFinancialTitle|issueWarranty|reverseSettlement|createMessageFromAutomation|createTaskFromAutomation)\s*\(/;
    const infratores = AI_MODULE.filter(({ code }) => padrao.test(code));
    expect(infratores.map((f) => f.path)).toEqual([]);
  });

  it('NUNCA escreve service_orders.status ou quotes.status (arquitetural, sem excecao)', () => {
    const padrao = /service_orders\.status|serviceOrders\.status\s*[:=]|quotes\.status\s*[:=]/;
    const infratores = AI_MODULE.filter(({ code }) => padrao.test(code));
    expect(infratores.map((f) => f.path)).toEqual([]);
  });
});

describe('leitura de entidade so via camada de aplicacao (application), nunca infrastructure alheia', () => {
  it('nao importa service-orders/infrastructure nem quotes/infrastructure', () => {
    const padrao = /modules\/(service-orders|quotes)\/infrastructure/;
    const infratores = AI_MODULE.filter(({ code }) => padrao.test(code));
    expect(infratores.map((f) => f.path)).toEqual([]);
  });
});

describe('dependencia de mao unica: nenhum modulo operacional importa Nexo56 AI', () => {
  for (const modulo of OPERATIONAL_MODULES) {
    it(`modules/${modulo} nunca importa modules/ai`, () => {
      const alvo = FILES.filter(
        ({ path }) =>
          path.includes(join('modules', modulo)) && !path.includes(join('modules', 'ai')),
      );
      const infratores = alvo.filter(({ code }) => code.includes('modules/ai/'));
      expect(infratores.map((f) => f.path)).toEqual([]);
    });
  }
});

describe('Motor de Automacoes nao ganhou nenhuma acao de IA neste prompt (item 89)', () => {
  it('o catalogo de acoes de automations nao referencia o Nexo56 AI', () => {
    const automationsCatalog = FILES.filter(
      ({ path }) => path.includes(join('modules', 'automations')) && path.includes('catalog'),
    );
    const infratores = automationsCatalog.filter(({ code }) =>
      /modules\/ai\b|generateAiDraft/.test(code),
    );
    expect(infratores.map((f) => f.path)).toEqual([]);
  });
});

describe('Portal do Cliente nao usa Nexo56 AI neste prompt (item 90)', () => {
  it('nenhum arquivo do Portal importa modules/ai', () => {
    const portal = FILES.filter(
      (f) => f.path.includes(join('app', '(portal)')) || f.path.includes(join('modules', 'portal')),
    );
    const infratores = portal.filter(({ code }) => code.includes('modules/ai/'));
    expect(infratores.map((f) => f.path)).toEqual([]);
  });
});

describe('toda tabela do modulo e tenant-scoped (mesma regra do resto do sistema)', () => {
  it('o schema do modulo usa tenantId() na tabela ai_requests', () => {
    const schema = AI_MODULE.find(({ path }) => path.endsWith(join('infrastructure', 'schema.ts')));
    expect(schema).toBeDefined();
    expect(schema!.code).toMatch(/tenantId\(\)/);
  });

  it('a tabela ai_requests nao tem NENHUMA coluna de texto livre (prompt/input/output)', () => {
    const schema = AI_MODULE.find(({ path }) => path.endsWith(join('infrastructure', 'schema.ts')));
    expect(schema).toBeDefined();
    const padraoProibido = /\b(prompt|inputText|outputText|rawInput|rawOutput)\s*:/i;
    expect(schema!.code).not.toMatch(padraoProibido);
  });
});
