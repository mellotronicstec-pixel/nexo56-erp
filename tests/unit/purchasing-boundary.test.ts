import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * AS FRONTEIRAS DO MODULO DE COMPRAS (Prompt 11, itens 20, 49, 60, 82 a 87).
 *
 * Travas ARQUITETURAIS de propósito. Um teste de comportamento prova que o
 * caminho feliz respeita a regra; ele nao impede alguem de, daqui a seis meses,
 * resolver um chamado com um `UPDATE stock_balances` dentro do recebimento.
 * Este teste impede.
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

const PURCHASING_FILES = FILES.filter(({ path }) => path.includes(join('modules', 'purchasing')));

describe('compras nao duplica a logica de estoque (item 20)', () => {
  it('o modulo existe e tem arquivos', () => {
    expect(PURCHASING_FILES.length).toBeGreaterThan(0);
  });

  it('nenhum arquivo de compras escreve saldo, ledger ou reserva', () => {
    for (const { path, code } of PURCHASING_FILES) {
      expect(code, path).not.toMatch(/\.update\(\s*stockBalances\s*\)/);
      expect(code, path).not.toMatch(/\.insert\(\s*stockBalances\s*\)/);
      expect(code, path).not.toMatch(/\.insert\(\s*stockMovements\s*\)/);
      expect(code, path).not.toMatch(/\.update\(\s*stockMovements\s*\)/);
      expect(code, path).not.toMatch(/\.insert\(\s*stockReservations\s*\)/);
      expect(code, path).not.toMatch(/UPDATE\s+stock_balances/i);
      expect(code, path).not.toMatch(/INSERT\s+INTO\s+stock_movements/i);
      expect(code, path).not.toMatch(/UPDATE\s+stock_movements/i);
    }
  });

  it('o recebimento usa a primitiva oficial do Inventory', () => {
    const receipt = PURCHASING_FILES.find(({ path }) =>
      path.endsWith(join('purchasing', 'application', 'purchase-receipt-service.ts')),
    );
    expect(receipt).toBeDefined();

    // As duas metades do contrato: planejar fora da transacao, aplicar dentro.
    expect(receipt!.code).toContain('planStockEntry');
    expect(receipt!.code).toContain('applyStockEntry');
  });

  it('so o recebimento toca em estoque — nem o pedido, nem a necessidade', () => {
    for (const { path, code } of PURCHASING_FILES) {
      if (path.endsWith(join('purchasing', 'application', 'purchase-receipt-service.ts'))) continue;
      expect(code, path).not.toMatch(/applyStockEntry|planStockEntry/);
    }
  });
});

describe('compras nao escreve o estado da Ordem de Servico (item 60)', () => {
  it('nenhum arquivo de compras da update em `serviceOrders`', () => {
    for (const { path, code } of PURCHASING_FILES) {
      expect(code, path).not.toMatch(/\.update\(\s*serviceOrders\s*\)/);
      expect(code, path).not.toMatch(/UPDATE\s+service_orders/i);
    }
  });

  it('nenhum arquivo de compras chama o caso de uso de transicao', () => {
    for (const { path, code } of PURCHASING_FILES) {
      expect(code, path).not.toMatch(/\bplanTransition\b/);
      expect(code, path).not.toMatch(/\bapplyTransition\b/);
      expect(code, path).not.toMatch(/\btransitionServiceOrder\b/);
    }
  });

  it('compras nao reserva peca automaticamente (item 61)', () => {
    for (const { path, code } of PURCHASING_FILES) {
      expect(code, path).not.toMatch(/\breservePart\b/);
      expect(code, path).not.toMatch(/\bconsumeReservation\b/);
      expect(code, path).not.toMatch(/\breleaseReservation\b/);
    }
  });
});

describe('a dependencia e de mao unica: Compras -> Estoque (item 49)', () => {
  it('o Inventory nunca importa o modulo de Compras', () => {
    const inventoryFiles = FILES.filter(({ path }) => path.includes(join('modules', 'inventory')));
    expect(inventoryFiles.length).toBeGreaterThan(0);

    for (const { path, code } of inventoryFiles) {
      const imports = [...code.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1] ?? '');
      expect(
        imports.some((entry) => entry.includes('modules/purchasing')),
        `${path} -> modules/purchasing`,
      ).toBe(false);
    }
  });

  it('o Inventory nao referencia tabela de compras no proprio schema', () => {
    const schema = FILES.find(({ path }) =>
      path.endsWith(join('inventory', 'infrastructure', 'schema.ts')),
    );
    expect(schema).toBeDefined();

    for (const tabela of [
      'purchaseOrders',
      'purchaseReceipts',
      'purchaseReceiptItems',
      'purchase_orders',
      'purchase_receipts',
    ]) {
      expect(schema!.code.includes(tabela), tabela).toBe(false);
    }
  });

  it('o Orcamento nao conhece Compras', () => {
    const quoteFiles = FILES.filter(({ path }) => path.includes(join('modules', 'quotes')));
    for (const { path, code } of quoteFiles) {
      const imports = [...code.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1] ?? '');
      expect(
        imports.some((entry) => entry.includes('modules/purchasing')),
        `${path} -> modules/purchasing`,
      ).toBe(false);
    }
  });
});

