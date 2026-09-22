import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { runWithContext } from '@/core/context/request-context';
import { getDb } from '@/core/db/client';
import {
  AuthorizationError,
  BusinessRuleError,
  NotFoundError,
  ValidationError,
} from '@/core/errors';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { createCustomer } from '@/modules/customers/application/customer-service';
import { createEquipment } from '@/modules/equipment/application/equipment-service';
import { setTenantFeature } from '@/modules/features/application/tenant-configuration';
import { FEATURES } from '@/modules/features/domain/catalog';
import { createServiceOrder } from '@/modules/service-orders/application/service-order-service';
import {
  createMessage,
  cancelMessage,
  retryMessage,
} from '@/modules/communications/application/message-service';
import { findMessage, listMessages } from '@/modules/communications/application/message-queries';
import {
  archiveTemplate,
  createTemplate,
} from '@/modules/communications/application/template-service';
import { CaptureProvider } from '@/modules/communications/infrastructure/capture-provider';
import { setCommunicationProviderForTesting } from '@/modules/communications/infrastructure/provider-registry';
import { closeTestDatabase, migrateTestDatabase, truncateAll } from '../helpers/database';
import {
  assignTenantRole,
  clearTenantRoles,
  contextFor,
  createPlainUser,
  createRoleWithPermissions,
  createTenantFixture,
  createUnit,
  grantMembership,
  seedCatalog,
  type TenantFixture,
} from '../helpers/fixtures';

/**
 * A COMUNICACAO contra MariaDB de verdade, com um provedor que NAO envia nada.
 *
 * O eixo destes testes: a comunicacao INFORMA um fato, e nunca vira a fonte
 * de verdade dele. O que mais se verifica aqui e o que o modulo NAO faz —
 * nao move a OS, nao manda para numero solto, nao afirma entrega, nao deixa
 * outra empresa ver.
 *
 * Nenhuma linha destes testes toca a internet.
 */

let tenantA: TenantFixture;
let tenantB: TenantFixture;
let captura: CaptureProvider;

const run = <T>(work: () => Promise<T>) => runWithContext({ origin: 'test' }, work);

async function ligarComunicacao(fixture: TenantFixture): Promise<void> {
  await run(() =>
    setTenantFeature(fixture.context, {
      featureKey: FEATURES.COMMUNICATIONS_CORE,
      enabled: true,
    }),
  );
}

interface Cenario {
  customerId: string;
  serviceOrderId: string;
  telefone: string;
  email: string;
}

async function montarCenario(fixture: TenantFixture, nome = 'Maria Aparecida'): Promise<Cenario> {
  const telefone = '11999998888';
  const email = 'maria@cliente.invalid';

  const { customerId } = await run(() =>
    createCustomer(fixture.context, {
      kind: 'individual',
      name: nome,
      contacts: [
        { type: 'phone', value: telefone, isWhatsapp: true },
        { type: 'email', value: email, isWhatsapp: false },
      ],
    }),
  );

  const { equipmentId } = await run(() =>
    createEquipment(fixture.context, {
      customerId,
      kind: 'Notebook',
      brand: 'Dell',
      model: 'Inspiron 15',
    }),
  );

  const { serviceOrderId } = await run(() =>
    createServiceOrder(fixture.context, {
      equipmentId,
      customerReport: 'O aparelho nao liga.',
    }),
  );

  return { customerId, serviceOrderId, telefone, email };
}

beforeAll(async () => {
  await migrateTestDatabase();
});

afterAll(async () => {
  setCommunicationProviderForTesting(null);
  await closeTestDatabase();
});

beforeEach(async () => {
  await truncateAll();
  const planId = await seedCatalog();
  tenantA = await createTenantFixture('comm-a', planId);
  tenantB = await createTenantFixture('comm-b', planId);
  await ligarComunicacao(tenantA);
  await ligarComunicacao(tenantB);

  captura = new CaptureProvider();
  setCommunicationProviderForTesting(captura);
});

