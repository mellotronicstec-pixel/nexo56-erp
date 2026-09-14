import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { runWithContext } from '@/core/context/request-context';
import { getDb } from '@/core/db/client';
import { BusinessRuleError, ConflictError, NotFoundError, ValidationError } from '@/core/errors';
import { auditLogs } from '@/modules/audit/infrastructure/schema';
import { createCustomer } from '@/modules/customers/application/customer-service';
import { createEquipment } from '@/modules/equipment/application/equipment-service';
import { domainEvents } from '@/modules/events/infrastructure/schema';
import {
  approveQuote,
  cancelQuote,
  createQuote,
  rejectQuote,
  reviseQuote,
  saveQuoteDraft,
  sendQuote,
} from '@/modules/quotes/application/quote-service';
import {
  findQuoteDetail,
  listQuotesForServiceOrder,
} from '@/modules/quotes/application/quote-queries';
import { quoteItems, quoteTimeline, quotes } from '@/modules/quotes/infrastructure/schema';
import { createServiceOrder } from '@/modules/service-orders/application/service-order-service';
import { transitionServiceOrder } from '@/modules/service-orders/application/workflow-service';
import {
  serviceOrderTimeline,
  serviceOrders,
} from '@/modules/service-orders/infrastructure/schema';
import { closeTestDatabase, migrateTestDatabase, truncateAll } from '../helpers/database';
import {
  contextFor,
  createPlainUser,
  createTenantFixture,
  createUnit,
  grantMembership,
  seedCatalog,
  type TenantFixture,
} from '../helpers/fixtures';

/**
 * ORCAMENTOS (Prompt 09, itens 121 a 125).
 *
 * O eixo destes testes: o orcamento decide VALORES e a DECISAO do cliente; o
 * workflow decide o ESTADO DA OS; e as duas coisas acontecem juntas ou nao
 * acontecem.
 */

let tenantA: TenantFixture;
let tenantB: TenantFixture;
let ordemId: string;

const run = <T>(work: () => Promise<T>) => runWithContext({ origin: 'test' }, work);

let telefoneSequencial = 0;

async function abrirOrdem(fixture: TenantFixture): Promise<string> {
  // Telefone unico por cliente: o cadastro recusa contato repetido na empresa,
  // e cada `beforeEach` limpa o banco enquanto o contador segue crescendo.
  telefoneSequencial += 1;
  const telefone = `11${String(900000000 + telefoneSequencial * 37)}`.slice(0, 11);

  const customerId = (
    await run(() =>
      createCustomer(fixture.context, {
        kind: 'individual',
        name: 'Cliente do orcamento',
        contacts: [{ type: 'phone', value: telefone, isWhatsapp: false }],
      }),
    )
  ).customerId;

  const equipmentId = (
    await run(() => createEquipment(fixture.context, { customerId, kind: 'Televisor' }))
  ).equipmentId;

  return (
    await run(() =>
      createServiceOrder(fixture.context, { equipmentId, customerReport: 'Nao liga.' }),
    )
  ).serviceOrderId;
}

const itensPadrao = [
  {
    kind: 'service' as const,
    description: 'Mao de obra de bancada',
    quantity: '2',
    unitPrice: '80.00',
  },
  { kind: 'part' as const, description: 'Fonte chaveada 12V', quantity: '1', unitPrice: '149.90' },
];

/** Cria um orcamento com itens, pronto para enviar. */
async function orcamentoComItens(
  fixture: TenantFixture = tenantA,
  orderId = ordemId,
): Promise<string> {
  const { quoteId } = await run(() => createQuote(fixture.context, { serviceOrderId: orderId }));
  await run(() => saveQuoteDraft(fixture.context, quoteId, { items: itensPadrao }));
  return quoteId;
}

async function statusOS(id: string): Promise<string> {
  const [row] = await getDb()
    .select({ status: serviceOrders.status })
    .from(serviceOrders)
    .where(eq(serviceOrders.id, id))
    .limit(1);
  return row!.status;
}

async function quoteRow(id: string) {
  const [row] = await getDb().select().from(quotes).where(eq(quotes.id, id)).limit(1);
  return row!;
}

beforeAll(async () => {
  await migrateTestDatabase();
});

afterAll(async () => {
  await closeTestDatabase();
});

