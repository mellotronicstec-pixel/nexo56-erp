import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * AS FRONTEIRAS DA BUSCA DE PECAS (Prompt 21, itens 99, 100, 199 a 205,
 * 234, 235). Mesmo padrao de `tests/unit/ai-boundary.test.ts`.
 *
 * "Busca nao movimenta estoque." "Busca nao muda status." "Nexo56 nunca
 * compra peca sozinho."
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

const PART_SEARCH_MODULE = FILES.filter(({ path }) =>
  path.includes(join('modules', 'part-search')),
);

const OPERATIONAL_MODULES = [
  'service-orders',
  'quotes',
  'finance',
  'warranties',
  'agenda',
  'communications',
  'customers',
  'automations',
  'portal',
] as const;

describe('o modulo existe', () => {
  it('ha arquivos da Busca de Pecas para inspecionar', () => {
    expect(PART_SEARCH_MODULE.length).toBeGreaterThan(0);
  });
});

describe('nenhuma execucao arbitraria', () => {
  it('nao ha eval nem Function dinamica', () => {
    const padrao = /\beval\s*\(|new\s+Function\s*\(/;
    const infratores = PART_SEARCH_MODULE.filter(({ code }) => padrao.test(code));
    expect(infratores.map((f) => f.path)).toEqual([]);
  });

  it('nao ha child_process nem execucao de shell', () => {
    const padrao = /\bchild_process\b|\bexecSync\b|\bspawnSync\b/;
    const infratores = PART_SEARCH_MODULE.filter(({ code }) => padrao.test(code));
    expect(infratores.map((f) => f.path)).toEqual([]);
  });

  it('nao ha chamada HTTP arbitraria (fetch/axios/http.request) — o provedor de captura nao usa rede', () => {
    const padrao = /\bfetch\s*\(|\baxios\b|\bhttp\.request\s*\(|\bhttps\.request\s*\(/;
    const infratores = PART_SEARCH_MODULE.filter(({ code }) => padrao.test(code));
    expect(infratores.map((f) => f.path)).toEqual([]);
  });

  it('nao importa nenhum SDK/cliente de IA nem de marketplace (nenhum vendor foi decidido)', () => {
    const padrao =
      /\b(openai|anthropic|@ai-sdk|@google\/generative-ai|mercadolivre|serpapi|rapidapi)\b/i;
    const infratores = PART_SEARCH_MODULE.filter(({ code }) => padrao.test(code));
    expect(infratores.map((f) => f.path)).toEqual([]);
  });
});

describe('nenhuma URL de usuario/provedor e buscada pelo backend (item 119/120, sem SSRF)', () => {
  it('nenhum arquivo chama fetch/axios sobre um campo de URL vindo de resultado externo', () => {
    // Ja coberto pela regra geral acima (nenhum fetch/axios no modulo inteiro) —
    // a URL so alcanca o navegador do usuario, nunca o backend.
    expect(PART_SEARCH_MODULE.some(({ code }) => /\bfetch\s*\(/.test(code))).toBe(false);
  });
});

describe('a Busca de Pecas NAO escreve tabela de outro modulo (item 99/100/199/234)', () => {
  it('nao ha insert/update/delete Drizzle em tabelas de OS, orcamento, estoque, financeiro, garantias ou agenda', () => {
    const padrao =
      /\.(insert|update|delete)\s*\(\s*(serviceOrders|serviceOrderTasks|serviceOrderTimeline|quotes|quoteItems|parts|stockBalances|stockMovements|stockReservations|purchaseOrders|purchaseOrderItems|purchaseNeeds|financialTitles|financialSettlements|financialMovements|warranties|warrantyReturns|agendaTasks)\b/;
    const infratores = PART_SEARCH_MODULE.filter(({ code }) => padrao.test(code));
    expect(infratores.map((f) => f.path)).toEqual([]);
  });

  it('fora de schema.ts, a UNICA leitura de infraestrutura alheia e um SELECT de `parts` em internal-sources.ts (catalogo tenant-wide, documentado)', () => {
    // schema.ts importa tenants/units/users/equipment/service-orders/inventory(parts) SO para
    // declarar as FKs compostas das proprias tabelas (mesmo padrao universal do projeto,
    // ex.: quotes/infrastructure/schema.ts) — nunca escreve nelas.
    const padrao = /from\s+'@\/modules\/([a-z-]+)\/infrastructure/g;
    const permitido = new Set(['part-search', 'tenancy', 'users']);
    for (const { path, code } of PART_SEARCH_MODULE) {
      if (path.endsWith(join('infrastructure', 'schema.ts'))) continue;

      const matches = [...code.matchAll(padrao)];
      for (const match of matches) {
        const modulo = match[1]!;
        if (modulo === 'inventory') {
          expect(
            path.endsWith(join('internal-sources.ts')),
            `${path} importa infra de inventory fora do local documentado`,
          ).toBe(true);
          continue;
        }
        expect(permitido.has(modulo), `${path} importa infraestrutura de ${modulo}`).toBe(true);
      }
    }
  });

  it('nao chama nenhuma primitiva de escrita/transicao de outro modulo — exceto `createPurchaseNeed`, a UNICA acao oficial permitida (item 97)', () => {
    const padrao =
      /\b(transitionServiceOrder|planStockEntry|applyStockEntry|receiveStock|issueStock|adjustStock|reservePart|createPurchaseOrder|settleFinancialTitle|issueWarranty|reverseSettlement|createMessageFromAutomation|createTaskFromAutomation|createPart|updatePart)\s*\(/;
    const infratores = PART_SEARCH_MODULE.filter(({ code }) => padrao.test(code));
    expect(infratores.map((f) => f.path)).toEqual([]);
  });

  it('NUNCA escreve service_orders.status ou quotes.status (arquitetural, sem excecao)', () => {
    const padrao = /service_orders\.status|serviceOrders\.status\s*[:=]|quotes\.status\s*[:=]/;
    const infratores = PART_SEARCH_MODULE.filter(({ code }) => padrao.test(code));
    expect(infratores.map((f) => f.path)).toEqual([]);
  });

  it('nunca chama createPurchaseOrder (nenhuma compra automatica — item 95/96/198)', () => {
    const padrao = /\bcreatePurchaseOrder\s*\(/;
    const infratores = PART_SEARCH_MODULE.filter(({ code }) => padrao.test(code));
    expect(infratores.map((f) => f.path)).toEqual([]);
  });
});

describe('dependencia de mao unica: nenhum modulo operacional importa Busca de Pecas', () => {
  for (const modulo of OPERATIONAL_MODULES) {
    it(`modules/${modulo} nunca importa modules/part-search`, () => {
      const alvo = FILES.filter(
        ({ path }) =>
          path.includes(join('modules', modulo)) && !path.includes(join('modules', 'part-search')),
      );
      const infratores = alvo.filter(({ code }) => code.includes('modules/part-search/'));
      expect(infratores.map((f) => f.path)).toEqual([]);
    });
  }

  it('inventory e purchasing tambem nunca importam modules/part-search (item 71: dependencia so num sentido)', () => {
    const alvo = FILES.filter(
      ({ path }) =>
        (path.includes(join('modules', 'inventory')) ||
          path.includes(join('modules', 'purchasing'))) &&
        !path.includes(join('modules', 'part-search')),
    );
    const infratores = alvo.filter(({ code }) => code.includes('modules/part-search/'));
    expect(infratores.map((f) => f.path)).toEqual([]);
  });
});

describe('a Busca de Pecas nao depende de Portal nem de Automacoes para funcionar (item 205/197)', () => {
  it('nenhum arquivo do modulo importa modules/portal ou modules/automations', () => {
    const infratores = PART_SEARCH_MODULE.filter(({ code }) =>
      /modules\/(portal|automations)\//.test(code),
    );
    expect(infratores.map((f) => f.path)).toEqual([]);
  });
});

describe('o catalogo de acoes de automations nao ganhou nenhuma acao de compra de peca', () => {
  it('o catalogo de acoes nao referencia part-search nem "comprar peca"', () => {
    const automationsCatalog = FILES.filter(
      ({ path }) => path.includes(join('modules', 'automations')) && path.includes('catalog'),
    );
    const infratores = automationsCatalog.filter(({ code }) => /modules\/part-search\b/.test(code));
    expect(infratores.map((f) => f.path)).toEqual([]);
  });
});

describe('toda tabela do modulo e tenant-scoped', () => {
  it('o schema do modulo usa tenantId() em todas as tabelas', () => {
    const schema = PART_SEARCH_MODULE.find(({ path }) =>
      path.endsWith(join('infrastructure', 'schema.ts')),
    );
    expect(schema).toBeDefined();
    const tableCount = (schema!.code.match(/mysqlTable\(/g) ?? []).length;
    const tenantIdCount = (schema!.code.match(/tenantId:\s*tenantId\(\)/g) ?? []).length;
    expect(tenantIdCount).toBe(tableCount);
  });
});