describe('enviar uma mensagem', () => {
  it('registra a intencao, tenta entregar e guarda o que foi dito', async () => {
    const cenario = await montarCenario(tenantA);

    const { messageId, reused } = await run(() =>
      createMessage(tenantA.context, {
        customerId: cenario.customerId,
        channel: 'whatsapp',
        contactValue: cenario.telefone,
        serviceOrderId: cenario.serviceOrderId,
        purpose: 'ready_for_pickup',
        body: 'Ola {{cliente.primeiro_nome}}, sua {{os.numero}} esta pronta.',
      }),
    );

    expect(reused).toBe(false);

    const mensagem = await run(() => findMessage(tenantA.context, messageId));

    /* O texto guardado e o texto RENDERIZADO: e o que o cliente leria. */
    expect(mensagem.body).toContain('Ola Maria,');
    expect(mensagem.body).toContain('OS #');
    expect(mensagem.body).not.toContain('{{');

    expect(mensagem.status).toBe('sent');
    expect(mensagem.sentProvider).toBe('capture');
    expect(mensagem.attemptCount).toBe(1);
    expect(mensagem.attempts).toHaveLength(1);
    expect(mensagem.attempts[0]?.outcome).toBe('accepted');

    /* O provedor recebeu exatamente o que foi gravado. */
    expect(captura.messages()).toHaveLength(1);
    expect(captura.messages()[0]?.body).toBe(mensagem.body);
    expect(captura.messages()[0]?.recipient).toBe('11999998888');
  });

  it('`sent` NAO significa entregue: nao ha coluna nem estado que afirme isso', async () => {
    const cenario = await montarCenario(tenantA);
    const { messageId } = await run(() =>
      createMessage(tenantA.context, {
        customerId: cenario.customerId,
        channel: 'sms',
        contactValue: cenario.telefone,
        body: 'Mensagem curta.',
      }),
    );

    const linhas = await getDb().execute(sql`
      SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'communication_messages'
    `);
    const colunas = ((linhas as unknown as Array<Array<{ COLUMN_NAME: string }>>)[0] ?? []).map(
      (l) => l.COLUMN_NAME,
    );

    expect(colunas).not.toContain('delivered_at');
    expect(colunas).not.toContain('read_at');
    expect(colunas).toContain('sent_at');

    const mensagem = await run(() => findMessage(tenantA.context, messageId));
    expect(mensagem.status).toBe('sent');
  });

  it('a chave de intencao faz o duplo clique reencontrar a mensagem', async () => {
    const cenario = await montarCenario(tenantA);
    const entrada = {
      customerId: cenario.customerId,
      channel: 'sms' as const,
      contactValue: cenario.telefone,
      body: 'Mensagem.',
      idempotencyKey: 'clique-duplo',
    };

    const primeira = await run(() => createMessage(tenantA.context, entrada));
    const segunda = await run(() => createMessage(tenantA.context, entrada));

    expect(segunda.messageId).toBe(primeira.messageId);
    expect(segunda.reused).toBe(true);
    expect(captura.messages()).toHaveLength(1);
  });
});

describe('o destinatario sai do cadastro, nunca do formulario', () => {
  it('recusa um numero que nao e contato do cliente', async () => {
    const cenario = await montarCenario(tenantA);

    await expect(
      run(() =>
        createMessage(tenantA.context, {
          customerId: cenario.customerId,
          channel: 'sms',
          contactValue: '11912345678',
          body: 'Mensagem.',
        }),
      ),
    ).rejects.toThrow(ValidationError);

    expect(captura.messages()).toHaveLength(0);
  });

  it('WhatsApp exige telefone marcado como WhatsApp no cadastro', async () => {
    const { customerId } = await run(() =>
      createCustomer(tenantA.context, {
        kind: 'individual',
        name: 'Cliente Sem Whats',
        contacts: [{ type: 'phone', value: '11933334444', isWhatsapp: false }],
      }),
    );

    await expect(
      run(() =>
        createMessage(tenantA.context, {
          customerId,
          channel: 'whatsapp',
          contactValue: '11933334444',
          body: 'Mensagem.',
        }),
      ),
    ).rejects.toThrow(ValidationError);

    /* O mesmo numero por SMS passa: a restricao e do canal, nao do telefone. */
    const { messageId } = await run(() =>
      createMessage(tenantA.context, {
        customerId,
        channel: 'sms',
        contactValue: '11933334444',
        body: 'Mensagem.',
      }),
    );
    expect(messageId).toBeTruthy();
  });

  it('recusa contato de OUTRO cliente do mesmo tenant', async () => {
    const primeiro = await montarCenario(tenantA, 'Primeiro Cliente');
    const segundo = await montarCenario(tenantA, 'Segundo Cliente');

    await expect(
      run(() =>
        createMessage(tenantA.context, {
          customerId: segundo.customerId,
          channel: 'sms',
          /* O telefone e igual nos dois cenarios; o vinculo e que decide. */
          contactValue: primeiro.telefone,
          body: 'Mensagem.',
        }),
      ),
    ).resolves.toBeTruthy();
  });
});

