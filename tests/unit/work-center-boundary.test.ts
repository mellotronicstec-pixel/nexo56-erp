import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * AS FRONTEIRAS DA CENTRAL DE TRABALHO (Prompt 15).
 *
 * Travas ARQUITETURAIS. Os testes de integracao provam que o caminho feliz
 * respeita as regras; eles nao impedem alguem de, daqui a seis meses, resolver
 * um chamado escrevendo `service_orders.status` dentro da Central. Este teste
 * impede.
 *
 * Em uma frase: a Central LE e nunca escreve. "Centralizar a atencao nao
 * significa centralizar a autoridade."
 */

const SRC = join(process.cwd(), 'src');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : /\.tsx?$/.test(entry) ? [full] : [];
  });
}

/** Comentario nao e codigo: sem isto o teste acusa a propria documentacao. */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

const FILES = walk(SRC).map((path) => {
  const raw = readFileSync(path, 'utf8');
  return { path, raw, code: stripComments(raw) };
});

/** O modulo e a tela: as duas pontas precisam obedecer a mesma regra. */
const CENTRAL = FILES.filter(
  ({ path }) =>
    path.includes(join('modules', 'work-center')) || path.includes(join('central-de-trabalho')),
);

describe('o modulo existe', () => {
  it('ha arquivos da Central para inspecionar', () => {
    expect(CENTRAL.length).toBeGreaterThan(0);
  });
});