beforeEach(async () => {
  await truncateAll();
  const planId = await seedCatalog();
  tenantA = await createTenantFixture('orc-a', planId);
  tenantB = await createTenantFixture('orc-b', planId);
  ordemId = await abrirOrdem(tenantA);
});

// ---------------------------------------------------------------------------
// Criacao e vinculo
// ---------------------------------------------------------------------------

describe('criacao (itens 4, 5, 8 e 17)', () => {
  it('nasce em rascunho, herda tenant e unidade da OS e NAO muda a situacao dela', async () => {
    const antes = await statusOS(ordemId);
    const { quoteId, number, revision } = await run(() =>
      createQuote(tenantA.context, { serviceOrderId: ordemId }),
    );

    const row = await quoteRow(quoteId);
    expect(row.status).toBe('draft');
    expect(row.tenantId).toBe(tenantA.tenantId);
    expect(row.unitId).toBe(tenantA.unitId);
    expect(row.serviceOrderId).toBe(ordemId);
    expect(revision).toBe(1);
    expect(number).toBeGreaterThan(0);

    // Criar orcamento e trabalho interno: a OS so se move no envio.
    expect(await statusOS(ordemId)).toBe(antes);
  });

  it('o numero vem da sequencia do TENANT, compartilhada entre unidades (itens 11 e 12)', async () => {
    const outraUnidade = await createUnit(tenantA.tenantId, 'Norte');
    const contexto = await contextFor(tenantA.tenantId, tenantA.adminUserId, outraUnidade);
    const ordemNorte = await abrirOrdem({ ...tenantA, context: contexto });

    const primeiro = await run(() => createQuote(tenantA.context, { serviceOrderId: ordemId }));
    const segundo = await run(() => createQuote(contexto, { serviceOrderId: ordemNorte }));

    expect(segundo.number).toBe(primeiro.number + 1);
  });

  it('numeros simultaneos nao colidem (item 13)', async () => {
    /**
     * As Ordens de Servico sao preparadas EM SERIE de propósito: o que este
     * teste precisa disputar e a alocacao do NUMERO DO ORCAMENTO. Criar cinco
     * clientes em paralelo produz deadlock no cadastro de contatos — ruido de
     * preparo que esconderia o que se quer medir.
     */
    const ordens: string[] = [];
    for (let i = 0; i < 8; i += 1) ordens.push(await abrirOrdem(tenantA));

    const criados = await Promise.all(
      ordens.map((id) => run(() => createQuote(tenantA.context, { serviceOrderId: id }))),
    );

    const numeros = criados.map((quote) => quote.number).sort((a, b) => a - b);
    // Oito numeros distintos e sem furo: nada de MAX+1 devolvendo o mesmo.
    expect(new Set(numeros).size).toBe(8);
    expect(numeros[7]! - numeros[0]!).toBe(7);
  });

  it('o mesmo comando nao cria dois orcamentos (itens 94 e 95)', async () => {
    const chave = 'form-abc-123';
    const primeiro = await run(() =>
      createQuote(tenantA.context, { serviceOrderId: ordemId, idempotencyKey: chave }),
    );
    const segundo = await run(() =>
      createQuote(tenantA.context, { serviceOrderId: ordemId, idempotencyKey: chave }),
    );

    expect(segundo.quoteId).toBe(primeiro.quoteId);
    expect(segundo.reused).toBe(true);
    expect(await getDb().select().from(quotes)).toHaveLength(1);
  });

  it('uma OS tem no maximo UMA proposta viva por vez (item 65)', async () => {
    await run(() => createQuote(tenantA.context, { serviceOrderId: ordemId }));
    await expect(
      run(() => createQuote(tenantA.context, { serviceOrderId: ordemId })),
    ).rejects.toThrow();
  });

  it('OS inexistente ou de outra empresa nao recebe orcamento (itens 7 e 74)', async () => {
    const ordemB = await abrirOrdem(tenantB);
    await expect(
      run(() => createQuote(tenantA.context, { serviceOrderId: ordemB })),
    ).rejects.toThrow(NotFoundError);
  });
});

// ---------------------------------------------------------------------------
// Itens e calculo
// ---------------------------------------------------------------------------

