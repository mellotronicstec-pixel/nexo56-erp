import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * AS FRONTEIRAS DO MODULO DE ESTOQUE (Prompt 10, itens 47, 140 e 166 a 172).
 *
 * Estas travas sao ARQUITETURAIS de propósito. Um teste de comportamento prova
 * que o caminho feliz respeita a regra; ele nao impede alguem de, daqui a seis
 * meses, resolver um chamado com um `UPDATE service_orders SET status` dentro
 * de uma rotina de baixa de peca. Este teste impede.
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

const INVENTORY_FILES = FILES.filter(({ path }) => path.includes(join('modules', 'inventory')));

describe('estoque nunca escreve o estado da Ordem de Servico (itens 46 e 47)', () => {
  it('o modulo existe e tem arquivos', () => {
    expect(INVENTORY_FILES.length).toBeGreaterThan(0);
  });

  it('nenhum arquivo de estoque da update em `serviceOrders`', () => {
    for (const { path, code } of INVENTORY_FILES) {
      expect(code, path).not.toMatch(/\.update\(\s*serviceOrders\s*\)/);
      expect(code, path).not.toMatch(/UPDATE\s+service_orders/i);
    }
  });

  it('nenhum arquivo de estoque chama o caso de uso de transicao', () => {
    /**
     * Nem sequer pelo caminho "certo".
     *
     * O Prompt 09 usa `planTransition`/`applyTransition` porque enviar um
     * orcamento E uma decisao comercial que move o atendimento. Pegar uma peca
     * na prateleira nao e: o tecnico pode estar so testando. Deduzir a
     * transicao do consumo faria a OS andar sozinha (item 49).
     */
    for (const { path, code } of INVENTORY_FILES) {
      expect(code, path).not.toMatch(/\bplanTransition\b/);
      expect(code, path).not.toMatch(/\bapplyTransition\b/);
      expect(code, path).not.toMatch(/\btransitionServiceOrder\b/);
    }
  });

  it('estoque pode escrever na LINHA DO TEMPO da OS — isso e informacao, nao estado', () => {
    const service = INVENTORY_FILES.find(({ path }) =>
      path.endsWith(join('inventory', 'application', 'stock-service.ts')),
    );
    expect(service).toBeDefined();
    expect(service!.code).toContain('serviceOrderTimeline');
  });
});

describe('o ledger e append-only (itens 23 e 24)', () => {
  it('nenhum arquivo faz update ou delete de `stockMovements`', () => {
    for (const { path, code } of FILES) {
      expect(code, path).not.toMatch(/\.update\(\s*stockMovements\s*\)/);
      expect(code, path).not.toMatch(/\.delete\(\s*stockMovements\s*\)/);
      expect(code, path).not.toMatch(/UPDATE\s+stock_movements/i);
      expect(code, path).not.toMatch(/DELETE\s+FROM\s+stock_movements/i);
    }
  });

  it('a tabela nao tem `updated_at` nem `version` — a ausencia e a primeira trava', () => {
    const schema = FILES.find(({ path }) =>
      path.endsWith(join('inventory', 'infrastructure', 'schema.ts')),
    );
    expect(schema).toBeDefined();

    const bloco = schema!.code.slice(
      schema!.code.indexOf('stockMovements = mysqlTable'),
      schema!.code.indexOf('stockReservations = mysqlTable'),
    );
    expect(bloco).toContain('createdAt');
    expect(bloco).not.toContain('timestamps()');
    expect(bloco).not.toMatch(/version:/);
  });
});

describe('so o servico de estoque escreve o saldo', () => {
  it('nenhum arquivo fora de `stock-service.ts` altera `stock_balances`', () => {
    const offenders = FILES.filter(({ path, code }) => {
      if (path.endsWith(join('inventory', 'application', 'stock-service.ts'))) return false;
      if (path.endsWith(join('inventory', 'application', 'low-stock-job.ts'))) return false;
      return (
        /\.update\(\s*stockBalances\s*\)/.test(code) ||
        /UPDATE\s+stock_balances/i.test(code) ||
        /INSERT\s+INTO\s+stock_balances/i.test(code)
      );
    }).map(({ path }) => path.replace(SRC, 'src'));

    expect(offenders).toEqual([]);
  });

  it('o job de estoque baixo so toca na marca do alerta, nunca no saldo', () => {
    const job = FILES.find(({ path }) =>
      path.endsWith(join('inventory', 'application', 'low-stock-job.ts')),
    );
    expect(job).toBeDefined();
    expect(job!.code).toMatch(/low_stock_alerted_at\s*=\s*NOW\(3\)/);
    expect(job!.code).not.toMatch(/\bon_hand\s*=/);
    expect(job!.code).not.toMatch(/\breserved\s*=/);
  });
});