describe('compras nao antecipa o Financeiro (itens 42 e 83)', () => {
  it('nao cria tabela de conta a pagar, pagamento ou lancamento', () => {
    const proibidas = [
      'accounts_payable',
      'accountsPayable',
      'accounts_receivable',
      'payments',
      'financial_entries',
      'financialEntries',
      'cash_movements',
      'bank_accounts',
    ];

    for (const { path, code } of PURCHASING_FILES) {
      for (const tabela of proibidas) {
        expect(code.includes(tabela), `${path} -> ${tabela}`).toBe(false);
      }
    }
  });

  it('nao importa modulo financeiro, de garantia nem de comunicacao', () => {
    const proibidos = [
      'modules/finance',
      'modules/financial',
      'modules/payments',
      'modules/warranty',
      'modules/communication',
      'modules/portal',
      'modules/automations',
      'modules/ai',
    ];

    for (const { path, code } of PURCHASING_FILES) {
      const imports = [...code.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1] ?? '');
      for (const proibido of proibidos) {
        expect(
          imports.some((entry) => entry.includes(proibido)),
          `${path} -> ${proibido}`,
        ).toBe(false);
      }
    }
  });

  it('nao usa biblioteca de envio de mensagem (item 85)', () => {
    for (const { path, code } of PURCHASING_FILES) {
      const imports = [...code.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1] ?? '');
      for (const lib of ['nodemailer', 'twilio', 'whatsapp', '@sendgrid', 'smtp']) {
        expect(
          imports.some((entry) => entry.includes(lib)),
          `${path} -> ${lib}`,
        ).toBe(false);
      }
    }
  });

  it('nao chama provider de IA nem faz busca externa (item 87)', () => {
    for (const { path, code } of PURCHASING_FILES) {
      const imports = [...code.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1] ?? '');
      for (const lib of [
        'openai',
        'anthropic',
        '@google-cloud',
        'langchain',
        'cheerio',
        'puppeteer',
      ]) {
        expect(
          imports.some((entry) => entry.includes(lib)),
          `${path} -> ${lib}`,
        ).toBe(false);
      }
    }
  });
});

describe('nada compra sozinho (item 9)', () => {
  it('o job de estoque baixo nao cria necessidade nem pedido', () => {
    const job = FILES.find(({ path }) =>
      path.endsWith(join('inventory', 'application', 'low-stock-job.ts')),
    );
    expect(job).toBeDefined();

    expect(job!.code).not.toMatch(/purchaseNeeds|purchase_needs/);
    expect(job!.code).not.toMatch(/purchaseOrders|purchase_orders/);
    expect(job!.code).not.toMatch(/createPurchaseNeed|createPurchaseOrder/);
  });

  it('nenhum consumidor de LOW_STOCK_DETECTED cria compra', () => {
    for (const { path, code } of FILES) {
      if (!code.includes('LOW_STOCK_DETECTED')) continue;
      expect(code, path).not.toMatch(/createPurchaseNeed|createPurchaseOrder|receivePurchase/);
    }
  });

  it('nenhum arquivo cria pedido a partir de evento de estoque', () => {
    for (const { path, code } of PURCHASING_FILES) {
      expect(code, path).not.toMatch(/STOCK_ISSUED|STOCK_ADJUSTED|LOW_STOCK_DETECTED/);
    }
  });
});

describe('o ledger continua append-only depois do Prompt 11', () => {
  it('nenhum arquivo do projeto faz update ou delete de `stockMovements`', () => {
    for (const { path, code } of FILES) {
      expect(code, path).not.toMatch(/\.update\(\s*stockMovements\s*\)/);
      expect(code, path).not.toMatch(/\.delete\(\s*stockMovements\s*\)/);
      expect(code, path).not.toMatch(/DELETE\s+FROM\s+stock_movements/i);
    }
  });

  it('compras nao apaga recebimento — nao existe "delete receipt" (item 26)', () => {
    for (const { path, code } of PURCHASING_FILES) {
      expect(code, path).not.toMatch(/\.delete\(\s*purchaseReceipts\s*\)/);
      expect(code, path).not.toMatch(/\.delete\(\s*purchaseReceiptItems\s*\)/);
      expect(code, path).not.toMatch(/\.delete\(\s*purchasePriceHistory\s*\)/);
      expect(code, path).not.toMatch(/DELETE\s+FROM\s+purchase_receipt/i);
    }
  });

  it('o historico de preco nunca e sobrescrito (itens 7 e 96)', () => {
    for (const { path, code } of PURCHASING_FILES) {
      expect(code, path).not.toMatch(/\.update\(\s*purchasePriceHistory\s*\)/);
      expect(code, path).not.toMatch(/UPDATE\s+purchase_price_history/i);
    }
  });
});