describe('itens e totais (itens 29 a 43)', () => {
  it('o BACKEND calcula os totais; o que o formulario mandar e ignorado (itens 36 e 40)', async () => {
    const { quoteId } = await run(() => createQuote(tenantA.context, { serviceOrderId: ordemId }));

    const totais = await run(() =>
      saveQuoteDraft(tenantA.context, quoteId, {
        items: itensPadrao,
        // 2 x 80,00 = 160,00  +  1 x 149,90 = 149,90  ->  309,90
      }),
    );

    expect(totais.subtotal).toBe('309.90');
    expect(totais.total).toBe('309.90');

    const row = await quoteRow(quoteId);
    expect(row.total).toBe('309.90');
  });

  it('desconto por linha e desconto global entram no total', async () => {
    const { quoteId } = await run(() => createQuote(tenantA.context, { serviceOrderId: ordemId }));

    const totais = await run(() =>
      saveQuoteDraft(tenantA.context, quoteId, {
        items: [
          {
            kind: 'service',
            description: 'Mao de obra',
            quantity: '1',
            unitPrice: '200.00',
            discount: '20.00',
          },
          { kind: 'part', description: 'Capacitor', quantity: '4', unitPrice: '12.50' },
        ],
        discount: '10.00',
      }),
    );

    // (200 - 20) + (4 x 12,50 = 50) = 230,00 ; menos 10,00 = 220,00
    expect(totais.subtotal).toBe('230.00');
    expect(totais.discount).toBe('10.00');
    expect(totais.total).toBe('220.00');
  });

  it('quantidade fracionada funciona (item 34)', async () => {
    const { quoteId } = await run(() => createQuote(tenantA.context, { serviceOrderId: ordemId }));

    const totais = await run(() =>
      saveQuoteDraft(tenantA.context, quoteId, {
        items: [
          {
            kind: 'service',
            description: 'Meia hora de bancada',
            quantity: '0.5',
            unitPrice: '90.00',
          },
        ],
      }),
    );

    expect(totais.total).toBe('45.00');
  });

  it('item de valor ZERO e permitido: cortesia existe (item 43)', async () => {
    const { quoteId } = await run(() => createQuote(tenantA.context, { serviceOrderId: ordemId }));

    const totais = await run(() =>
      saveQuoteDraft(tenantA.context, quoteId, {
        items: [
          { kind: 'service', description: 'Diagnostico', quantity: '1', unitPrice: '120.00' },
          { kind: 'service', description: 'Limpeza (cortesia)', quantity: '1', unitPrice: '0' },
        ],
      }),
    );

    expect(totais.total).toBe('120.00');
    expect(await getDb().select().from(quoteItems)).toHaveLength(2);
  });

  it('valor negativo, quantidade zero e desconto maior que a linha sao recusados (item 42)', async () => {
    const { quoteId } = await run(() => createQuote(tenantA.context, { serviceOrderId: ordemId }));

    for (const items of [
      [{ kind: 'service' as const, description: 'Negativo', quantity: '1', unitPrice: '-10.00' }],
      [{ kind: 'service' as const, description: 'Zero', quantity: '0', unitPrice: '10.00' }],
      [
        {
          kind: 'service' as const,
          description: 'Desconto grande',
          quantity: '1',
          unitPrice: '10.00',
          discount: '20.00',
        },
      ],
    ]) {
      await expect(run(() => saveQuoteDraft(tenantA.context, quoteId, { items }))).rejects.toThrow(
        ValidationError,
      );
    }
  });

  it('desconto global maior que o subtotal e recusado', async () => {
    const { quoteId } = await run(() => createQuote(tenantA.context, { serviceOrderId: ordemId }));
    await expect(
      run(() =>
        saveQuoteDraft(tenantA.context, quoteId, { items: itensPadrao, discount: '1000.00' }),
      ),
    ).rejects.toThrow(ValidationError);
  });

  it('descricao e obrigatoria, sem depender de catalogo (item 33)', async () => {
    const { quoteId } = await run(() => createQuote(tenantA.context, { serviceOrderId: ordemId }));
    await expect(
      run(() =>
        saveQuoteDraft(tenantA.context, quoteId, {
          items: [{ kind: 'part', description: '  ', quantity: '1', unitPrice: '10.00' }],
        }),
      ),
    ).rejects.toThrow(ValidationError);
  });

  it('salvar o rascunho de novo SUBSTITUI a lista, sem duplicar linhas', async () => {
    const { quoteId } = await run(() => createQuote(tenantA.context, { serviceOrderId: ordemId }));
    await run(() => saveQuoteDraft(tenantA.context, quoteId, { items: itensPadrao }));
    await run(() =>
      saveQuoteDraft(tenantA.context, quoteId, {
        items: [{ kind: 'service', description: 'So isto', quantity: '1', unitPrice: '50.00' }],
      }),
    );

    const linhas = await getDb().select().from(quoteItems);
    expect(linhas).toHaveLength(1);
    expect((await quoteRow(quoteId)).total).toBe('50.00');
  });
});

