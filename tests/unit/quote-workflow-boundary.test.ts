import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * FRONTEIRA ENTRE ORCAMENTO E WORKFLOW (Prompt 09, itens 19 e 124).
 *
 * Esta e a trava mais importante da etapa, e ela e ARQUITETURAL de propósito:
 * um teste de comportamento prova que o caminho feliz passa pelo workflow, mas
 * nao impede alguem de, daqui a seis meses, resolver um bug com um
 * `UPDATE service_orders SET status` no modulo de orcamento. Este teste
 * impede.
 *
 * A regra: `service_orders.status` e escrito em UM lugar so —
 * `workflow-service.ts`. Todo o resto pede.
 */

const SRC = join(process.cwd(), 'src');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : /\.tsx?$/.test(entry) ? [full] : [];
  });
}

/**
 * Remove comentarios antes de inspecionar.
 *
 * Sem isto, o teste acusa a propria documentacao: o schema explica, em
 * comentario, que "esta tabela NAO tem `product_id`" — e uma busca ingenua le
 * isso como se tivesse.
 */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

const FILES = walk(SRC).map((path) => {
  const raw = readFileSync(path, 'utf8');
  return { path, raw, code: stripComments(raw) };
});

describe('somente o workflow escreve o estado da OS', () => {
  it('nenhum arquivo fora do workflow faz update de `serviceOrders` com `status`', () => {
    const offenders = FILES.filter(({ path, code }) => {
      if (path.endsWith(join('service-orders', 'application', 'workflow-service.ts'))) return false;

      // `update(serviceOrders)` seguido, em ate ~20 linhas, de `status:`
      const updates = [...code.matchAll(/\.update\(\s*serviceOrders\s*\)/g)];
      return updates.some((match) => {
        const janela = code.slice(match.index, match.index + 900);
        return /\bstatus:\s/.test(janela);
      });
    }).map(({ path }) => path.replace(SRC, 'src'));

    expect(offenders).toEqual([]);
  });

  it('nenhum SQL cru fora do workflow altera service_orders.status', () => {
    const offenders = FILES.filter(({ path, code }) => {
      if (path.endsWith(join('service-orders', 'application', 'workflow-service.ts'))) return false;
      return /UPDATE\s+service_orders[\s\S]{0,200}?\bSET\b[\s\S]{0,200}?\bstatus\s*=/i.test(code);
    }).map(({ path }) => path.replace(SRC, 'src'));

    expect(offenders).toEqual([]);
  });

  it('o modulo de orcamentos nao importa a tabela de OS para escrever nela', () => {
    const quoteFiles = FILES.filter(({ path }) => path.includes(join('modules', 'quotes')));
    expect(quoteFiles.length).toBeGreaterThan(0);

    for (const { path, code } of quoteFiles) {
      // Pode LER a OS e escrever na linha do tempo dela; nunca dar update nela.
      expect(code, path).not.toMatch(/\.update\(\s*serviceOrders\s*\)/);
      expect(code, path).not.toMatch(/UPDATE\s+service_orders/i);
    }
  });

  it('o orcamento move a OS pelo caso de uso central, e nao por conta propria', () => {
    const service = FILES.find(({ path }) =>
      path.endsWith(join('quotes', 'application', 'quote-service.ts')),
    );
    expect(service).toBeDefined();

    // As duas metades do contrato do Prompt 08: planejar e aplicar.
    expect(service!.code).toContain('planTransition');
    expect(service!.code).toContain('applyTransition');
  });

  it('o job de expiracao nao encosta na Ordem de Servico (item 23)', () => {
    const job = FILES.find(({ path }) =>
      path.endsWith(join('quotes', 'application', 'quote-expiry-job.ts')),
    );
    expect(job).toBeDefined();
    expect(job!.code).not.toMatch(/service_orders/i);
    expect(job!.code).not.toMatch(/transitionServiceOrder|applyTransition/);
  });
});