describe('a Central NAO escreve em lugar nenhum', () => {
  it('nao ha insert, update nem delete via Drizzle', () => {
    const padrao = /\.(insert|update|delete)\s*\(/;
    const infratores = CENTRAL.filter(({ code }) => padrao.test(code));
    expect(infratores.map((f) => f.path)).toEqual([]);
  });

  it('nao ha INSERT, UPDATE ou DELETE em SQL cru', () => {
    /**
     * `TRUNCATE TABLE`, nao `truncate` solto: a classe do Tailwind que corta
     * texto em excesso se chama `truncate`, e um padrao ganancioso acusaria a
     * propria tela por formatar o nome do cliente.
     */
    const padrao =
      /\b(INSERT\s+INTO\s+`?\w|UPDATE\s+`?\w+`?\s+SET|DELETE\s+FROM\s+`?\w|TRUNCATE\s+TABLE|ALTER\s+TABLE)/i;
    const infratores = CENTRAL.filter(({ code }) => padrao.test(code));
    expect(infratores.map((f) => f.path)).toEqual([]);
  });

  it('nao abre transacao: quem escreve e o dono do dado', () => {
    const infratores = CENTRAL.filter(({ code }) => /runInTransaction\s*\(/.test(code));
    expect(infratores.map((f) => f.path)).toEqual([]);
  });
});

describe('a Central NAO toca no estado da Ordem de Servico', () => {
  it('nao escreve `service_orders.status` de forma alguma', () => {
    const padrao =
      /(serviceOrders\.status\s*[:=][^=]|`?status`?\s*=\s*['"](awaiting|repair|completed|cancelled))/;
    const infratores = CENTRAL.filter(({ code }) => padrao.test(code));
    expect(infratores.map((f) => f.path)).toEqual([]);
  });

  it('nao chama a maquina de estados por conta propria', () => {
    /**
     * A Central leva a pessoa ate a ficha da OS, onde a transicao acontece com
     * permissao, versao e motivo. Chamar a transicao daqui exigiria repetir
     * essas tres coisas — e a copia e que erra.
     */
    const padrao = /\b(transitionServiceOrder|applyTransition|planTransition)\s*\(/;
    const infratores = CENTRAL.filter(({ code }) => padrao.test(code));
    expect(infratores.map((f) => f.path)).toEqual([]);
  });
});

describe('a Central NAO mexe em estoque, compras, financeiro nem garantias', () => {
  const TABELAS = [
    'stockMovements',
    'stockBalances',
    'stockReservations',
    'purchaseOrders',
    'purchaseReceipts',
    'financialTitles',
    'financialInstallments',
    'financialMovements',
    'cashSessions',
    'warranties',
    'warrantyCertificates',
    'agendaTasks',
    'serviceOrderTasks',
  ];

  for (const tabela of TABELAS) {
    it(`nao escreve em ${tabela}`, () => {
      const padrao = new RegExp(`\\.(insert|update|delete)\\(\\s*${tabela}\\s*\\)`);
      const infratores = CENTRAL.filter(({ code }) => padrao.test(code));
      expect(infratores.map((f) => f.path)).toEqual([]);
    });
  }

  it('nao chama primitivas de escrita de outros modulos', () => {
    const padrao =
      /\b(applyStockEntry|planStockEntry|issueWarranty|settleInstallment|createTask|completeTask|cancelTask|createAppointment)\s*\(/;
    const infratores = CENTRAL.filter(({ code }) => padrao.test(code));
    expect(infratores.map((f) => f.path)).toEqual([]);
  });
});

describe('a Central NAO antecipa prompts futuros', () => {
  it('nao ha provedor de comunicacao', () => {
    const padrao =
      /\b(whatsapp|nodemailer|twilio|sendgrid|smtp|sendMail|sendSms|pushNotification)\b/i;
    const infratores = CENTRAL.filter(({ code }) => padrao.test(code));
    expect(infratores.map((f) => f.path)).toEqual([]);
  });

  it('nao ha IA, motor de regras nem portal publico', () => {
    const padrao = /\b(openai|anthropic|llm|aiGateway|ruleEngine|customerPortal)\b/i;
    const infratores = CENTRAL.filter(({ code }) => padrao.test(code));
    expect(infratores.map((f) => f.path)).toEqual([]);
  });

  it('nao ha chamada de rede saindo da Central', () => {
    const padrao = /\b(fetch|axios|https?\.request)\s*\(/;
    const infratores = CENTRAL.filter(({ code }) => padrao.test(code));
    expect(infratores.map((f) => f.path)).toEqual([]);
  });

  it('nao ha job nem cache distribuido: as filas sao consultadas na hora', () => {
    const padrao = /\b(registerJob|jobRegistry|defineJob|redis|ioredis|memcached)\b/i;
    const infratores = CENTRAL.filter(({ code }) => padrao.test(code));
    expect(infratores.map((f) => f.path)).toEqual([]);
  });
});

describe('a Central NAO persiste nada', () => {
  it('nao existe tabela do modulo: o read model e calculado', () => {
    const infratores = CENTRAL.filter(({ code }) => /mysqlTable\s*\(/.test(code));
    expect(infratores.map((f) => f.path)).toEqual([]);
  });

  it('nao ha coluna derivada persistida como `overdue` ou `attention_state`', () => {
    const padrao = /['"](is_overdue|overdue|attention_state)['"]\s*:/;
    const infratores = CENTRAL.filter(({ code }) => padrao.test(code));
    expect(infratores.map((f) => f.path)).toEqual([]);
  });

  it('a Central nao tem infraestrutura de persistencia propria', () => {
    /**
     * A invariante real e "a Central nunca teve schema.ts nem migration
     * dela" — nao "a proxima migration numerada e a 0014". Fixar o numero
     * quebraria no dia em que outro modulo, legitimamente, chegasse a essa
     * mesma numeracao (foi exatamente o que aconteceu no Prompt 16, com
     * `drizzle/0014_communications.sql`). O module nunca teve pasta
     * `infrastructure/`, e e isso que este teste prova, sem depender de
     * quantos prompts vieram depois.
     */
    let hasInfrastructure: boolean;
    try {
      statSync(join(process.cwd(), 'src', 'modules', 'work-center', 'infrastructure'));
      hasInfrastructure = true;
    } catch {
      hasInfrastructure = false;
    }
    expect(hasInfrastructure).toBe(false);
  });
});

describe('a Central NAO inventa estados nem rotulos', () => {
  it('nao ha estado inventado no codigo do modulo', () => {
    const padrao = /['"](urgente|parada|em_trabalho|na_bancada|prioritaria|critica)['"]/i;
    const infratores = CENTRAL.filter(({ code }) => padrao.test(code));
    expect(infratores.map((f) => f.path)).toEqual([]);
  });

  it('o rotulo de estado vem do Prompt 08, nao de um mapa copiado', () => {
    const dominio = CENTRAL.find(({ path }) => path.endsWith(join('domain', 'work-center.ts')));
    expect(dominio).toBeDefined();
    expect(dominio!.code).toContain('SERVICE_ORDER_STATUS_LABEL');
    /** Nenhum rotulo de estado escrito a mao dentro do modulo. */
    expect(dominio!.code).not.toMatch(/['"]Aguardando Conserto['"]/);
  });
});

describe('a ordenacao e deterministica por construcao', () => {
  it('nao ha aleatoriedade nem peso em ponto flutuante', () => {
    const padrao = /\b(Math\.random|RAND\s*\(|parseFloat|\bscore\b)/i;
    const infratores = CENTRAL.filter(({ code }) => padrao.test(code));
    expect(infratores.map((f) => f.path)).toEqual([]);
  });

  it('o ORDER BY termina em chave estavel', () => {
    const consultas = CENTRAL.find(({ path }) => path.endsWith('work-center-queries.ts'));
    expect(consultas).toBeDefined();
    expect(consultas!.code).toMatch(/so\.number ASC/);
  });
});