// ---------------------------------------------------------------------------
// Envio e integracao com o workflow
// ---------------------------------------------------------------------------

describe('envio (itens 18, 53 e 62)', () => {
  it('envia o orcamento E move a OS para Aguardando Aprovacao, numa transacao so', async () => {
    const quoteId = await orcamentoComItens();
    expect(await statusOS(ordemId)).toBe('awaiting_technical_opinion');

    await run(() => sendQuote(tenantA.context, quoteId));

    const row = await quoteRow(quoteId);
    expect(row.status).toBe('sent');
    expect(row.sentAt).toBeInstanceOf(Date);
    expect(row.sentBy).toBe(tenantA.adminUserId);

    expect(await statusOS(ordemId)).toBe('awaiting_approval');
  });

  it('o texto do historico NAO diz que uma mensagem foi enviada (itens 53 e 152)', async () => {
    const quoteId = await orcamentoComItens();
    await run(() => sendQuote(tenantA.context, quoteId));

    const [entrada] = await getDb()
      .select()
      .from(quoteTimeline)
      .where(and(eq(quoteTimeline.quoteId, quoteId), eq(quoteTimeline.kind, 'sent')));

    expect(entrada!.summary).toContain('envio automatico da mensagem ainda nao esta disponivel');
    expect(entrada!.summary).not.toMatch(/whatsapp|e-mail|mensagem enviada/i);
  });

  it('o evento QUOTE_SENT declara delivered: false (item 54)', async () => {
    const quoteId = await orcamentoComItens();
    await run(() => sendQuote(tenantA.context, quoteId));

    const [evento] = await getDb()
      .select()
      .from(domainEvents)
      .where(eq(domainEvents.type, 'QUOTE_SENT'));

    expect(evento!.payload).toMatchObject({ quoteId, delivered: false, to: 'sent' });
  });

  it('a ficha da OS ganha o fato resumido, nao a lista de itens (item 59)', async () => {
    const quoteId = await orcamentoComItens();
    await run(() => sendQuote(tenantA.context, quoteId));

    const fatos = await getDb()
      .select()
      .from(serviceOrderTimeline)
      .where(
        and(
          eq(serviceOrderTimeline.serviceOrderId, ordemId),
          eq(serviceOrderTimeline.kind, 'quote_sent'),
        ),
      );

    expect(fatos).toHaveLength(1);
    expect(fatos[0]!.summary).toContain('ORC #');
    // O detalhe comercial fica no orcamento, nao no historico do aparelho.
    expect(fatos[0]!.summary).not.toContain('Fonte chaveada');
  });

  it('orcamento SEM ITENS nao pode ser enviado (item 18)', async () => {
    const { quoteId } = await run(() => createQuote(tenantA.context, { serviceOrderId: ordemId }));
    await expect(run(() => sendQuote(tenantA.context, quoteId))).rejects.toThrow(BusinessRuleError);
    expect(await statusOS(ordemId)).toBe('awaiting_technical_opinion');
  });

  it('OS em estado INCOMPATIVEL recusa o envio, e NADA e gravado (itens 19 e 63)', async () => {
    // Leva a OS para Aguardando Conserto: de la nao se vai para aprovacao.
    await run(() =>
      transitionServiceOrder(tenantA.context, { serviceOrderId: ordemId, to: 'awaiting_repair' }),
    );

    const quoteId = await orcamentoComItens();
    await expect(run(() => sendQuote(tenantA.context, quoteId))).rejects.toThrow(BusinessRuleError);

    // O orcamento NAO ficou "enviado" com a OS parada.
    expect((await quoteRow(quoteId)).status).toBe('draft');
    expect(await statusOS(ordemId)).toBe('awaiting_repair');
    expect(
      await getDb().select().from(domainEvents).where(eq(domainEvents.type, 'QUOTE_SENT')),
    ).toHaveLength(0);
  });

  it('enviado duas vezes: a segunda e recusada (item 95)', async () => {
    const quoteId = await orcamentoComItens();
    await run(() => sendQuote(tenantA.context, quoteId));
    await expect(run(() => sendQuote(tenantA.context, quoteId))).rejects.toThrow(BusinessRuleError);
  });

  it('nao se edita mais os valores depois de enviado (itens 27 e 28)', async () => {
    const quoteId = await orcamentoComItens();
    await run(() => sendQuote(tenantA.context, quoteId));

    await expect(
      run(() =>
        saveQuoteDraft(tenantA.context, quoteId, {
          items: [
            { kind: 'service', description: 'Outro valor', quantity: '1', unitPrice: '1.00' },
          ],
        }),
      ),
    ).rejects.toThrow(BusinessRuleError);

    expect((await quoteRow(quoteId)).total).toBe('309.90');
  });
});