describe('o modulo de orcamentos nao antecipa outros modulos', () => {
  const quoteFiles = FILES.filter(({ path }) => path.includes(join('modules', 'quotes')));

  /**
   * A verificacao e sobre DEPENDENCIA E ESCRITA, nao sobre palavras.
   *
   * Procurar a string "garantia" no arquivo acusaria um comentario em
   * portugues que diz "a garantia final e a UNIQUE do banco" — e um teste que
   * falha por prosa ensina a equipe a afrouxa-lo. O que importa e: o modulo
   * importa outro dominio? escreve na tabela dele? chama biblioteca de envio?
   */
  it('nao importa compras, financeiro, garantia, Portal nem automacoes', () => {
    const proibidos = [
      'modules/purchases',
      'modules/suppliers',
      'modules/finance',
      'modules/financial',
      'modules/warranty',
      'modules/portal',
      'modules/communication',
      'modules/automations',
    ];

    for (const { path, code } of quoteFiles) {
      const imports = [...code.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1] ?? '');
      for (const proibido of proibidos) {
        expect(
          imports.some((entry) => entry.includes(proibido)),
          `${path} -> ${proibido}`,
        ).toBe(false);
      }
    }
  });

  /**
   * O PROMPT 10 MUDOU ESTA REGRA, E DE PROPOSITO (item 39).
   *
   * Ate o Prompt 09 o orcamento nao podia conhecer estoque nenhum — porque
   * estoque nao existia, e uma referencia a catalogo teria sido invencao. Com
   * o catalogo real, `quote_items.part_id` passou a ser exatamente o que o
   * comentario do schema do Prompt 09 previa: coluna aditiva e opcional.
   *
   * O que continua proibido e o que sempre importou: a CAMADA DE APLICACAO do
   * orcamento nao conhece estoque. Salvar, enviar e aprovar seguem sem
   * movimentar nada. A unica ponte e a FK da tabela, verificada abaixo.
   */
  it('so o SCHEMA conhece o catalogo de pecas; a aplicacao do orcamento nao', () => {
    const naoSchema = quoteFiles.filter(
      ({ path }) => !path.endsWith(join('quotes', 'infrastructure', 'schema.ts')),
    );
    expect(naoSchema.length).toBeGreaterThan(0);

    for (const { path, code } of naoSchema) {
      const imports = [...code.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1] ?? '');
      expect(
        imports.some((entry) => entry.includes('modules/inventory')),
        `${path} -> modules/inventory`,
      ).toBe(false);
    }
  });

  it('nao escreve em saldo, movimentacao, reserva, compra, financeiro ou garantia', () => {
    const tabelas = [
      'stock_balances',
      'stockBalances',
      'stock_movements',
      'stockMovements',
      'stock_reservations',
      'stockReservations',
      'stock_transfers',
      'stockTransfers',
      'purchase_orders',
      'suppliers',
      'accounts_receivable',
      'accounts_payable',
      'payments',
      'warranties',
    ];

    for (const { path, code } of quoteFiles) {
      for (const tabela of tabelas) {
        expect(code.includes(tabela), `${path} -> ${tabela}`).toBe(false);
      }
    }
  });

  it('nao usa biblioteca de envio de mensagem (item 109)', () => {
    for (const { path, code } of quoteFiles) {
      const imports = [...code.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1] ?? '');
      for (const lib of ['nodemailer', 'twilio', 'whatsapp', '@sendgrid', 'smtp']) {
        expect(
          imports.some((entry) => entry.includes(lib)),
          `${path} -> ${lib}`,
        ).toBe(false);
      }
    }
  });

  it('a linha de PECA guarda o proprio texto, e o vinculo com peca e OPCIONAL', () => {
    const schema = FILES.find(({ path }) =>
      path.endsWith(join('quotes', 'infrastructure', 'schema.ts')),
    );
    expect(schema).toBeDefined();

    // O que a proposta diz ao cliente continua escrito nela.
    expect(schema!.raw).toContain("description: varchar('description'");

    // O vinculo do Prompt 10 existe e e NULAVEL: linha manual continua valida.
    expect(schema!.code).toContain("partId: idRef('part_id')");
    expect(schema!.code).not.toMatch(/partId: idRef\('part_id'\)\s*\.notNull\(\)/);

    // E nao ha `product_id` nem `sku`: o catalogo e de PECAS, nao de produtos.
    expect(schema!.code).not.toMatch(/productId|product_id|\bsku\b/i);
  });
});