describe('o modulo de estoque nao antecipa os proximos prompts', () => {
  it('nao importa fornecedor, compras, financeiro, garantia, portal nem automacoes', () => {
    const proibidos = [
      'modules/suppliers',
      'modules/supplier',
      'modules/purchases',
      'modules/purchasing',
      'modules/finance',
      'modules/financial',
      'modules/warranty',
      'modules/portal',
      'modules/communication',
      'modules/automations',
      'modules/ai',
    ];

    for (const { path, code } of INVENTORY_FILES) {
      const imports = [...code.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1] ?? '');
      for (const proibido of proibidos) {
        expect(
          imports.some((entry) => entry.includes(proibido)),
          `${path} -> ${proibido}`,
        ).toBe(false);
      }
    }
  });

  it('nao cria tabela de fornecedor, pedido de compra, financeiro ou garantia', () => {
    const tabelas = [
      'suppliers',
      'purchase_orders',
      'purchase_order_items',
      'purchase_receipts',
      'accounts_payable',
      'accounts_receivable',
      'payments',
      'warranties',
    ];

    for (const { path, code } of INVENTORY_FILES) {
      for (const tabela of tabelas) {
        expect(code.includes(tabela), `${path} -> ${tabela}`).toBe(false);
      }
    }
  });

  it('nao usa biblioteca de envio de mensagem (item 170)', () => {
    for (const { path, code } of INVENTORY_FILES) {
      const imports = [...code.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1] ?? '');
      for (const lib of ['nodemailer', 'twilio', 'whatsapp', '@sendgrid', 'smtp']) {
        expect(
          imports.some((entry) => entry.includes(lib)),
          `${path} -> ${lib}`,
        ).toBe(false);
      }
    }
  });

  it('nao chama provider de IA nem declara compatibilidade de peca (itens 112, 113 e 172)', () => {
    for (const { path, code } of INVENTORY_FILES) {
      const imports = [...code.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1] ?? '');
      for (const lib of ['openai', 'anthropic', '@google-cloud', 'langchain']) {
        expect(
          imports.some((entry) => entry.includes(lib)),
          `${path} -> ${lib}`,
        ).toBe(false);
      }
      // Nao ha tabela de compatibilidade peca x equipamento.
      expect(code.includes('part_compatibilities'), path).toBe(false);
      expect(code.includes('partCompatibilities'), path).toBe(false);
    }
  });

  it('estoque nunca importa o modulo de orcamentos — o grafo continua aciclico (item 85)', () => {
    for (const { path, code } of INVENTORY_FILES) {
      const imports = [...code.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1] ?? '');
      expect(
        imports.some((entry) => entry.includes('modules/quotes')),
        `${path} -> modules/quotes`,
      ).toBe(false);
    }
  });
});

describe('nada movimenta estoque a partir de orcamento (itens 36 a 38 e 44)', () => {
  const quoteFiles = FILES.filter(({ path }) => path.includes(join('modules', 'quotes')));

  it('o modulo de orcamentos nao chama nenhum caso de uso de estoque', () => {
    const proibidos = [
      'receiveStock',
      'issueStock',
      'adjustStock',
      'transferStock',
      'reservePart',
      'consumeReservation',
      'releaseReservation',
    ];

    for (const { path, code } of quoteFiles) {
      for (const chamada of proibidos) {
        expect(code.includes(chamada), `${path} -> ${chamada}`).toBe(false);
      }
    }
  });

  it('o modulo de orcamentos nao escreve em saldo, movimentacao nem reserva', () => {
    for (const { path, code } of quoteFiles) {
      expect(code, path).not.toMatch(/stock_balances|stockBalances/);
      expect(code, path).not.toMatch(/stock_movements|stockMovements/);
      expect(code, path).not.toMatch(/stock_reservations|stockReservations/);
    }
  });

  it('nenhum consumidor de evento de orcamento movimenta estoque', () => {
    /**
     * Nao ha Rule Engine (item 171) e nao ha handler de QUOTE_APPROVED que
     * chame estoque. Se um dia houver, este teste falha primeiro.
     */
    for (const { path, code } of FILES) {
      if (!/QUOTE_APPROVED|QUOTE_SENT/.test(code)) continue;
      expect(code, path).not.toMatch(/reservePart|issueStock|consumeReservation/);
    }
  });
});
