import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * AS FRONTEIRAS DA AGENDA (Prompt 14).
 *
 * Travas ARQUITETURAIS de proposito. Os testes de integracao provam que o
 * caminho feliz respeita as regras; eles nao impedem alguem de, daqui a seis
 * meses, resolver um chamado escrevendo `service_orders.status` dentro de uma
 * conclusao de tarefa. Este teste impede.
 *
 * O que ele protege, em uma frase: a Agenda LE quatro origens e ESCREVE em
 * duas; ela nao move OS, nao mexe em estoque, dinheiro, compras ou garantia,
 * nao manda mensagem para ninguem e nao adivinha nada.
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

const AGENDA_FILES = FILES.filter(({ path }) => path.includes(join('modules', 'agenda')));

describe('o modulo existe', () => {
  it('ha arquivos da agenda para inspecionar', () => {
    expect(AGENDA_FILES.length).toBeGreaterThan(0);
  });
});

describe('a Agenda NAO move a Ordem de Servico (itens 8 e 34)', () => {
  it('nenhum arquivo do modulo escreve em serviceOrders', () => {
    const infratores = AGENDA_FILES.filter(({ code }) =>
      /\.update\(\s*serviceOrders\s*\)/.test(code),
    );
    expect(infratores.map((f) => f.path)).toEqual([]);
  });

  it('nenhum arquivo do modulo insere em serviceOrders nem em serviceOrderTasks', () => {
    const infratores = AGENDA_FILES.filter(({ code }) =>
      /\.insert\(\s*(serviceOrders|serviceOrderTasks)\s*\)/.test(code),
    );
    expect(infratores.map((f) => f.path)).toEqual([]);
  });

  it('nenhum arquivo do modulo escreve em serviceOrderTasks', () => {
    /**
     * Concluir a tarefa de fluxo pela Agenda e DELEGACAO: quem escreve
     * continua sendo o Prompt 08 (ADR-073). Escrever aqui criaria uma segunda
     * conclusao possivel, com as regras que alguem lembrasse de copiar.
     */
    const infratores = AGENDA_FILES.filter(({ code }) =>
      /\.(update|delete)\(\s*serviceOrderTasks\s*\)/.test(code),
    );
    expect(infratores.map((f) => f.path)).toEqual([]);
  });

  it('a delegacao existe de fato: o modulo chama o servico do Prompt 08', () => {
    const acoes = AGENDA_FILES.find(({ path }) => path.endsWith('agenda-actions.ts'));
    expect(acoes).toBeDefined();
    expect(acoes!.code).toContain('service-orders/application/service-order-actions');
  });
});

