import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * AS FRONTEIRAS DE GARANTIAS (Prompt 13, itens 42, 50, 51, 109 e 131).
 *
 * Travas ARQUITETURAIS de propósito. Um teste de comportamento prova que o
 * caminho feliz respeita a regra; ele nao impede alguem de, daqui a seis meses,
 * resolver um chamado escrevendo `service_orders.status` dentro de um retorno
 * em garantia. Este teste impede.
 *
 * O que ele protege, em uma frase: garantia nao mexe no estado da OS, nao mexe
 * em estoque, nao cria dinheiro, e nao le a politica para decidir o que ja foi
 * prometido.
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

const WARRANTY_FILES = FILES.filter(({ path }) => path.includes(join('modules', 'warranties')));

describe('o modulo existe', () => {
  it('ha arquivos de garantias para inspecionar', () => {
    expect(WARRANTY_FILES.length).toBeGreaterThan(0);
  });
});

describe('Garantias NAO escreve o estado da Ordem de Servico (itens 51 e 109)', () => {
  it('nenhum arquivo do modulo faz UPDATE em serviceOrders com status', () => {
    /**
     * A reclassificacao MUDA o estado da OS — e faz isso pedindo a transicao a
     * maquina de estados do Prompt 08, que e a unica autoridade. O que este
     * teste proibe e o atalho: escrever `status` direto porque a transicao
     * desejada nao existe na matriz.
     */
    const infratores = WARRANTY_FILES.filter(({ code }) =>
      /\.update\(\s*serviceOrders\s*\)[\s\S]{0,400}?\bstatus\s*:/.test(code),
    ).map(({ path }) => path);

    expect(infratores).toEqual([]);
  });

  it('a mudanca de estado passa por applyTransition', () => {
    const reclassificacao = WARRANTY_FILES.find(({ path }) =>
      path.includes('warranty-return-service'),
    );
    expect(reclassificacao).toBeDefined();
    expect(reclassificacao!.code).toContain('applyTransition');
    expect(reclassificacao!.code).toContain('planTransition');
  });
});

describe('Garantias NAO toca estoque (itens 42, 50 e 109)', () => {
  it('nao escreve saldo, movimento nem reserva', () => {
    const proibidas = ['stockBalances', 'stockMovements', 'stockReservations'];

    const infratores = WARRANTY_FILES.flatMap(({ path, code }) =>
      proibidas
        .filter((tabela) =>
          new RegExp(`\\.(insert|update|delete)\\(\\s*${tabela}\\s*\\)`).test(code),
        )
        .map((tabela) => `${path}: escreve em ${tabela}`),
    );

    expect(infratores).toEqual([]);
  });

  it('nao chama servicos de movimentacao do Inventory', () => {
    /**
     * Criar garantia de peca NAO movimenta estoque, e acionar garantia NAO
     * devolve peca (item 42). A peca gasta no reparo em garantia entra pelo
     * caminho normal do Inventory, na OS — nao por aqui.
     */
    const proibidos = ['applyStockEntry', 'applyStockIssue', 'issueStock', 'receiveStock'];
    const infratores = WARRANTY_FILES.flatMap(({ path, code }) =>
      proibidos.filter((fn) => code.includes(fn)).map((fn) => `${path}: usa ${fn}`),
    );

    expect(infratores).toEqual([]);
  });
});

describe('Garantias NAO cria dinheiro (itens 47, 48 e 109)', () => {
  it('nao escreve titulo, liquidacao nem movimento financeiro', () => {
    const proibidas = [
      'financialTitles',
      'financialInstallments',
      'financialSettlements',
      'financialMovements',
    ];

    const infratores = WARRANTY_FILES.flatMap(({ path, code }) =>
      proibidas
        .filter((tabela) =>
          new RegExp(`\\.(insert|update|delete)\\(\\s*${tabela}\\s*\\)`).test(code),
        )
        .map((tabela) => `${path}: escreve em ${tabela}`),
    );

    expect(infratores).toEqual([]);
  });

  it('nao chama os casos de uso do Financeiro', () => {
    /**
     * Garantia valida nao cobra o cliente — e tambem NAO cria titulo de valor
     * zero "para registrar". Custo de garantia mora em `warranty_costs`, que
     * e outra coisa: medida de gasto, nao lancamento financeiro.
     */
    const proibidos = [
      'createFinancialTitle',
      'settleFinancialTitle',
      'ensureServiceOrderCharge',
      'createExpense',
    ];
    const infratores = WARRANTY_FILES.flatMap(({ path, code }) =>
      proibidos.filter((fn) => code.includes(fn)).map((fn) => `${path}: usa ${fn}`),
    );

    expect(infratores).toEqual([]);
  });
});

describe('Garantias NAO altera estado de compra (item 109)', () => {
  it('nao escreve pedido de compra nem quantidade recebida', () => {
    const infratores = WARRANTY_FILES.filter(({ code }) =>
      /\.(insert|update|delete)\(\s*purchaseOrders?(Items)?\s*\)/.test(code),
    ).map(({ path }) => path);

    expect(infratores).toEqual([]);
  });
});