// ---------------------------------------------------------------------------
// Aprovacao e recusa
// ---------------------------------------------------------------------------

describe('aprovacao (itens 20, 50 a 52 e 61)', () => {
  it('aprova e leva a OS para Aguardando Conserto', async () => {
    const quoteId = await orcamentoComItens();
    await run(() => sendQuote(tenantA.context, quoteId));
    await run(() => approveQuote(tenantA.context, quoteId));

    const row = await quoteRow(quoteId);
    expect(row.status).toBe('approved');
    expect(row.decidedAt).toBeInstanceOf(Date);
    expect(row.decidedBy).toBe(tenantA.adminUserId);
    // Origem HONESTA: foi a equipe que registrou, nao o cliente num portal.
    expect(row.decisionSource).toBe('internal');

    expect(await statusOS(ordemId)).toBe('awaiting_repair');
  });

  it('o total aprovado fica congelado no registro (item 28)', async () => {
    const quoteId = await orcamentoComItens();
    await run(() => sendQuote(tenantA.context, quoteId));
    await run(() => approveQuote(tenantA.context, quoteId));

    const detalhe = await run(() => findQuoteDetail(tenantA.context, quoteId));
    expect(detalhe!.quote.total).toBe('309.90');
    expect(detalhe!.items).toHaveLength(2);
  });

  it('aprovar um rascunho e recusado', async () => {
    const quoteId = await orcamentoComItens();
    await expect(run(() => approveQuote(tenantA.context, quoteId))).rejects.toThrow(
      BusinessRuleError,
    );
  });

  it('duas aprovacoes SIMULTANEAS: so uma vence (item 97)', async () => {
    const quoteId = await orcamentoComItens();
    await run(() => sendQuote(tenantA.context, quoteId));

    const resultados = await Promise.allSettled([
      run(() => approveQuote(tenantA.context, quoteId)),
      run(() => approveQuote(tenantA.context, quoteId)),
    ]);

    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await quoteRow(quoteId)).status).toBe('approved');
    expect(await statusOS(ordemId)).toBe('awaiting_repair');

    // E um unico fato na linha do tempo da OS.
    const fatos = await getDb()
      .select()
      .from(serviceOrderTimeline)
      .where(eq(serviceOrderTimeline.kind, 'status_changed'));
    expect(fatos.filter((f) => f.summary?.includes('Aguardando Conserto'))).toHaveLength(1);
  });
});

describe('recusa (item 21)', () => {
  it('recusa exige motivo, registra e NAO cancela a Ordem de Servico', async () => {
    const quoteId = await orcamentoComItens();
    await run(() => sendQuote(tenantA.context, quoteId));

    await expect(run(() => rejectQuote(tenantA.context, quoteId, { reason: '' }))).rejects.toThrow(
      ValidationError,
    );

    await run(() =>
      rejectQuote(tenantA.context, quoteId, { reason: 'Cliente achou caro demais.' }),
    );

    const row = await quoteRow(quoteId);
    expect(row.status).toBe('rejected');
    expect(row.decisionReason).toBe('Cliente achou caro demais.');

    // A OS continua aguardando: o que fazer com o aparelho e decisao de gente.
    expect(await statusOS(ordemId)).toBe('awaiting_approval');
  });

  it('o motivo chega a ficha do orcamento, e nao so ao banco', async () => {
    const quoteId = await orcamentoComItens();
    await run(() => sendQuote(tenantA.context, quoteId));
    await run(() =>
      rejectQuote(tenantA.context, quoteId, { reason: 'Vai consertar noutro lugar.' }),
    );

    const detalhe = await run(() => findQuoteDetail(tenantA.context, quoteId));
    const entrada = detalhe!.timeline.find((item) => item.kind === 'rejected');
    expect(entrada?.reason).toBe('Vai consertar noutro lugar.');
  });
});