describe('a Agenda NAO mexe em estoque, dinheiro, compras nem garantia', () => {
  const TABELAS_PROIBIDAS = [
    'stockMovements',
    'stockBalances',
    'stockReservations',
    'financialTitles',
    'financialInstallments',
    'financialSettlements',
    'financialMovements',
    'cashSessions',
    'purchaseOrders',
    'purchaseReceipts',
    'warranties',
    'warrantyReturns',
    'warrantyCertificates',
    'quotes',
  ];

  for (const tabela of TABELAS_PROIBIDAS) {
    it(`nenhum arquivo do modulo escreve em ${tabela}`, () => {
      const padrao = new RegExp(`\\.(insert|update|delete)\\(\\s*${tabela}\\s*\\)`);
      const infratores = AGENDA_FILES.filter(({ code }) => padrao.test(code));
      expect(infratores.map((f) => f.path)).toEqual([]);
    });
  }

  it('nenhum arquivo do modulo chama primitivas de estoque ou financeiro', () => {
    const padrao =
      /\b(applyStockEntry|planStockEntry|applyTransition|issueWarranty|settleInstallment)\s*\(/;
    const infratores = AGENDA_FILES.filter(({ code }) => padrao.test(code));
    expect(infratores.map((f) => f.path)).toEqual([]);
  });
});

describe('a Agenda NAO manda mensagem para ninguem (item 30)', () => {
  it('nao ha provedor de WhatsApp, e-mail ou SMS no modulo', () => {
    const padrao = /\b(whatsapp|nodemailer|twilio|sendgrid|smtp|sendMail|sendSms)\b/i;
    const infratores = AGENDA_FILES.filter(({ code }) => padrao.test(code));
    expect(infratores.map((f) => f.path)).toEqual([]);
  });

  it('nao ha chamada de rede saindo do modulo', () => {
    const padrao = /\b(fetch|axios|https?\.request)\s*\(/;
    const infratores = AGENDA_FILES.filter(({ code }) => padrao.test(code));
    expect(infratores.map((f) => f.path)).toEqual([]);
  });
});

describe('a Agenda NAO antecipa prompts futuros', () => {
  it('nao ha motor de regras, IA nem recorrencia', () => {
    const padrao = /\b(openai|anthropic|llm|ruleEngine|cronExpression|rrule|recurrence)\b/i;
    const infratores = AGENDA_FILES.filter(({ code }) => padrao.test(code));
    expect(infratores.map((f) => f.path)).toEqual([]);
  });

  it('nao ha job novo: "atrasada" e derivado, nao varrido (ADR-074)', () => {
    const padrao = /registerJob|jobRegistry|defineJob/;
    const infratores = AGENDA_FILES.filter(({ code }) => padrao.test(code));
    expect(infratores.map((f) => f.path)).toEqual([]);
  });

  it('nenhuma coluna `overdue` foi persistida no schema da agenda', () => {
    const schema = AGENDA_FILES.find(({ path }) =>
      path.endsWith(join('infrastructure', 'schema.ts')),
    );
    expect(schema).toBeDefined();
    expect(schema!.code).not.toMatch(/['"]overdue['"]/);
    expect(schema!.code).not.toMatch(/['"]is_overdue['"]/);
  });
});

describe('a tabela que o Prompt 14 supunha nao foi inventada (ADR-075)', () => {
  it('nao existe `service_order_follow_ups` em lugar nenhum do codigo', () => {
    const infratores = FILES.filter(({ code }) =>
      /service_order_follow_ups|serviceOrderFollowUps/.test(code),
    );
    expect(infratores.map((f) => f.path)).toEqual([]);
  });

  it('o follow-up continua sendo coluna da propria OS', () => {
    const schema = FILES.find(({ path }) =>
      path.includes(join('modules', 'service-orders', 'infrastructure', 'schema.ts')),
    );
    expect(schema).toBeDefined();
    expect(schema!.code).toContain("civilDate('follow_up_at')");
    expect(schema!.code).toContain("civilDate('follow_up_alerted_for')");
  });
});

describe('a identidade da tarefa sistemica nao depende de texto (ADR-075)', () => {
  it('createWorkflowTask nao compara titulo nem descricao', () => {
    const arquivo = FILES.find(({ path }) =>
      path.includes(join('service-orders', 'application', 'workflow-service.ts')),
    );
    expect(arquivo).toBeDefined();

    const inicio = arquivo!.code.indexOf('export async function createWorkflowTask');
    expect(inicio).toBeGreaterThan(-1);
    const corpo = arquivo!.code.slice(inicio, inicio + 1600);

    /** A identidade e (serviceOrderId, kind, status aberto) — e so isso. */
    expect(corpo).toContain('serviceOrderTasks.kind');
    expect(corpo).not.toMatch(/eq\(\s*serviceOrderTasks\.title/);
    expect(corpo).not.toMatch(/eq\(\s*serviceOrderTasks\.description/);
  });
});

describe('o texto oficial da preparacao (correcao do Prompt 14)', () => {
  it('a constante do dominio carrega exatamente a redacao normativa', () => {
    const arquivo = FILES.find(({ path }) =>
      path.includes(join('service-orders', 'domain', 'workflow.ts')),
    );
    expect(arquivo).toBeDefined();
    expect(arquivo!.raw).toContain(
      'Realizar limpeza final, conferência estética e preparação do equipamento para entrega ao cliente.',
    );
  });

  it('a migration 0013 corrige por `kind`, nunca so por titulo', () => {
    const sql = readFileSync(join(process.cwd(), 'drizzle', '0013_agenda_tasks.sql'), 'utf8');
    const update = sql.slice(sql.indexOf('UPDATE `service_order_tasks`'));

    expect(update).toContain("`kind` = 'delivery_preparation'");
    /** Nao ha `WHERE title = ...`: titulo nao identifica tarefa nenhuma. */
    expect(update).not.toMatch(/`title`\s*=/);
    /** E o backfill nao encosta em estado. */
    expect(update).not.toMatch(/`status`\s*=/);
    expect(update).not.toMatch(/`open_marker`\s*=/);
  });
});

describe('a limpeza entre testes nao pode esquecer tabela nova', () => {
  /**
   * ESTE TESTE EXISTE PORQUE O DEFEITO JA ACONTECEU DUAS VEZES: primeiro com
   * `service_order_tasks`, no Prompt 08, e de novo com `agenda_tasks` agora. A
   * consequencia e sempre a mesma e sempre confusa — um teste passa sozinho e
   * falha na suite, porque enxerga linha de outro teste.
   */
  it('toda tabela do schema esta na lista de limpeza', () => {
    const helper = readFileSync(join(process.cwd(), 'tests', 'helpers', 'database.ts'), 'utf8');

    const tabelas = new Set<string>();
    for (const { code } of FILES) {
      for (const achado of code.matchAll(/mysqlTable\(\s*'([a-z0-9_]+)'/g)) {
        if (achado[1]) tabelas.add(achado[1]);
      }
    }

    expect(tabelas.size).toBeGreaterThan(30);

    const ausentes = [...tabelas].filter((tabela) => !helper.includes(`'${tabela}'`)).sort();
    expect(ausentes).toEqual([]);
  });
});