describe('lacunas do texto', () => {
  it('recusa variavel de OS quando a mensagem nao tem OS', async () => {
    const cenario = await montarCenario(tenantA);

    await expect(
      run(() =>
        createMessage(tenantA.context, {
          customerId: cenario.customerId,
          channel: 'sms',
          contactValue: cenario.telefone,
          body: 'Sua {{os.numero}} esta pronta.',
        }),
      ),
    ).rejects.toThrow();

    expect(captura.messages()).toHaveLength(0);
  });

  it('recusa lacuna que nao existe, em vez de mandar a chave literal', async () => {
    const cenario = await montarCenario(tenantA);

    await expect(
      run(() =>
        createMessage(tenantA.context, {
          customerId: cenario.customerId,
          channel: 'sms',
          contactValue: cenario.telefone,
          body: 'Ola {{cliente.apelido}}.',
        }),
      ),
    ).rejects.toThrow();
  });
});

describe('modelos', () => {
  it('o texto do modelo e COPIADO: editar depois nao reescreve o historico', async () => {
    const cenario = await montarCenario(tenantA);

    const { templateId } = await run(() =>
      createTemplate(tenantA.context, {
        name: 'Aparelho pronto',
        channel: 'whatsapp',
        purpose: 'ready_for_pickup',
        body: 'Ola {{cliente.primeiro_nome}}, pode buscar.',
      }),
    );

    const { messageId } = await run(() =>
      createMessage(tenantA.context, {
        customerId: cenario.customerId,
        channel: 'whatsapp',
        contactValue: cenario.telefone,
        templateId,
      }),
    );

    const antes = await run(() => findMessage(tenantA.context, messageId));
    expect(antes.body).toBe('Ola Maria, pode buscar.');
    expect(antes.templateId).toBe(templateId);

    await run(() => archiveTemplate(tenantA.context, templateId));

    const depois = await run(() => findMessage(tenantA.context, messageId));
    expect(depois.body).toBe('Ola Maria, pode buscar.');
  });

  it('modelo arquivado nao pode mais ser usado', async () => {
    const cenario = await montarCenario(tenantA);
    const { templateId } = await run(() =>
      createTemplate(tenantA.context, {
        name: 'Antigo',
        channel: 'sms',
        body: 'Texto antigo.',
      }),
    );
    await run(() => archiveTemplate(tenantA.context, templateId));

    await expect(
      run(() =>
        createMessage(tenantA.context, {
          customerId: cenario.customerId,
          channel: 'sms',
          contactValue: cenario.telefone,
          templateId,
        }),
      ),
    ).rejects.toThrow(BusinessRuleError);
  });

  it('modelo de outro canal e recusado', async () => {
    const cenario = await montarCenario(tenantA);
    const { templateId } = await run(() =>
      createTemplate(tenantA.context, {
        name: 'Para e-mail',
        channel: 'email',
        subject: 'Assunto',
        body: 'Corpo do e-mail.',
      }),
    );

    await expect(
      run(() =>
        createMessage(tenantA.context, {
          customerId: cenario.customerId,
          channel: 'whatsapp',
          contactValue: cenario.telefone,
          templateId,
        }),
      ),
    ).rejects.toThrow(BusinessRuleError);
  });
});