describe('cancelamento do orcamento (item 69)', () => {
  it('cancelar o ORCAMENTO nao cancela a ORDEM DE SERVICO', async () => {
    const quoteId = await orcamentoComItens();
    await run(() => cancelQuote(tenantA.context, quoteId));

    expect((await quoteRow(quoteId)).status).toBe('cancelled');
    expect(await statusOS(ordemId)).toBe('awaiting_technical_opinion');
  });
});

// ---------------------------------------------------------------------------
// Revisao
// ---------------------------------------------------------------------------

describe('revisao (itens 25 a 28, 64, 67 e 68)', () => {
  it('a revisao nasce como rascunho com o MESMO numero e a versao anterior INTACTA', async () => {
    const quoteId = await orcamentoComItens();
    await run(() => sendQuote(tenantA.context, quoteId));

    const revisao = await run(() => reviseQuote(tenantA.context, quoteId));

    expect(revisao.revision).toBe(2);
    const anterior = await quoteRow(quoteId);
    const nova = await quoteRow(revisao.quoteId);

    // O numero e o mesmo: para o cliente, e o mesmo orcamento.
    expect(nova.number).toBe(anterior.number);
    expect(nova.status).toBe('draft');
    expect(nova.supersedesQuoteId).toBe(quoteId);

    // A ANTERIOR NAO FOI APAGADA NEM REESCRITA nos valores.
    expect(anterior.status).toBe('superseded');
    expect(anterior.total).toBe('309.90');
  });

  it('os itens sao copiados e podem ser alterados sem tocar na versao anterior (item 129)', async () => {
    const quoteId = await orcamentoComItens();
    await run(() => sendQuote(tenantA.context, quoteId));
    const revisao = await run(() => reviseQuote(tenantA.context, quoteId));

    await run(() =>
      saveQuoteDraft(tenantA.context, revisao.quoteId, {
        items: [
          { kind: 'service', description: 'Valor renegociado', quantity: '1', unitPrice: '250.00' },
        ],
      }),
    );

    expect((await quoteRow(revisao.quoteId)).total).toBe('250.00');
    // A proposta que o cliente viu continua valendo o que valia.
    expect((await quoteRow(quoteId)).total).toBe('309.90');
  });

  it('revisao apos RECUSA e permitida, e a recusa permanece no historico (item 67)', async () => {
    const quoteId = await orcamentoComItens();
    await run(() => sendQuote(tenantA.context, quoteId));
    await run(() => rejectQuote(tenantA.context, quoteId, { reason: 'Caro.' }));

    const revisao = await run(() => reviseQuote(tenantA.context, quoteId));
    expect(revisao.revision).toBe(2);

    // A recusa do cliente e fato historico: nao vira "substituido".
    expect((await quoteRow(quoteId)).status).toBe('rejected');
  });

  it('enviar a revisao com a OS ja em Aguardando Aprovacao nao duplica a transicao', async () => {
    const quoteId = await orcamentoComItens();
    await run(() => sendQuote(tenantA.context, quoteId));
    await run(() => rejectQuote(tenantA.context, quoteId, { reason: 'Caro.' }));

    const revisao = await run(() => reviseQuote(tenantA.context, quoteId));
    await run(() => sendQuote(tenantA.context, revisao.quoteId));

    expect(await statusOS(ordemId)).toBe('awaiting_approval');

    const transicoes = await getDb()
      .select()
      .from(serviceOrderTimeline)
      .where(eq(serviceOrderTimeline.kind, 'status_changed'));
    expect(transicoes).toHaveLength(1);
  });

  it('nao se cria revisao de um rascunho: edita-se o proprio rascunho', async () => {
    const quoteId = await orcamentoComItens();
    await expect(run(() => reviseQuote(tenantA.context, quoteId))).rejects.toThrow(
      BusinessRuleError,
    );
  });

  it('a listagem identifica qual e a proposta VIGENTE (item 65)', async () => {
    const quoteId = await orcamentoComItens();
    await run(() => sendQuote(tenantA.context, quoteId));
    const revisao = await run(() => reviseQuote(tenantA.context, quoteId));

    const lista = await run(() => listQuotesForServiceOrder(tenantA.context, ordemId));
    expect(lista).toHaveLength(2);
    const ativos = lista.filter((item) => item.isActive);
    expect(ativos).toHaveLength(1);
    expect(ativos[0]!.id).toBe(revisao.quoteId);
  });
});

