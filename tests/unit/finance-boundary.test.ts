import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * AS FRONTEIRAS DO FINANCEIRO (Prompt 12, itens 30, 32, 40, 56 e 98).
 *
 * Travas ARQUITETURAIS de propósito. Um teste de comportamento prova que o
 * caminho feliz respeita a regra; ele nao impede alguem de, daqui a seis meses,
 * resolver um chamado escrevendo `service_orders.status` dentro de um
 * recebimento. Este teste impede.
 *
 * O que ele protege, em uma frase: dinheiro nao mexe em estoque, nao mexe na
 * situacao da Ordem de Servico, e nao apaga o proprio passado.
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

const FINANCE_FILES = FILES.filter(({ path }) => path.includes(join('modules', 'finance')));

describe('o modulo existe', () => {
  it('ha arquivos de financeiro para inspecionar', () => {
    expect(FINANCE_FILES.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Financeiro x Estoque (itens 40 e 98)
// ---------------------------------------------------------------------------

describe('pagar fornecedor NAO mexe em estoque (itens 40 e 98)', () => {
  it('nenhum arquivo do financeiro escreve saldo, ledger de estoque ou reserva', () => {
    const culpados = FINANCE_FILES.filter(({ code }) =>
      /(insert|update|delete)\(\s*stock(Balances|Movements|Reservations|Transfers)/.test(code),
    ).map(({ path }) => path);

    expect(culpados).toEqual([]);
  });

  it('nenhum arquivo do financeiro escreve as tabelas de estoque por SQL cru', () => {
    const culpados = FINANCE_FILES.filter(({ code }) =>
      /(UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+`?stock_(balances|movements|reservations|transfers)`?/i.test(
        code,
      ),
    ).map(({ path }) => path);

    expect(culpados).toEqual([]);
  });

  it('o financeiro nao chama as primitivas de movimentacao de estoque', () => {
    const culpados = FINANCE_FILES.filter(({ code }) =>
      /\b(applyStockEntry|planStockEntry|receiveStock|issueStock|adjustStock|transferStock|reservePart|consumeReservation|releaseReservation)\b/.test(
        code,
      ),
    ).map(({ path }) => path);

    expect(culpados).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Financeiro x Ordem de Servico (itens 30, 32 e 98)
// ---------------------------------------------------------------------------

describe('receber NAO altera a situacao da Ordem de Servico (itens 30, 32 e 98)', () => {
  it('nenhum arquivo do financeiro executa update em service_orders', () => {
    const culpados = FINANCE_FILES.filter(({ code }) =>
      /update\(\s*serviceOrders\b/.test(code),
    ).map(({ path }) => path);

    expect(culpados).toEqual([]);
  });

  it('nenhum arquivo do financeiro escreve service_orders por SQL cru', () => {
    const culpados = FINANCE_FILES.filter(({ code }) =>
      /UPDATE\s+`?service_orders`?/i.test(code),
    ).map(({ path }) => path);

    expect(culpados).toEqual([]);
  });

  it('o financeiro nao chama o workflow da OS', () => {
    const culpados = FINANCE_FILES.filter(({ code }) =>
      /\b(planTransition|applyTransition|transitionServiceOrder)\b/.test(code),
    ).map(({ path }) => path);

    expect(culpados).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Financeiro x Compras (itens 37, 40 e 98)
// ---------------------------------------------------------------------------

describe('pagar NAO altera o pedido de compra (itens 37 e 98)', () => {
  it('nenhum arquivo do financeiro escreve pedido, item ou recebimento de compra', () => {
    const culpados = FINANCE_FILES.filter(({ code }) =>
      /(insert|update|delete)\(\s*purchase(Orders|OrderItems|Receipts|ReceiptItems|Needs)/.test(
        code,
      ),
    ).map(({ path }) => path);

    expect(culpados).toEqual([]);
  });

  it('nenhum arquivo do financeiro escreve tabelas de compras por SQL cru', () => {
    const culpados = FINANCE_FILES.filter(({ code }) =>
      /(UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+`?purchase_(orders|order_items|receipts|receipt_items|needs)`?/i.test(
        code,
      ),
    ).map(({ path }) => path);

    expect(culpados).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Dependencia de mao unica (item 56)
// ---------------------------------------------------------------------------

describe('nenhum modulo operacional depende do Financeiro (item 56)', () => {
  const alvos = ['service-orders', 'quotes', 'purchasing', 'inventory', 'equipment', 'customers'];

  for (const modulo of alvos) {
    it(`${modulo} nao importa nada de modules/finance`, () => {
      const culpados = FILES.filter(
        ({ path, code }) =>
          path.includes(join('modules', modulo)) && /from '@\/modules\/finance/.test(code),
      ).map(({ path }) => path);

      expect(culpados).toEqual([]);
    });
  }

  it('o ERP continua funcionando sem o Financeiro: nenhum core o exige', () => {
    /**
     * `core/db/schema.ts` e a UNICA excecao legitima, e por construcao: ele e o
     * barril que reune as tabelas de todos os modulos para o cliente do Drizzle
     * e para o drizzle-kit. Conhecer o nome de cada schema e o trabalho dele —
     * nao e o core dependendo de regra de negocio financeira.
     */
    const barril = join('core', 'db', 'schema.ts');

    const culpados = FILES.filter(
      ({ path, code }) =>
        path.includes(join('src', 'core')) &&
        !path.endsWith(barril) &&
        /from '@\/modules\/finance/.test(code),
    ).map(({ path }) => path);

    expect(culpados).toEqual([]);
  });

  it('o barril do banco so importa o SCHEMA do financeiro, nunca um servico', () => {
    const barril = FILES.find(({ path }) => path.endsWith(join('core', 'db', 'schema.ts')));
    const importacoes = [
      ...(barril?.code.matchAll(/from '(@\/modules\/finance[^']*)'/g) ?? []),
    ].map((match) => match[1]);

    expect(importacoes).toEqual(['@/modules/finance/infrastructure/schema']);
  });
});

// ---------------------------------------------------------------------------
// Ledger append-only (itens 14 e 74)
// ---------------------------------------------------------------------------

describe('o ledger financeiro e append-only (itens 14 e 74)', () => {
  it('nenhum arquivo do projeto executa update ou delete em financialMovements', () => {
    const culpados = FILES.filter(({ code }) =>
      /(update|delete)\(\s*financialMovements\b/.test(code),
    ).map(({ path }) => path);

    expect(culpados).toEqual([]);
  });

  it('nenhum arquivo escreve financial_movements por SQL cru de alteracao', () => {
    const culpados = FILES.filter(({ code }) =>
      /(UPDATE|DELETE\s+FROM)\s+`?financial_movements`?/i.test(code),
    ).map(({ path }) => path);

    expect(culpados).toEqual([]);
  });

  it('a tabela do ledger nao tem coluna de alteracao — a ausencia e a barreira', () => {
    const schema = FINANCE_FILES.find(({ path }) =>
      path.endsWith(join('infrastructure', 'schema.ts')),
    );
    expect(schema).toBeDefined();

    const bloco = /export const financialMovements = mysqlTable\(([\s\S]*?)\n\);/.exec(
      schema?.code ?? '',
    );
    expect(bloco).not.toBeNull();
    expect(bloco?.[1]).not.toContain('timestamps()');
    expect(bloco?.[1]).not.toContain('version');
  });
});

describe('liquidacao confirmada nao e apagada (item 74)', () => {
  it('nenhum arquivo executa delete em financialSettlements', () => {
    const culpados = FILES.filter(({ code }) => /delete\(\s*financialSettlements\b/.test(code)).map(
      ({ path }) => path,
    );

    expect(culpados).toEqual([]);
  });

  it('nenhum arquivo executa delete em financialTitles', () => {
    const culpados = FILES.filter(({ code }) => /delete\(\s*financialTitles\b/.test(code)).map(
      ({ path }) => path,
    );

    expect(culpados).toEqual([]);
  });

  it('o modulo nao expoe nada que apague liquidacao ou movimento', () => {
    const culpados = FINANCE_FILES.filter(({ code }) =>
      /export\s+(async\s+)?function\s+\w*(deleteSettlement|removeSettlement|deleteMovement|eraseMovement)/i.test(
        code,
      ),
    ).map(({ path }) => path);

    expect(culpados).toEqual([]);
  });

  it('estorno existe, e ele cria contramovimento (item 41)', async () => {
    const servico = await import('@/modules/finance/application/settlement-service');
    expect(typeof servico.reverseSettlement).toBe('function');

    const arquivo = FINANCE_FILES.find(({ path }) => path.endsWith('settlement-service.ts'));
    /** O estorno grava `reversal_of_movement_id`: e o rastro do contramovimento. */
    expect(arquivo?.code).toContain('reversalOfMovementId');
    expect(arquivo?.code).toContain('oppositeDirection');
  });
});

// ---------------------------------------------------------------------------
// O que o Prompt 12 NAO antecipa (itens 77 a 84 e 118)
// ---------------------------------------------------------------------------

describe('nada de banco, fiscal, contabilidade, garantia, mensageria, IA (itens 80 a 84)', () => {
  it('nenhuma integracao bancaria, PIX API, boleto real, OFX ou CNAB', () => {
    const culpados = FINANCE_FILES.filter(({ code }) =>
      /\b(ofx|cnab|openfinance|open_finance|pixApi|bacen|febraban|gerencianet|pagarme|stripe|mercadopago)\b/i.test(
        code,
      ),
    ).map(({ path }) => path);

    expect(culpados).toEqual([]);
  });

  it('nenhuma emissao fiscal', () => {
    const culpados = FINANCE_FILES.filter(({ code }) =>
      /\b(nfe|nfce|nfse|sefaz|sped|danfe)\b/i.test(code),
    ).map(({ path }) => path);

    expect(culpados).toEqual([]);
  });

  it('nenhuma contabilidade formal: sem partida dobrada, razao ou DRE', () => {
    const culpados = FINANCE_FILES.filter(({ code }) =>
      /\b(doubleEntry|partidaDobrada|chartOfAccounts|planoDeContas|generalLedger|balancoPatrimonial)\b/i.test(
        code,
      ),
    ).map(({ path }) => path);

    expect(culpados).toEqual([]);
  });

  it('nenhuma mensageria externa', () => {
    const culpados = FINANCE_FILES.filter(({ code }) =>
      /\b(nodemailer|twilio|sendgrid|whatsapp|smtp|mailgun)\b/i.test(code),
    ).map(({ path }) => path);

    expect(culpados).toEqual([]);
  });

  it('nenhuma IA', () => {
    const culpados = FINANCE_FILES.filter(({ code }) =>
      /\b(openai|anthropic|@ai-sdk|langchain|llm)\b/i.test(code),
    ).map(({ path }) => path);

    expect(culpados).toEqual([]);
  });

  it('nenhum rule engine', () => {
    const culpados = FINANCE_FILES.filter(({ code }) =>
      /\b(ruleEngine|rule_engine|automationRule)\b/i.test(code),
    ).map(({ path }) => path);

    expect(culpados).toEqual([]);
  });

  it('nenhuma garantia: o Prompt 13 ainda nao aconteceu', () => {
    const culpados = FINANCE_FILES.filter(({ code }) =>
      /(insert|update)\(\s*warranties\b|from '@\/modules\/warranty/.test(code),
    ).map(({ path }) => path);

    expect(culpados).toEqual([]);
  });
});

describe('dados de cartao proibidos (item 109)', () => {
  it('nenhuma coluna ou campo guarda numero completo, CVV, senha ou token bancario', () => {
    const culpados = FINANCE_FILES.filter(({ code }) =>
      /\b(cvv|cardNumber|card_number|cvc|fullCardNumber|pan|bankToken|acquirerToken)\b/i.test(code),
    ).map(({ path }) => path);

    expect(culpados).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Money (item 5)
// ---------------------------------------------------------------------------

describe('dinheiro nunca passa por ponto flutuante (item 5)', () => {
  it('nenhum arquivo do financeiro usa parseFloat ou Number em valor monetario', () => {
    const culpados = FINANCE_FILES.filter(({ code }) =>
      /parseFloat\s*\(|Number\s*\(\s*\w*[aA]mount|Number\s*\(\s*\w*[bB]alance/.test(code),
    ).map(({ path }) => path);

    expect(culpados).toEqual([]);
  });

  it('o financeiro nao cria uma segunda abstracao de dinheiro', () => {
    const culpados = FINANCE_FILES.filter(({ code }) =>
      /class\s+\w*Money\b|class\s+\w*Currency\b/.test(code),
    ).map(({ path }) => path);

    expect(culpados).toEqual([]);
  });

  it('o Money do core e o unico usado', async () => {
    const dominio = await import('@/modules/finance/domain/finance');
    const parcelas = dominio.splitAmountIntoInstallments(
      (await import('@/core/money/money')).Money.parse('100.00'),
      3,
    );
    expect(parcelas[0]?.constructor.name).toBe('Money');
  });
});