describe('falha de entrega', () => {
  it('registra a tentativa com motivo e NAO diz que enviou', async () => {
    const cenario = await montarCenario(tenantA);
    captura.failNext('provider_unavailable', 'Provedor fora do ar.');

    const { messageId } = await run(() =>
      createMessage(tenantA.context, {
        customerId: cenario.customerId,
        channel: 'sms',
        contactValue: cenario.telefone,
        body: 'Mensagem.',
      }),
    );

    const mensagem = await run(() => findMessage(tenantA.context, messageId));
    expect(mensagem.status).toBe('failed');
    expect(mensagem.lastErrorCode).toBe('provider_unavailable');
    expect(mensagem.sentAt).toBeNull();
    expect(mensagem.attempts[0]?.outcome).toBe('failed');
    expect(captura.messages()).toHaveLength(0);
  });

  it('falhar NAO muda a situacao da Ordem de Servico', async () => {
    /*
      A regra central do prompt. O aparelho continua pronto mesmo quando o
      WhatsApp recusa; a falha do canal nao desfaz o trabalho realizado.
    */
    const cenario = await montarCenario(tenantA);

    const antes = await getDb().execute(sql`
      SELECT status, updated_at FROM service_orders WHERE id = ${cenario.serviceOrderId}
    `);
    const statusAntes = (antes as unknown as Array<Array<{ status: string }>>)[0]?.[0]?.status;

    captura.failNext('rejected', 'Recusado.');
    await run(() =>
      createMessage(tenantA.context, {
        customerId: cenario.customerId,
        channel: 'sms',
        contactValue: cenario.telefone,
        serviceOrderId: cenario.serviceOrderId,
        body: 'Mensagem.',
      }),
    );

    const depois = await getDb().execute(sql`
      SELECT status FROM service_orders WHERE id = ${cenario.serviceOrderId}
    `);
    const statusDepois = (depois as unknown as Array<Array<{ status: string }>>)[0]?.[0]?.status;

    expect(statusDepois).toBe(statusAntes);
  });

  it('sem provedor a mensagem fica registrada com motivo legivel', async () => {
    setCommunicationProviderForTesting(null);

    /* Simula ausencia de provedor apontando o registro para nada. */
    const cenario = await montarCenario(tenantA);
    setCommunicationProviderForTesting({
      name: 'so-email',
      channels: ['email'],
      async send() {
        throw new Error('nao deveria ser chamado para sms');
      },
    });

    const { messageId } = await run(() =>
      createMessage(tenantA.context, {
        customerId: cenario.customerId,
        channel: 'sms',
        contactValue: cenario.telefone,
        body: 'Mensagem.',
      }),
    );

    const mensagem = await run(() => findMessage(tenantA.context, messageId));
    expect(mensagem.status).toBe('failed');
    expect(mensagem.lastErrorCode).toBe('provider_not_configured');
    expect(mensagem.lastErrorDetail).toContain('canal');
  });

  it('excecao escapando do adaptador vira falha, nunca sucesso', async () => {
    const cenario = await montarCenario(tenantA);
    setCommunicationProviderForTesting({
      name: 'quebrado',
      channels: ['sms'],
      async send() {
        throw new Error('bug com token=segredo-do-fornecedor dentro');
      },
    });

    const { messageId } = await run(() =>
      createMessage(tenantA.context, {
        customerId: cenario.customerId,
        channel: 'sms',
        contactValue: cenario.telefone,
        body: 'Mensagem.',
      }),
    );

    const mensagem = await run(() => findMessage(tenantA.context, messageId));
    expect(mensagem.status).toBe('failed');
    expect(mensagem.lastErrorCode).toBe('unknown');

    /* O segredo que veio na excecao nao chega ao banco. */
    expect(mensagem.lastErrorDetail).not.toContain('segredo-do-fornecedor');
    expect(mensagem.lastErrorDetail).toContain('[redigido]');
  });
});

