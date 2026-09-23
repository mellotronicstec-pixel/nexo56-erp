import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * AS FRONTEIRAS DO PAINEL (Prompt 18).
 *
 * Travas ARQUITETURAIS. Os testes de integracao provam que o caminho feliz
 * respeita as regras; este teste impede que alguem, daqui a meses, resolva um
 * chamado escrevendo em `service_orders` dentro do Painel, ou fazendo um
 * modulo operacional importar Analytics de volta.
 *
 * "Dashboard le; dominio decide."
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

const ANALYTICS = FILES.filter(
  ({ path }) =>
    path.includes(join('modules', 'analytics')) || path.includes(join('app', '(app)', 'painel')),
);

const INTERNAL_MODULES = [
  'customers',
  'service-orders',
  'quotes',
  'inventory',
  'purchasing',
  'finance',
  'warranties',
  'agenda',
  'work-center',
  'communications',
  'auth',
  'access-control',
] as const;

describe('o modulo existe', () => {
  it('ha arquivos do Painel para inspecionar', () => {
    expect(ANALYTICS.length).toBeGreaterThan(0);
  });
});

describe('o Painel NAO escreve em lugar nenhum', () => {
  it('nao ha insert, update nem delete via Drizzle', () => {
    const padrao = /\.(insert|update|delete)\s*\(/;
    const infratores = ANALYTICS.filter(({ code }) => padrao.test(code));
    expect(infratores.map((f) => f.path)).toEqual([]);
  });

  it('nao ha INSERT, UPDATE ou DELETE em SQL cru', () => {
    const padrao =
      /\b(INSERT\s+INTO\s+`?\w|UPDATE\s+`?\w+`?\s+SET|DELETE\s+FROM\s+`?\w|TRUNCATE\s+TABLE|ALTER\s+TABLE)/i;
    const infratores = ANALYTICS.filter(({ code }) => padrao.test(code));
    expect(infratores.map((f) => f.path)).toEqual([]);
  });

  it('nao abre transacao: o Painel nunca e dono de dado nenhum', () => {
    const infratores = ANALYTICS.filter(({ code }) => /runInTransaction\s*\(/.test(code));
    expect(infratores.map((f) => f.path)).toEqual([]);
  });

  it('nao chama nenhuma primitiva de escrita de outro modulo', () => {
    const padrao =
      /\b(applyStockEntry|planStockEntry|issueWarranty|settleInstallment|createTask|completeTask|cancelTask|createAppointment|createServiceOrder|transitionServiceOrder|createQuote|sendQuote|decideQuote|createPurchaseOrder|createPurchaseNeed|sendMessage|createCommunicationMessage)\s*\(/;
    const infratores = ANALYTICS.filter(({ code }) => padrao.test(code));
    expect(infratores.map((f) => f.path)).toEqual([]);
  });
});

describe('a dependencia e de mao unica: nenhum modulo operacional importa Analytics', () => {
  for (const modulo of INTERNAL_MODULES) {
    it(`modules/${modulo} nunca importa modules/analytics`, () => {
      const alvo = FILES.filter(
        ({ path }) =>
          path.includes(join('modules', modulo)) && !path.includes(join('modules', 'analytics')),
      );
      const infratores = alvo.filter(({ code }) => code.includes('modules/analytics'));
      expect(infratores.map((f) => f.path)).toEqual([]);
    });
  }
});

describe('o Painel nao persiste nada de si mesmo', () => {
  it('nao existe tabela do modulo: todo numero e calculado ao vivo', () => {
    const infratores = ANALYTICS.filter(({ code }) => /mysqlTable\s*\(/.test(code));
    expect(infratores.map((f) => f.path)).toEqual([]);
  });

  it('o modulo nunca teve pasta infrastructure/ (sem migration propria)', () => {
    let hasInfrastructure: boolean;
    try {
      statSync(join(process.cwd(), 'src', 'modules', 'analytics', 'infrastructure'));
      hasInfrastructure = true;
    } catch {
      hasInfrastructure = false;
    }
    expect(hasInfrastructure).toBe(false);
  });
});

describe('o Painel NAO antecipa prompts futuros', () => {
  it('nao ha IA, motor de regras, forecast nem provider de comunicacao', () => {
    const padrao =
      /\b(openai|anthropic|llm|aiGateway|ruleEngine|forecast|predict|whatsapp|nodemailer|twilio|sendgrid|smtp)\b/i;
    const infratores = ANALYTICS.filter(({ code }) => padrao.test(code));
    expect(infratores.map((f) => f.path)).toEqual([]);
  });

  it('nao ha job, cron nem cache distribuido', () => {
    const padrao = /\b(registerJob|jobRegistry|defineJob|redis|ioredis|memcached)\b/i;
    const infratores = ANALYTICS.filter(({ code }) => padrao.test(code));
    expect(infratores.map((f) => f.path)).toEqual([]);
  });
});

describe('todo dinheiro usa Money, nunca Number/float inseguro', () => {
  it('nenhum arquivo faz parseFloat de valor monetario', () => {
    const infratores = ANALYTICS.filter(({ code }) => /parseFloat\s*\(/.test(code));
    expect(infratores.map((f) => f.path)).toEqual([]);
  });

  it('os adaptadores financeiros usam a classe Money', () => {
    const arquivo = ANALYTICS.find(({ path }) => path.endsWith('finance-metrics.ts'));
    expect(arquivo).toBeDefined();
    expect(arquivo!.code).toMatch(/Money\.parse|sumMoney/);
  });
});

describe('toda consulta e tenant-scoped', () => {
  it('cada adaptador de aplicacao filtra por tenantId', () => {
    /**
     * `finance-metrics.ts` e a excecao ESPERADA: ele nao monta SQL nenhuma
     * propria, e reaproveita `loadFinanceOverview` (ja tenant-scoped pelo
     * proprio modulo Financeiro) passando o `TenantContext` inteiro adiante —
     * o tenant viaja dentro do contexto, nao como literal `tenantId` neste
     * arquivo.
     */
    const adaptadores = ANALYTICS.filter(
      ({ path }) =>
        path.includes(join('application')) &&
        path.endsWith('-metrics.ts') &&
        !path.endsWith('finance-metrics.ts'),
    );
    expect(adaptadores.length).toBeGreaterThan(0);
    const semTenant = adaptadores.filter(({ code }) => !/tenantId/.test(code));
    expect(semTenant.map((f) => f.path)).toEqual([]);
  });
});