describe('o certificado le o SNAPSHOT, nunca a politica (itens 20 e 130)', () => {
  it('o servico de certificado nao consulta warranty_policies', () => {
    /**
     * A politica pode ter mudado, sido desativada ou apagada. O certificado
     * emitido em janeiro continua dizendo o que foi prometido em janeiro — e
     * isso so e verdade enquanto este arquivo nao souber o que e uma politica.
     */
    const certificado = WARRANTY_FILES.find(({ path }) =>
      path.includes('warranty-certificate-service'),
    );
    expect(certificado).toBeDefined();
    expect(certificado!.code).not.toContain('warrantyPolicies');
    expect(certificado!.code).not.toContain('loadWarrantyPolicy');
  });
});

describe('a criacao da OS passa pela primitiva oficial (item 26)', () => {
  it('nenhum arquivo de garantias faz INSERT em serviceOrders', () => {
    /**
     * Duplicar a abertura de OS aqui significaria duplicar numeracao,
     * follow-up, linha do tempo, auditoria e evento — e as duas copias
     * divergiriam na primeira regra nova do Prompt 07.
     */
    const infratores = WARRANTY_FILES.filter(({ code }) =>
      /\.insert\(\s*serviceOrders\s*\)/.test(code),
    ).map(({ path }) => path);

    expect(infratores).toEqual([]);
  });

  it('usa planServiceOrderCreation e applyServiceOrderCreation', () => {
    const retorno = WARRANTY_FILES.find(({ path }) => path.includes('warranty-return-service'));
    expect(retorno!.code).toContain('planServiceOrderCreation');
    expect(retorno!.code).toContain('applyServiceOrderCreation');
  });
});

describe('sem dependencia circular (item 72)', () => {
  it('core nao importa garantias, salvo o barril do schema', () => {
    /**
     * `src/core/db/schema.ts` e o barril do Drizzle: por construcao ele
     * reexporta o schema de TODOS os modulos, e e o unico arquivo de `core`
     * autorizado a citar um modulo. O teste seguinte garante que ele importe
     * apenas schema, nunca servico.
     */
    const barril = join('core', 'db', 'schema.ts');
    const infratores = FILES.filter(
      ({ path, code }) =>
        path.includes(join('src', 'core')) &&
        !path.endsWith(barril) &&
        /from '@\/modules\/warranties/.test(code),
    ).map(({ path }) => path);

    expect(infratores).toEqual([]);
  });

  it('o barril do schema importa APENAS schema de garantias', () => {
    const barril = FILES.find(({ path }) => path.endsWith(join('core', 'db', 'schema.ts')));
    expect(barril).toBeDefined();
    expect(barril!.code).toContain('@/modules/warranties/infrastructure/schema');
    expect(barril!.code).not.toContain('warranties/application');
    expect(barril!.code).not.toContain('warranties/domain');
  });

  it('os modulos operacionais nao importam garantias da camada de aplicacao', () => {
    /**
     * A EXCECAO DELIBERADA: `service-orders` importa o DOMINIO de garantias
     * para conhecer o tipo `ServiceOrderClassification` e o valor padrao. E
     * uma constante e um tipo — nao ha comportamento atravessando a fronteira,
     * e o grafo continua aciclico porque o dominio de garantias nao importa
     * nada de service-orders.
     */
    const modulos = ['inventory', 'purchasing', 'finance', 'quotes'];

    const infratores = FILES.filter(
      ({ path, code }) =>
        modulos.some((m) => path.includes(join('modules', m))) &&
        /from '@\/modules\/warranties/.test(code),
    ).map(({ path }) => path);

    expect(infratores).toEqual([]);
  });

  it('service-orders so importa o DOMINIO de garantias, nunca a aplicacao', () => {
    const infratores = FILES.filter(
      ({ path, code }) =>
        path.includes(join('modules', 'service-orders')) &&
        /from '@\/modules\/warranties\/(application|infrastructure)/.test(code),
    ).map(({ path }) => path);

    expect(infratores).toEqual([]);
  });

  it('o dominio de garantias nao importa service-orders', () => {
    const dominio = WARRANTY_FILES.filter(({ path }) =>
      path.includes(join('warranties', 'domain')),
    );
    for (const arquivo of dominio) {
      expect(arquivo.code).not.toContain('@/modules/service-orders');
    }
  });
});

describe('nenhuma comunicacao externa foi antecipada (itens 30 e 131)', () => {
  it('o modulo nao fala em WhatsApp, e-mail ou SMS de verdade', () => {
    const proibidos = ['nodemailer', 'sendMail', 'twilio', 'whatsapp', 'sendSms', 'smtp'];

    const infratores = WARRANTY_FILES.flatMap(({ path, code }) =>
      proibidos
        .filter((termo) => code.toLowerCase().includes(termo.toLowerCase()))
        .map((termo) => `${path}: cita ${termo}`),
    );

    expect(infratores).toEqual([]);
  });
});

describe('o payload do evento nao carrega texto sensivel (itens 30 e 120)', () => {
  it('a reclassificacao publica o fato, nao a justificativa', () => {
    /**
     * A justificativa descreve o estado do aparelho e, as vezes, o que o
     * cliente fez com ele. Ela fica na auditoria e na linha do tempo, onde a
     * autorizacao a protege — nao no outbox, que existe para ser consumido por
     * qualquer handler futuro.
     */
    const retorno = WARRANTY_FILES.find(({ path }) => path.includes('warranty-return-service'));
    const trecho = retorno!.code.slice(
      retorno!.code.indexOf('WARRANTY_RETURN_RECLASSIFIED_TO_QUOTE'),
    );
    const payload = trecho.slice(trecho.indexOf('payload:'), trecho.indexOf('payload:') + 400);

    expect(payload).not.toMatch(/\breason\b/);
  });
});