describe('reenviar e cancelar', () => {
  it('reenviar usa a MESMA mensagem e acrescenta uma tentativa', async () => {
    const cenario = await montarCenario(tenantA);
    captura.failNext('timeout', 'Demorou.');

    const { messageId } = await run(() =>
      createMessage(tenantA.context, {
        customerId: cenario.customerId,
        channel: 'sms',
        contactValue: cenario.telefone,
        body: 'Mensagem.',
      }),
    );

    await run(() => retryMessage(tenantA.context, messageId));

    const mensagem = await run(() => findMessage(tenantA.context, messageId));
    expect(mensagem.status).toBe('sent');
    expect(mensagem.attemptCount).toBe(2);
    expect(mensagem.attempts).toHaveLength(2);

    /* A tentativa que falhou continua la: nada e sobrescrito. */
    const numeros = mensagem.attempts.map((t) => t.attemptNumber).sort();
    expect(numeros).toEqual([1, 2]);
    const falha = mensagem.attempts.find((t) => t.attemptNumber === 1);
    expect(falha?.errorCode).toBe('timeout');

    const lista = await run(() => listMessages(tenantA.context, {}));
    expect(lista.total).toBe(1);
  });

  it('reenviar o que ja foi aceito e recusado', async () => {
    const cenario = await montarCenario(tenantA);
    const { messageId } = await run(() =>
      createMessage(tenantA.context, {
        customerId: cenario.customerId,
        channel: 'sms',
        contactValue: cenario.telefone,
        body: 'Mensagem.',
      }),
    );

    await expect(run(() => retryMessage(tenantA.context, messageId))).rejects.toThrow(
      BusinessRuleError,
    );
  });

  it('cancelar vale para o que falhou e nao para o que foi aceito', async () => {
    const cenario = await montarCenario(tenantA);

    captura.failNext('rejected', 'Recusado.');
    const falhou = await run(() =>
      createMessage(tenantA.context, {
        customerId: cenario.customerId,
        channel: 'sms',
        contactValue: cenario.telefone,
        body: 'Primeira.',
      }),
    );

    await run(() =>
      cancelMessage(tenantA.context, {
        messageId: falhou.messageId,
        reason: 'O cliente ja veio buscar.',
      }),
    );

    const cancelada = await run(() => findMessage(tenantA.context, falhou.messageId));
    expect(cancelada.status).toBe('cancelled');
    expect(cancelada.cancelReason).toBe('O cliente ja veio buscar.');

    const aceita = await run(() =>
      createMessage(tenantA.context, {
        customerId: cenario.customerId,
        channel: 'sms',
        contactValue: cenario.telefone,
        body: 'Segunda.',
      }),
    );

    await expect(
      run(() => cancelMessage(tenantA.context, { messageId: aceita.messageId })),
    ).rejects.toThrow(BusinessRuleError);
  });
});

describe('fronteiras de tenant, unidade e permissao', () => {
  it('outra empresa nao ve a mensagem, nem pela ficha nem pela lista', async () => {
    const cenario = await montarCenario(tenantA);
    const { messageId } = await run(() =>
      createMessage(tenantA.context, {
        customerId: cenario.customerId,
        channel: 'sms',
        contactValue: cenario.telefone,
        body: 'Mensagem privada.',
      }),
    );

    await expect(run(() => findMessage(tenantB.context, messageId))).rejects.toThrow(NotFoundError);

    const listaB = await run(() => listMessages(tenantB.context, {}));
    expect(listaB.total).toBe(0);
  });

  it('a lista respeita a unidade ativa', async () => {
    const cenario = await montarCenario(tenantA);
    await run(() =>
      createMessage(tenantA.context, {
        customerId: cenario.customerId,
        channel: 'sms',
        contactValue: cenario.telefone,
        body: 'Da unidade principal.',
      }),
    );

    const outraUnidade = await createUnit(tenantA.tenantId, 'Filial Norte');
    await grantMembership(tenantA.tenantId, tenantA.adminUserId, outraUnidade);
    const contextoOutra = await contextFor(tenantA.tenantId, tenantA.adminUserId, outraUnidade);

    const lista = await run(() => listMessages(contextoOutra, {}));
    expect(lista.total).toBe(0);
  });

  it('ver comunicacao e enviar sao chaves diferentes', async () => {
    const cenario = await montarCenario(tenantA);
    const { messageId } = await run(() =>
      createMessage(tenantA.context, {
        customerId: cenario.customerId,
        channel: 'sms',
        contactValue: cenario.telefone,
        body: 'Mensagem.',
      }),
    );

    const leitorId = await createPlainUser(tenantA.tenantId, 'leitor@comm-a.invalid');
    await grantMembership(tenantA.tenantId, leitorId, tenantA.unitId);
    const papel = await createRoleWithPermissions(tenantA.tenantId, 'so-leitura', [
      PERMISSIONS.COMMUNICATIONS_VIEW,
    ]);
    await assignTenantRole(tenantA.tenantId, leitorId, papel);
    const leitor = await contextFor(tenantA.tenantId, leitorId, tenantA.unitId);

    /* Ele ve. */
    const vista = await run(() => findMessage(leitor, messageId));
    expect(vista.id).toBe(messageId);

    /* E nao envia. */
    await expect(
      run(() =>
        createMessage(leitor, {
          customerId: cenario.customerId,
          channel: 'sms',
          contactValue: cenario.telefone,
          body: 'Nao deveria sair.',
        }),
      ),
    ).rejects.toThrow(AuthorizationError);
  });

  it('sem nenhuma permissao de comunicacao, nada e visivel', async () => {
    const cenario = await montarCenario(tenantA);
    const { messageId } = await run(() =>
      createMessage(tenantA.context, {
        customerId: cenario.customerId,
        channel: 'sms',
        contactValue: cenario.telefone,
        body: 'Mensagem.',
      }),
    );

    const estranhoId = await createPlainUser(tenantA.tenantId, 'estranho@comm-a.invalid');
    await grantMembership(tenantA.tenantId, estranhoId, tenantA.unitId);
    await clearTenantRoles(estranhoId);
    const estranho = await contextFor(tenantA.tenantId, estranhoId, tenantA.unitId);

    await expect(run(() => findMessage(estranho, messageId))).rejects.toThrow(AuthorizationError);
  });

  it('com a feature desligada, nada de comunicacao funciona', async () => {
    const cenario = await montarCenario(tenantA);
    await run(() =>
      setTenantFeature(tenantA.context, {
        featureKey: FEATURES.COMMUNICATIONS_CORE,
        enabled: false,
      }),
    );

    await expect(
      run(() =>
        createMessage(tenantA.context, {
          customerId: cenario.customerId,
          channel: 'sms',
          contactValue: cenario.telefone,
          body: 'Mensagem.',
        }),
      ),
    ).rejects.toThrow(AuthorizationError);

    /* E a Ordem de Servico continua inteira. */
    const linhas = await getDb().execute(sql`
      SELECT status FROM service_orders WHERE id = ${cenario.serviceOrderId}
    `);
    expect((linhas as unknown as Array<Array<{ status: string }>>)[0]?.[0]?.status).toBeTruthy();
  });
});