// ---------------------------------------------------------------------------
// Concorrencia na edicao
// ---------------------------------------------------------------------------

describe('concorrencia no rascunho (item 96)', () => {
  it('versao antiga na mao perde a corrida, com aviso', async () => {
    const { quoteId } = await run(() => createQuote(tenantA.context, { serviceOrderId: ordemId }));
    const versaoLida = (await quoteRow(quoteId)).version;

    await run(() => saveQuoteDraft(tenantA.context, quoteId, { items: itensPadrao }, versaoLida));

    await expect(
      run(() =>
        saveQuoteDraft(
          tenantA.context,
          quoteId,
          { items: [{ kind: 'service', description: 'Outro', quantity: '1', unitPrice: '5.00' }] },
          versaoLida,
        ),
      ),
    ).rejects.toThrow(ConflictError);

    expect((await quoteRow(quoteId)).total).toBe('309.90');
  });
});

// ---------------------------------------------------------------------------
// Rastro
// ---------------------------------------------------------------------------

describe('auditoria e eventos (itens 55 a 60)', () => {
  it('cada decisao deixa auditoria, linha do tempo e evento', async () => {
    const quoteId = await orcamentoComItens();
    await run(() => sendQuote(tenantA.context, quoteId));
    await run(() => approveQuote(tenantA.context, quoteId));

    const acoes = (await getDb().select().from(auditLogs)).map((row) => row.action);
    expect(acoes).toEqual(
      expect.arrayContaining(['quote.created', 'quote.sent', 'quote.approved']),
    );

    const tipos = (await getDb().select().from(domainEvents)).map((row) => row.type);
    expect(tipos).toEqual(
      expect.arrayContaining(['QUOTE_CREATED', 'QUOTE_SENT', 'QUOTE_APPROVED']),
    );

    const fatos = (
      await getDb().select().from(quoteTimeline).where(eq(quoteTimeline.quoteId, quoteId))
    ).map((row) => row.kind);
    expect(fatos).toEqual(expect.arrayContaining(['created', 'items_updated', 'sent', 'approved']));
  });

  it('o evento NAO carrega o relato do cliente nem nome de ninguem', async () => {
    const quoteId = await orcamentoComItens();
    await run(() => sendQuote(tenantA.context, quoteId));

    const [evento] = await getDb()
      .select()
      .from(domainEvents)
      .where(eq(domainEvents.type, 'QUOTE_SENT'));

    const texto = JSON.stringify(evento!.payload);
    expect(texto).not.toContain('Nao liga');
    expect(texto).not.toContain('Cliente do orcamento');
  });
});

// ---------------------------------------------------------------------------
// Isolamento
// ---------------------------------------------------------------------------

describe('isolamento por empresa e unidade (itens 73, 74, 122 e 123)', () => {
  it('orcamento de outra empresa nao e encontrado, nem para ler nem para decidir', async () => {
    const ordemB = await abrirOrdem(tenantB);
    const quoteB = await orcamentoComItens(tenantB, ordemB);

    expect(await run(() => findQuoteDetail(tenantA.context, quoteB))).toBeNull();
    await expect(run(() => sendQuote(tenantA.context, quoteB))).rejects.toThrow(NotFoundError);
    await expect(run(() => approveQuote(tenantA.context, quoteB))).rejects.toThrow(NotFoundError);
  });

  it('orcamento de outra unidade da MESMA empresa tambem nao e alcancavel', async () => {
    const quoteId = await orcamentoComItens();

    const outraUnidade = await createUnit(tenantA.tenantId, 'Norte');
    const soNorte = await createPlainUser(tenantA.tenantId, 'norte@orc-a.invalid', 'Opera o Norte');
    await grantMembership(tenantA.tenantId, soNorte, outraUnidade);
    const contexto = await contextFor(tenantA.tenantId, soNorte, outraUnidade);

    expect(await run(() => findQuoteDetail(contexto, quoteId))).toBeNull();
    await expect(run(() => sendQuote(contexto, quoteId))).rejects.toThrow(NotFoundError);
    expect(await run(() => listQuotesForServiceOrder(contexto, ordemId))).toEqual([]);
  });
});