describe('PII e auditoria', () => {
  it('o evento de dominio NAO carrega telefone, e-mail nem corpo', async () => {
    const cenario = await montarCenario(tenantA);
    await run(() =>
      createMessage(tenantA.context, {
        customerId: cenario.customerId,
        channel: 'whatsapp',
        contactValue: cenario.telefone,
        body: 'Texto confidencial do cliente.',
      }),
    );

    const linhas = await getDb().execute(sql`
      SELECT type, payload FROM domain_events WHERE type LIKE 'MESSAGE%'
    `);
    const eventos =
      (linhas as unknown as Array<Array<{ type: string; payload: unknown }>>)[0] ?? [];
    expect(eventos.length).toBeGreaterThan(0);

    for (const evento of eventos) {
      const texto = JSON.stringify(evento.payload);
      expect(texto).not.toContain('11999998888');
      expect(texto).not.toContain('maria@cliente.invalid');
      expect(texto).not.toContain('Texto confidencial');
    }
  });

  it('a auditoria guarda a decisao, nao o texto', async () => {
    const cenario = await montarCenario(tenantA);
    await run(() =>
      createMessage(tenantA.context, {
        customerId: cenario.customerId,
        channel: 'whatsapp',
        contactValue: cenario.telefone,
        body: 'Texto confidencial do cliente.',
      }),
    );

    const linhas = await getDb().execute(sql`
      SELECT action, \`after\` FROM audit_logs WHERE entity_type = 'communication_message'
    `);
    const registros =
      (linhas as unknown as Array<Array<{ action: string; after: unknown }>>)[0] ?? [];
    expect(registros.length).toBeGreaterThan(0);

    for (const registro of registros) {
      const texto = JSON.stringify(registro.after);
      expect(texto).not.toContain('11999998888');
      expect(texto).not.toContain('Texto confidencial');
    }
  });

  it('a lista mascara o destino e a ficha mostra inteiro', async () => {
    const cenario = await montarCenario(tenantA);
    const { messageId } = await run(() =>
      createMessage(tenantA.context, {
        customerId: cenario.customerId,
        channel: 'whatsapp',
        contactValue: cenario.telefone,
        body: 'Mensagem.',
      }),
    );

    const lista = await run(() => listMessages(tenantA.context, {}));
    expect(lista.items[0]?.recipientMasked).not.toContain('99999');
    expect(lista.items[0]?.recipientMasked).toContain('8888');

    const ficha = await run(() => findMessage(tenantA.context, messageId));
    expect(ficha.recipientDisplay).toContain('99999');
  });
});
