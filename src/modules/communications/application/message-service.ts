import 'server-only';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { affectedRows } from '@/core/db/affected-rows';
import { getDb } from '@/core/db/client';
import { isDuplicateKeyError } from '@/core/db/duplicate-key';
import { runInTransaction } from '@/core/db/unit-of-work';
import { getContext } from '@/core/context/request-context';
import { BusinessRuleError, InternalError, NotFoundError, ValidationError } from '@/core/errors';
import { newId } from '@/core/ids/id';
import { logger } from '@/core/logging/logger';
import { authorize } from '@/modules/access-control/application/authorization-service';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { AUDIT_ACTIONS, recordAudit } from '@/modules/audit/application/audit-service';
import { EVENT_TYPES } from '@/modules/events/domain/event';
import { FEATURES } from '@/modules/features/domain/catalog';
import { checkFeatureEnabledForTenant } from '@/modules/features/application/effective-access';
import { tenants } from '@/modules/tenancy/infrastructure/schema';
import type { TenantContext } from '@/modules/tenancy/domain/tenant-context';
import { readCertificatePdf } from '@/modules/warranties/application/warranty-certificate-pdf-service';
import {
  BODY_MAX,
  CANCEL_REASON_MAX,
  COMMUNICATION_CHANNELS,
  type CommunicationChannel,
  type DeliveryError,
  MESSAGE_PURPOSES,
  type MessageStatus,
  SUBJECT_MAX,
  canCancel,
  canRetry,
  channelUsesSubject,
  explainNotRetryable,
  isMessageStatus,
} from '../domain/communication';
import { buildRecipient } from '../domain/recipient';
import { renderTemplate } from '../domain/template';
import {
  communicationAttachments,
  communicationAttempts,
  communicationMessages,
  communicationTemplates,
} from '../infrastructure/schema';
import { getCommunicationProvider } from '../infrastructure/provider-registry';
import {
  type DeliveryResult,
  type OutboundAttachment,
  sanitizeProviderDetail,
} from './communication-provider';
import {
  blank,
  parse,
  resolveAutomaticRecipient,
  resolveRecipient,
  resolveUnit,
} from './communication-guards';
import { resolveTemplateContext } from './message-context';

/**
 * O CICLO DE VIDA DE UMA MENSAGEM (itens 37 a 51).
 *
 * A decisão estrutural deste arquivo é onde a transação termina:
 *
 *   TRANSAÇÃO CURTA: grava a INTENÇÃO (a mensagem, a auditoria, o evento) e
 *                    faz COMMIT.
 *   FORA DELA:       a tentativa de entrega, que fala com a rede.
 *
 * POR QUE NÃO ENVIAR DENTRO DA TRANSAÇÃO, que seria mais simples de escrever:
 * uma chamada de rede dentro de uma transação segura linhas do InnoDB pelo
 * tempo que o fornecedor levar para responder — e fornecedor com problema
 * responde em trinta segundos, não em trinta milissegundos. Com o envio
 * dentro, um provedor lento vira lentidão do ERP inteiro para todos os
 * tenants. E pior: se o commit falhasse DEPOIS do envio, a mensagem teria ido
 * para o cliente sem existir no banco — o cliente sabe de algo que o sistema
 * não registrou.
 *
 * Com a transação curta, a pior falha possível é uma mensagem `queued` que
 * ninguém processou. Ela está registrada, aparece na tela como pendente, e há
 * um job que a desatola. Nenhuma pessoa recebe mensagem fantasma.
 */

const createSchema = z.object({
  customerId: z.string().trim().min(1, 'Escolha o cliente.'),
  channel: z.enum(COMMUNICATION_CHANNELS),
  contactValue: z.string().trim().min(1, 'Escolha para onde enviar.'),
  unitId: z.string().trim().optional().or(z.literal('')),
  serviceOrderId: z.string().trim().optional().or(z.literal('')),
  templateId: z.string().trim().optional().or(z.literal('')),
  subject: z.string().trim().max(SUBJECT_MAX).optional().or(z.literal('')),
  body: z.string().trim().max(BODY_MAX).optional().or(z.literal('')),
  purpose: z.enum(MESSAGE_PURPOSES).optional(),
  attachWarrantyId: z.string().trim().optional().or(z.literal('')),
  idempotencyKey: z.string().trim().max(190).optional().or(z.literal('')),
});

export type CreateMessageInput = z.infer<typeof createSchema>;

export interface CreatedMessage {
  messageId: string;
  /** `true` quando a chave de intenção reencontrou uma mensagem já criada. */
  reused: boolean;
}

/**
 * Cria a mensagem e tenta entregá-la.
 *
 * NÃO EXISTE RASCUNHO, e a ausência é decisão de projeto (item 39). Um estado
 * `draft` no banco criaria a pergunta "esse texto foi enviado?" para toda
 * linha da tabela, e a resposta dependeria de uma coluna. O conteúdo não
 * enviado vive no formulário do navegador; a linha nasce no instante em que
 * alguém confirma que quer enviar. Toda mensagem no banco é uma mensagem que
 * alguém mandou enviar.
 */
export async function createMessage(
  context: TenantContext,
  rawInput: unknown,
): Promise<CreatedMessage> {
  const input = parse(createSchema, rawInput);
  const unitId = resolveUnit(context, blank(input.unitId));

  await authorize(context, {
    permission: PERMISSIONS.COMMUNICATIONS_SEND,
    featureKey: FEATURES.COMMUNICATIONS_CORE,
    unitId,
  });

  const destinatario = await resolveRecipient(context, {
    customerId: input.customerId,
    contactValue: input.contactValue,
    channel: input.channel,
  });

  const serviceOrderId = blank(input.serviceOrderId);
  const contexto = await resolveTemplateContext(context, {
    customerId: destinatario.customerId,
    customerName: destinatario.customerName,
    unitId,
    serviceOrderId,
  });

  const texto = await resolveText(context, input, contexto);
  const recipient = buildRecipient({
    channel: input.channel,
    rawValue: destinatario.rawValue,
    customerId: destinatario.customerId,
  });

  /**
   * O ANEXO É LIDO AGORA, PELO SERVIÇO AUTORIZADO (itens 52 a 55).
   *
   * `readCertificatePdf` confere tenant, unidade e permissão de garantias.
   * Chamá-lo aqui, dentro do pedido de quem clicou, é o que garante que
   * anexar um certificado exige poder VER aquele certificado — e é por isso
   * que o módulo de Comunicação não guarda `storage_key` nenhuma.
   */
  const warrantyId = blank(input.attachWarrantyId);
  const anexo = warrantyId ? await readCertificatePdf(context, warrantyId) : null;

  const idempotencyKey = blank(input.idempotencyKey);
  if (idempotencyKey) {
    const existente = await findByIdempotencyKey(context.tenantId, idempotencyKey);
    if (existente) return { messageId: existente, reused: true };
  }

  const messageId = newId();
  const now = new Date();

  try {
    await runInTransaction(async (tx, emit) => {
      await tx.insert(communicationMessages).values({
        id: messageId,
        tenantId: context.tenantId,
        unitId,
        channel: input.channel,
        status: 'queued',
        origin: 'manual',
        purpose: input.purpose ?? 'generic',
        recipientValue: recipient.value,
        recipientDisplay: recipient.display,
        customerId: recipient.customerId,
        subject: texto.subject,
        body: texto.body,
        templateId: texto.templateId,
        serviceOrderId,
        requestedBy: context.userId,
        idempotencyKey,
        createdAt: now,
        updatedAt: now,
      });

      if (anexo && warrantyId) {
        await tx.insert(communicationAttachments).values({
          id: newId(),
          tenantId: context.tenantId,
          messageId,
          kind: 'warranty_certificate',
          warrantyId,
          filename: anexo.filename,
          mimeType: anexo.mimeType,
          byteSize: anexo.byteSize,
          checksum: anexo.checksum,
          createdAt: now,
        });
      }

      await recordAudit(
        {
          action: AUDIT_ACTIONS.MESSAGE_CREATED,
          entityType: 'communication_message',
          entityId: messageId,
          tenantId: context.tenantId,
          unitId,
          userId: context.userId,
          /** Identificadores e metadados. O texto e o destino ficam na tabela. */
          after: {
            channel: input.channel,
            purpose: input.purpose ?? 'generic',
            origin: 'manual',
            customerId: recipient.customerId,
            serviceOrderId,
            hasAttachment: Boolean(anexo),
          },
        },
        tx,
      );

      await emit({
        type: EVENT_TYPES.MESSAGE_CREATED,
        tenantId: context.tenantId,
        payload: {
          messageId,
          unitId,
          channel: input.channel,
          purpose: input.purpose ?? 'generic',
          customerId: recipient.customerId,
          serviceOrderId,
        },
      });
    });
  } catch (error) {
    if (idempotencyKey && isDuplicateKeyError(error)) {
      const vencedor = await findByIdempotencyKey(context.tenantId, idempotencyKey);
      if (vencedor) return { messageId: vencedor, reused: true };
    }
    throw error;
  }

  /** COMMIT feito. A partir daqui, a entrega é problema separado. */
  await processMessage({ messageId, tenantId: context.tenantId, context });

  return { messageId, reused: false };
}

// ---------------------------------------------------------------------------
// Acao de automacao (Prompt 19)
// ---------------------------------------------------------------------------

export interface AutomationMessageInput {
  tenantId: string;
  unitId: string;
  customerId: string;
  channel: CommunicationChannel;
  /** SEMPRE um modelo (item 32 e 139) — o Motor nunca digita texto livre. */
  templateId: string;
  serviceOrderId?: string | null;
  purpose?: (typeof MESSAGE_PURPOSES)[number];
  /** `automation:{executionId}:action:{actionIndex}` (item 33). */
  idempotencyKey: string;
  sourceEventId?: string | null;
}

export interface AutomationMessageResult {
  /**
   * `created`/`reused` (sucesso real, com efeito): o servico oficial
   * entregou a mensagem ao provedor (ou reaproveitou uma entrega anterior
   * que TINHA sido aceita). `skipped` (nunca chegou a existir mensagem):
   * pre-condicao falhou antes de qualquer tentativa — tenant, feature,
   * destinatario ou modelo invalidos. `failed` (existe mensagem, mas SEM
   * efeito real): o servico oficial tentou entregar e o provedor recusou,
   * nao respondeu, ou nao existe — fechamento do Prompt 19, Secao 9/10: o
   * Motor NUNCA pode tratar isto como sucesso da acao so porque uma linha
   * foi criada.
   */
  outcome: 'created' | 'reused' | 'skipped' | 'failed';
  messageId?: string;
  /** Codigo estavel (item 150), presente quando `outcome !== 'created'`. */
  errorCode?: string;
  errorDetail?: string;
}

/**
 * `communication_messages.last_error_code`/`ProcessResult.error` guardam o
 * vocabulario PROPRIO de Comunicacao (`DeliveryError`, ADR-078/079) — nunca
 * o vocabulario do Motor. Esta funcao e a UNICA ponte entre os dois, e
 * devolve apenas STRINGS (nunca importa `AUTOMATION_ERROR_CODES`): o modulo
 * alvo nao pode depender do modulo que o consome (item 16 do fechamento).
 * `provider_not_configured` e `invalid_recipient` nunca melhoram sozinhos —
 * mapeiam para os mesmos códigos permanentes que o catalogo de automacoes ja
 * reserva para eles. `provider_unavailable`/`rate_limited`/`timeout` sao a
 * unica categoria em que um retry futuro poderia ter resultado diferente.
 */
function mapDeliveryErrorToAutomationCode(error: DeliveryError | null | undefined): string {
  if (error === 'invalid_recipient') return 'INVALID_RECIPIENT';
  if (error === 'provider_not_configured') return 'PROVIDER_NOT_CONFIGURED';
  if (error === 'provider_unavailable' || error === 'rate_limited' || error === 'timeout') {
    return 'PROVIDER_UNAVAILABLE';
  }
  return 'UNKNOWN';
}

/**
 * CRIA UMA MENSAGEM A PARTIR DE UMA REGRA DE AUTOMACAO — SEM `TenantContext`.
 *
 * `TenantContext` "so pode ser construido a partir de uma SESSAO VALIDA no
 * servidor" (regra critica do proprio tipo) — o Motor roda sem sessao, e
 * inventar um contexto sintetico com permissoes forjadas seria exatamente o
 * "magic superuser" que a arquitetura de automacao proibe (item 66).
 *
 * Por isso este caminho NAO chama `authorize()`. A permissao de quem PODE
 * enviar mensagem ja foi checada uma vez, em CONFIG-TIME, quando uma pessoa
 * autorizada criou ou habilitou a regra (item 68) — o Motor, em RUNTIME,
 * revalida apenas o que pode ter mudado desde entao: a FEATURE do tenant
 * (`checkFeatureEnabledForTenant`, o mesmo mecanismo do Portal do Cliente,
 * que tambem nao tem `TenantContext`) e os INVARIANTES do proprio dominio —
 * modelo ativo, canal compativel, destinatario elegivel. Tudo o que exige
 * julgamento humano (anexo de garantia, por exemplo) continua fora do
 * alcance desta funcao: o Motor V1 nunca anexa nada.
 */
export async function createMessageFromAutomation(
  input: AutomationMessageInput,
): Promise<AutomationMessageResult> {
  const [tenant] = await getDb()
    .select({ planId: tenants.planId, name: tenants.name })
    .from(tenants)
    .where(eq(tenants.id, input.tenantId))
    .limit(1);
  if (!tenant) {
    return {
      outcome: 'skipped',
      errorCode: 'TENANT_NOT_FOUND',
      errorDetail: 'Tenant nao encontrado.',
    };
  }

  const acesso = await checkFeatureEnabledForTenant(
    { tenantId: input.tenantId, planId: tenant.planId },
    FEATURES.COMMUNICATIONS_CORE,
  );
  if (!acesso.allowed) {
    return {
      outcome: 'skipped',
      errorCode: 'ACTION_FEATURE_DISABLED',
      errorDetail: acesso.message,
    };
  }

  const existente = await findByIdempotencyKey(input.tenantId, input.idempotencyKey);
  if (existente) {
    /**
     * REUSE NAO E SUCESSO AUTOMATICO (Secao 13 do fechamento). Encontrar a
     * chave de idempotencia so prova que uma tentativa anterior chegou ate
     * aqui — nao prova que ELA deu certo. Uma mensagem `failed` reaproveitada
     * continua `failed`: o Motor precisa saber que nenhum efeito real
     * aconteceu, mesmo sem criar uma segunda linha.
     */
    const [mensagemExistente] = await getDb()
      .select({
        status: communicationMessages.status,
        lastErrorCode: communicationMessages.lastErrorCode,
      })
      .from(communicationMessages)
      .where(eq(communicationMessages.id, existente))
      .limit(1);
    if (mensagemExistente?.status === 'failed') {
      return {
        outcome: 'failed',
        messageId: existente,
        errorCode: mapDeliveryErrorToAutomationCode(
          mensagemExistente.lastErrorCode as DeliveryError | null,
        ),
        errorDetail: 'A mensagem (reaproveitada pela idempotencia) ja tinha falhado antes.',
      };
    }
    return { outcome: 'reused', messageId: existente };
  }

  const destinatario = await resolveAutomaticRecipient(
    { tenantId: input.tenantId },
    { customerId: input.customerId, channel: input.channel },
  );
  if (!destinatario) {
    return {
      outcome: 'skipped',
      errorCode: 'INVALID_RECIPIENT',
      errorDetail: 'O cliente nao tem um contato principal elegivel para este canal.',
    };
  }

  const [modelo] = await getDb()
    .select({
      id: communicationTemplates.id,
      channel: communicationTemplates.channel,
      subject: communicationTemplates.subject,
      body: communicationTemplates.body,
      status: communicationTemplates.status,
    })
    .from(communicationTemplates)
    .where(
      and(
        eq(communicationTemplates.id, input.templateId),
        eq(communicationTemplates.tenantId, input.tenantId),
      ),
    )
    .limit(1);

  if (!modelo) {
    return {
      outcome: 'skipped',
      errorCode: 'ACTION_VALIDATION_FAILED',
      errorDetail: 'Modelo nao encontrado.',
    };
  }
  if (modelo.status !== 'active') {
    return {
      outcome: 'skipped',
      errorCode: 'ACTION_VALIDATION_FAILED',
      errorDetail: 'Este modelo foi arquivado e nao pode mais ser usado.',
    };
  }
  if (modelo.channel !== input.channel) {
    return {
      outcome: 'skipped',
      errorCode: 'ACTION_VALIDATION_FAILED',
      errorDetail: 'Este modelo foi escrito para outro canal.',
    };
  }

  const contexto = await resolveTemplateContext(
    { tenantId: input.tenantId, tenantName: tenant.name },
    {
      customerId: destinatario.customerId,
      customerName: destinatario.customerName,
      unitId: input.unitId,
      serviceOrderId: input.serviceOrderId ?? null,
    },
  );

  const usaAssunto = channelUsesSubject(input.channel);
  let texto: ResolvedText;
  try {
    texto = {
      subject:
        usaAssunto && modelo.subject
          ? renderTemplate(modelo.subject, contexto.values, contexto.scopes)
          : null,
      body: renderTemplate(modelo.body, contexto.values, contexto.scopes),
      templateId: modelo.id,
    };
  } catch (error) {
    return {
      outcome: 'skipped',
      errorCode: 'ACTION_VALIDATION_FAILED',
      errorDetail: error instanceof Error ? error.message : String(error),
    };
  }

  const recipient = buildRecipient({
    channel: input.channel,
    rawValue: destinatario.rawValue,
    customerId: destinatario.customerId,
  });

  const messageId = newId();
  const now = new Date();
  const correlationId = getContext()?.correlationId ?? null;

  try {
    await runInTransaction(async (tx, emit) => {
      await tx.insert(communicationMessages).values({
        id: messageId,
        tenantId: input.tenantId,
        unitId: input.unitId,
        channel: input.channel,
        status: 'queued',
        /** Origem e o evento de dominio, nunca "manual" (item 27 do catalogo). */
        origin: 'domain_event',
        purpose: input.purpose ?? 'generic',
        recipientValue: recipient.value,
        recipientDisplay: recipient.display,
        customerId: recipient.customerId,
        subject: texto.subject,
        body: texto.body,
        templateId: texto.templateId,
        serviceOrderId: input.serviceOrderId ?? null,
        /** Nulo de proposito: quem pediu foi o Motor reagindo a um evento, nao uma pessoa. */
        requestedBy: null,
        sourceEventId: input.sourceEventId ?? null,
        idempotencyKey: input.idempotencyKey,
        correlationId,
        createdAt: now,
        updatedAt: now,
      });

      await recordAudit(
        {
          action: AUDIT_ACTIONS.MESSAGE_CREATED,
          entityType: 'communication_message',
          entityId: messageId,
          tenantId: input.tenantId,
          unitId: input.unitId,
          userId: null,
          after: {
            channel: input.channel,
            purpose: input.purpose ?? 'generic',
            origin: 'domain_event',
            customerId: recipient.customerId,
            serviceOrderId: input.serviceOrderId ?? null,
            hasAttachment: false,
          },
        },
        tx,
      );

      await emit({
        type: EVENT_TYPES.MESSAGE_CREATED,
        tenantId: input.tenantId,
        payload: {
          messageId,
          unitId: input.unitId,
          channel: input.channel,
          purpose: input.purpose ?? 'generic',
          customerId: recipient.customerId,
          serviceOrderId: input.serviceOrderId ?? null,
        },
      });
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      const vencedor = await findByIdempotencyKey(input.tenantId, input.idempotencyKey);
      if (vencedor) return { outcome: 'reused', messageId: vencedor };
    }
    throw error;
  }

  /**
   * COMMIT feito. A entrega, como no caminho manual, e um passo separado —
   * mas para o Motor de Automacoes (fechamento do Prompt 19, Secao 9/10) o
   * RESULTADO dessa entrega decide se a ACAO foi bem-sucedida. Ao contrario
   * do caminho manual (onde o humano ve o status da mensagem depois, na
   * tela), a acao do Motor SO tem esta chamada para saber o que aconteceu —
   * por isso, aqui, o resultado de `processMessage` e propagado, nunca
   * descartado.
   */
  const resultado = await processMessage({ messageId, tenantId: input.tenantId, context: null });
  if (resultado.outcome === 'failed') {
    return {
      outcome: 'failed',
      messageId,
      errorCode: mapDeliveryErrorToAutomationCode(resultado.error),
      errorDetail: 'O provedor nao aceitou a mensagem.',
    };
  }

  return { outcome: 'created', messageId };
}

async function findByIdempotencyKey(tenantId: string, key: string): Promise<string | null> {
  const [linha] = await getDb()
    .select({ id: communicationMessages.id })
    .from(communicationMessages)
    .where(
      and(
        eq(communicationMessages.tenantId, tenantId),
        eq(communicationMessages.idempotencyKey, key),
      ),
    )
    .limit(1);

  return linha?.id ?? null;
}

interface ResolvedText {
  subject: string | null;
  body: string;
  templateId: string | null;
}

/**
 * De onde vem o texto: de um modelo renderizado ou digitado na hora.
 *
 * O MODELO É COPIADO, NÃO REFERENCIADO (item 22). O que vai para o banco é o
 * resultado já com as lacunas preenchidas. `template_id` fica como
 * procedência.
 */
async function resolveText(
  context: TenantContext,
  input: CreateMessageInput,
  contexto: Awaited<ReturnType<typeof resolveTemplateContext>>,
): Promise<ResolvedText> {
  const templateId = blank(input.templateId);
  const usaAssunto = channelUsesSubject(input.channel);

  if (templateId) {
    const [modelo] = await getDb()
      .select({
        id: communicationTemplates.id,
        channel: communicationTemplates.channel,
        subject: communicationTemplates.subject,
        body: communicationTemplates.body,
        status: communicationTemplates.status,
      })
      .from(communicationTemplates)
      .where(
        and(
          eq(communicationTemplates.id, templateId),
          eq(communicationTemplates.tenantId, context.tenantId),
        ),
      )
      .limit(1);

    if (!modelo) throw new NotFoundError('Modelo nao encontrado.');
    if (modelo.status !== 'active') {
      throw new BusinessRuleError('Este modelo foi arquivado e nao pode mais ser usado.');
    }
    if (modelo.channel !== input.channel) {
      throw new BusinessRuleError('Este modelo foi escrito para outro canal.');
    }

    return {
      /** Renderizar RECUSA lacuna desconhecida e lacuna sem valor. */
      subject:
        usaAssunto && modelo.subject
          ? renderTemplate(modelo.subject, contexto.values, contexto.scopes)
          : null,
      body: renderTemplate(modelo.body, contexto.values, contexto.scopes),
      templateId: modelo.id,
    };
  }

  const body = blank(input.body);
  if (!body) throw new ValidationError('Escreva a mensagem ou escolha um modelo.');

  const subject = blank(input.subject);
  if (usaAssunto && !subject) throw new ValidationError('E-mail precisa de assunto.');
  if (!usaAssunto && subject) {
    throw new ValidationError('Este canal nao envia assunto.');
  }

  /**
   * Texto digitado também passa pelo renderizador, com os mesmos valores.
   *
   * Assim, quem copiou o texto de um modelo e colou aqui com `{{cliente.nome}}`
   * dentro obtém o nome do cliente — e quem digitou `{{cliente.apelido}}`,
   * que não existe, recebe uma recusa em vez de mandar a chave literal para a
   * pessoa.
   */
  return {
    subject: subject ? renderTemplate(subject, contexto.values, contexto.scopes) : null,
    body: renderTemplate(body, contexto.values, contexto.scopes),
    templateId: null,
  };
}

// ---------------------------------------------------------------------------
// Processamento
// ---------------------------------------------------------------------------

export interface ProcessResult {
  /** `false` quando outra execução já tinha pegado esta mensagem. */
  claimed: boolean;
  outcome: 'accepted' | 'failed' | 'skipped';
  error?: DeliveryError;
}

/**
 * Tenta entregar UMA mensagem.
 *
 * A TRAVA DE EXCLUSIVIDADE É UM `UPDATE` CONDICIONAL (ADR-044, itens 44 a 47).
 * A condição `status = 'queued'` vai dentro do `WHERE`, e quem recebe zero
 * linhas afetadas perdeu a corrida e simplesmente sai. Não há `SELECT` antes
 * do `UPDATE` — entre ler e escrever cabe outra execução inteira, e é
 * exatamente nesse vão que nasceriam duas mensagens iguais para o mesmo
 * cliente.
 *
 * Cinco execuções simultâneas produzem UMA tentativa. As outras quatro
 * descobrem isso pelo próprio banco, sem coordenação externa.
 */
export async function processMessage(input: {
  messageId: string;
  tenantId: string;
  context: TenantContext | null;
}): Promise<ProcessResult> {
  const agora = new Date();

  const reivindicada = await getDb()
    .update(communicationMessages)
    .set({
      status: 'sending',
      updatedAt: agora,
      version: sql`${communicationMessages.version} + 1`,
    })
    .where(
      and(
        eq(communicationMessages.id, input.messageId),
        eq(communicationMessages.tenantId, input.tenantId),
        eq(communicationMessages.status, 'queued'),
      ),
    );

  if (affectedRows(reivindicada) === 0) {
    return { claimed: false, outcome: 'skipped' };
  }

  const [mensagem] = await getDb()
    .select({
      id: communicationMessages.id,
      unitId: communicationMessages.unitId,
      channel: communicationMessages.channel,
      recipientValue: communicationMessages.recipientValue,
      subject: communicationMessages.subject,
      body: communicationMessages.body,
      attemptCount: communicationMessages.attemptCount,
      correlationId: communicationMessages.correlationId,
    })
    .from(communicationMessages)
    .where(eq(communicationMessages.id, input.messageId))
    .limit(1);

  if (!mensagem) {
    /** Reivindicada e sumida entre um comando e outro: não há o que fazer. */
    return { claimed: true, outcome: 'skipped' };
  }

  const numeroDaTentativa = mensagem.attemptCount + 1;
  const iniciadaEm = new Date();

  const preparo = await prepareDelivery(input.context, input.messageId, mensagem.channel);

  if (!preparo.ok) {
    return finishAttempt({
      tenantId: input.tenantId,
      messageId: input.messageId,
      unitId: mensagem.unitId,
      channel: mensagem.channel,
      attemptNumber: numeroDaTentativa,
      provider: preparo.provider,
      startedAt: iniciadaEm,
      correlationId: mensagem.correlationId,
      resultado: { outcome: 'failed', error: preparo.error, detail: preparo.detail },
    });
  }

  const enviar = preparo.provider2;
  let resultado: DeliveryResult;
  try {
    resultado = await enviar.send({
      messageId: mensagem.id,
      channel: mensagem.channel as CommunicationChannel,
      recipient: mensagem.recipientValue,
      subject: mensagem.subject,
      body: mensagem.body,
      attachments: preparo.attachments,
      correlationId: mensagem.correlationId,
    });
  } catch (error) {
    /**
     * Exceção escapando do adaptador é DEFEITO DELE, e vira falha registrada —
     * nunca sucesso. O detalhe passa pela higienização antes de tocar o banco.
     */
    resultado = {
      outcome: 'failed',
      error: 'unknown',
      detail: sanitizeProviderDetail(error instanceof Error ? error.message : String(error)),
    };
  }

  return finishAttempt({
    tenantId: input.tenantId,
    messageId: input.messageId,
    unitId: mensagem.unitId,
    channel: mensagem.channel,
    attemptNumber: numeroDaTentativa,
    provider: enviar.name,
    startedAt: iniciadaEm,
    correlationId: mensagem.correlationId,
    resultado,
  });
}

type Preparation =
  | { ok: false; provider: string; error: DeliveryError; detail: string }
  | {
      ok: true;
      provider2: NonNullable<ReturnType<typeof getCommunicationProvider>>;
      attachments: OutboundAttachment[];
    };

/**
 * Reúne o que a tentativa precisa: provedor e bytes dos anexos.
 *
 * TRÊS MOTIVOS LEGÍTIMOS PARA NÃO TENTAR, e cada um vira uma falha com nome
 * próprio, em vez de um erro genérico que ninguém sabe interpretar às onze da
 * noite:
 *
 *   1. não há provedor configurado (produção, hoje);
 *   2. o provedor existente não atende aquele canal;
 *   3. a mensagem tem anexo e quem está processando não tem contexto de
 *      usuário para ler o arquivo — o caso do job de recuperação.
 *
 * O TERCEIRO CASO MERECE EXPLICAÇÃO. Ler o certificado exige passar por
 * `readCertificatePdf`, que confere permissão. Um job roda sem usuário, então
 * não há permissão a conferir — e a saída fácil seria criar um atalho que lê o
 * arquivo sem checar nada. Esse atalho seria, para sempre, uma porta por onde
 * qualquer código do servidor lê certificado de qualquer tenant. A saída certa
 * é o job NÃO enviar mensagem com anexo: ele a marca como falha explicando
 * que uma pessoa precisa reenviar.
 */
async function prepareDelivery(
  context: TenantContext | null,
  messageId: string,
  channel: string,
): Promise<Preparation> {
  const provider = getCommunicationProvider();

  if (!provider) {
    return {
      ok: false,
      provider: 'none',
      error: 'provider_not_configured',
      detail:
        'Nenhum provedor de envio esta configurado neste ambiente. A mensagem ficou registrada e pode ser reenviada quando houver provedor.',
    };
  }

  if (!provider.channels.includes(channel as CommunicationChannel)) {
    return {
      ok: false,
      provider: provider.name,
      error: 'provider_not_configured',
      detail: `O provedor configurado nao atende o canal ${channel}.`,
    };
  }

  const anexos = await getDb()
    .select({
      warrantyId: communicationAttachments.warrantyId,
      filename: communicationAttachments.filename,
    })
    .from(communicationAttachments)
    .where(eq(communicationAttachments.messageId, messageId));

  if (anexos.length > 0 && !context) {
    return {
      ok: false,
      provider: provider.name,
      error: 'unknown',
      detail:
        'A tentativa foi interrompida e esta mensagem tem anexo. Reenviar exige uma pessoa autorizada a ver o documento anexado.',
    };
  }

  const attachments: OutboundAttachment[] = [];
  for (const anexo of anexos) {
    if (!context || !anexo.warrantyId) continue;
    const arquivo = await readCertificatePdf(context, anexo.warrantyId);
    attachments.push({
      filename: arquivo.filename,
      mimeType: arquivo.mimeType,
      bytes: arquivo.bytes,
    });
  }

  return { ok: true, provider2: provider, attachments };
}

/**
 * Registra a tentativa e move a mensagem, numa transação só.
 *
 * A TENTATIVA É GRAVADA MESMO QUANDO A MENSAGEM NÃO MUDA DE ESTADO. As duas
 * escritas estão na mesma transação justamente para que não exista mensagem
 * `failed` sem a linha que diz por quê, nem tentativa registrada para uma
 * mensagem que continua `queued`.
 */
async function finishAttempt(args: {
  tenantId: string;
  messageId: string;
  unitId: string;
  channel: string;
  attemptNumber: number;
  provider: string;
  startedAt: Date;
  correlationId: string | null;
  resultado: DeliveryResult;
}): Promise<ProcessResult> {
  const terminouEm = new Date();
  const resultado = args.resultado;

  /**
   * A distinção entre aceita e falha é feita UMA vez, aqui, e carregada em
   * variáveis já resolvidas. Repetir `resultado.outcome === 'accepted'` em
   * cada campo abaixo espalharia a mesma decisão por dez lugares, e bastaria
   * um deles ficar para trás numa edição futura para a mensagem virar `sent`
   * carregando o erro da tentativa anterior.
   */
  const aceita = resultado.outcome === 'accepted';
  const protocolo = resultado.outcome === 'accepted' ? resultado.providerMessageId : null;
  const erro = resultado.outcome === 'failed' ? resultado.error : null;
  const detalhe = resultado.outcome === 'failed' ? sanitizeProviderDetail(resultado.detail) : null;

  await runInTransaction(async (tx, emit) => {
    await tx.insert(communicationAttempts).values({
      id: newId(),
      tenantId: args.tenantId,
      messageId: args.messageId,
      attemptNumber: args.attemptNumber,
      provider: args.provider,
      startedAt: args.startedAt,
      finishedAt: terminouEm,
      durationMs: Math.max(0, terminouEm.getTime() - args.startedAt.getTime()),
      outcome: aceita ? 'accepted' : 'failed',
      errorCode: erro,
      errorDetail: detalhe,
      providerMessageId: protocolo,
      correlationId: args.correlationId,
      createdAt: terminouEm,
    });

    /**
     * `status = 'sending'` no `WHERE`: se alguém cancelou a mensagem enquanto
     * o provedor respondia, o cancelamento vence e este `UPDATE` não afeta
     * linha nenhuma. A tentativa continua registrada, porque ela aconteceu.
     */
    await tx
      .update(communicationMessages)
      .set(
        aceita
          ? {
              status: 'sent',
              sentAt: terminouEm,
              sentProvider: args.provider,
              providerMessageId: protocolo,
              attemptCount: args.attemptNumber,
              lastAttemptAt: terminouEm,
              lastErrorCode: null,
              lastErrorDetail: null,
              updatedAt: terminouEm,
              version: sql`${communicationMessages.version} + 1`,
            }
          : {
              status: 'failed',
              attemptCount: args.attemptNumber,
              lastAttemptAt: terminouEm,
              lastErrorCode: erro,
              lastErrorDetail: detalhe,
              updatedAt: terminouEm,
              version: sql`${communicationMessages.version} + 1`,
            },
      )
      .where(
        and(
          eq(communicationMessages.id, args.messageId),
          eq(communicationMessages.tenantId, args.tenantId),
          eq(communicationMessages.status, 'sending'),
        ),
      );

    await recordAudit(
      {
        action: aceita ? AUDIT_ACTIONS.MESSAGE_SENT : AUDIT_ACTIONS.MESSAGE_FAILED,
        entityType: 'communication_message',
        entityId: args.messageId,
        tenantId: args.tenantId,
        unitId: args.unitId,
        after: {
          channel: args.channel,
          provider: args.provider,
          attempt: args.attemptNumber,
          ...(erro ? { error: erro } : {}),
        },
      },
      tx,
    );

    await emit({
      type: aceita ? EVENT_TYPES.MESSAGE_SENT : EVENT_TYPES.MESSAGE_FAILED,
      tenantId: args.tenantId,
      payload: {
        messageId: args.messageId,
        unitId: args.unitId,
        channel: args.channel,
        provider: args.provider,
        attempt: args.attemptNumber,
        ...(erro ? { error: erro } : {}),
      },
    });
  });

  /** Log sem PII: identificadores, canal e motivo. Nunca destino nem corpo. */
  logger.info(aceita ? 'Mensagem aceita pelo provedor' : 'Tentativa de envio falhou', {
    module: 'communications',
    operation: 'processMessage',
    messageId: args.messageId,
    channel: args.channel,
    provider: args.provider,
    attempt: args.attemptNumber,
    ...(erro ? { errorCode: erro } : {}),
  });

  if (erro) return { claimed: true, outcome: 'failed', error: erro };
  return { claimed: true, outcome: 'accepted' };
}

// ---------------------------------------------------------------------------
// Reenviar e cancelar
// ---------------------------------------------------------------------------

/**
 * Reenvia uma mensagem que falhou.
 *
 * REENVIAR É A MESMA MENSAGEM, NÃO UMA NOVA (itens 42 e 43). O texto, o
 * destino e o vínculo com a OS continuam os mesmos; o que se acumula é a lista
 * de tentativas. Criar uma segunda linha faria a tela mostrar duas mensagens
 * onde o cliente, na melhor hipótese, vai receber uma.
 *
 * SÓ O QUE FALHOU PODE SER REENVIADO. Uma mensagem já aceita pelo provedor
 * reenviada "por garantia" é uma mensagem duplicada no celular do cliente.
 */
export async function retryMessage(context: TenantContext, messageId: string): Promise<void> {
  const mensagem = await loadForAction(context, messageId);

  await authorize(context, {
    permission: PERMISSIONS.COMMUNICATIONS_SEND,
    featureKey: FEATURES.COMMUNICATIONS_CORE,
    unitId: mensagem.unitId,
  });

  if (!canRetry(mensagem.status)) {
    throw new BusinessRuleError(explainNotRetryable(mensagem.status));
  }

  const agora = new Date();

  await runInTransaction(async (tx) => {
    const resultado = await tx
      .update(communicationMessages)
      .set({
        status: 'queued',
        updatedAt: agora,
        version: sql`${communicationMessages.version} + 1`,
      })
      .where(
        and(
          eq(communicationMessages.id, messageId),
          eq(communicationMessages.tenantId, context.tenantId),
          eq(communicationMessages.status, 'failed'),
        ),
      );

    /** Dois reenvios simultâneos: o segundo encontra zero linhas e desiste. */
    if (affectedRows(resultado) === 0) {
      throw new BusinessRuleError('Esta mensagem ja foi reenviada por outra pessoa.');
    }

    await recordAudit(
      {
        action: AUDIT_ACTIONS.MESSAGE_RETRIED,
        entityType: 'communication_message',
        entityId: messageId,
        tenantId: context.tenantId,
        unitId: mensagem.unitId,
        userId: context.userId,
        after: { channel: mensagem.channel, previousAttempts: mensagem.attemptCount },
      },
      tx,
    );
  });

  await processMessage({ messageId, tenantId: context.tenantId, context });
}

const cancelSchema = z.object({
  messageId: z.string().trim().min(1),
  reason: z.string().trim().max(CANCEL_REASON_MAX).optional().or(z.literal('')),
});

/**
 * Cancela uma mensagem que ainda não saiu.
 *
 * CANCELAR NÃO DESFAZ ENVIO, e por isso só vale para `queued` e `failed`. Uma
 * mensagem já aceita pelo provedor está fora do nosso alcance — marcar como
 * cancelada faria a tela afirmar que o cliente não foi avisado quando ele
 * provavelmente foi.
 */
export async function cancelMessage(context: TenantContext, rawInput: unknown): Promise<void> {
  const input = parse(cancelSchema, rawInput);
  const mensagem = await loadForAction(context, input.messageId);

  await authorize(context, {
    permission: PERMISSIONS.COMMUNICATIONS_SEND,
    featureKey: FEATURES.COMMUNICATIONS_CORE,
    unitId: mensagem.unitId,
  });

  if (!canCancel(mensagem.status)) {
    throw new BusinessRuleError(
      'Esta mensagem ja foi aceita pelo provedor e nao pode mais ser cancelada.',
    );
  }

  const agora = new Date();

  await runInTransaction(async (tx, emit) => {
    const resultado = await tx
      .update(communicationMessages)
      .set({
        status: 'cancelled',
        cancelledAt: agora,
        cancelledBy: context.userId,
        cancelReason: blank(input.reason),
        updatedAt: agora,
        version: sql`${communicationMessages.version} + 1`,
      })
      .where(
        and(
          eq(communicationMessages.id, input.messageId),
          eq(communicationMessages.tenantId, context.tenantId),
          sql`${communicationMessages.status} IN ('queued','failed')`,
        ),
      );

    if (affectedRows(resultado) === 0) {
      throw new BusinessRuleError(
        'A mensagem mudou de situacao enquanto esta tela estava aberta. Recarregue e veja como ela esta.',
      );
    }

    await recordAudit(
      {
        action: AUDIT_ACTIONS.MESSAGE_CANCELLED,
        entityType: 'communication_message',
        entityId: input.messageId,
        tenantId: context.tenantId,
        unitId: mensagem.unitId,
        userId: context.userId,
        after: { channel: mensagem.channel, hasReason: Boolean(blank(input.reason)) },
      },
      tx,
    );

    await emit({
      type: EVENT_TYPES.MESSAGE_CANCELLED,
      tenantId: context.tenantId,
      payload: {
        messageId: input.messageId,
        unitId: mensagem.unitId,
        channel: mensagem.channel,
      },
    });
  });
}

interface MessageForAction {
  unitId: string;
  channel: string;
  status: MessageStatus;
  attemptCount: number;
}

/**
 * Carrega o mínimo para decidir, JÁ RECORTADO PELO TENANT.
 *
 * A unidade sai daqui e vai para a autorização: quem opera na loja Centro não
 * reenvia mensagem da loja Norte, e essa decisão não pode depender de um
 * parâmetro que veio do navegador.
 */
async function loadForAction(context: TenantContext, messageId: string): Promise<MessageForAction> {
  const [linha] = await getDb()
    .select({
      unitId: communicationMessages.unitId,
      channel: communicationMessages.channel,
      status: communicationMessages.status,
      attemptCount: communicationMessages.attemptCount,
    })
    .from(communicationMessages)
    .where(
      and(
        eq(communicationMessages.id, messageId),
        eq(communicationMessages.tenantId, context.tenantId),
      ),
    )
    .limit(1);

  if (!linha) throw new NotFoundError('Mensagem nao encontrada.');

  /**
   * A coluna é `varchar` para que um estado novo entre sem `ALTER TABLE`. O
   * preço é este estreitamento aqui: um valor fora do conjunto conhecido é
   * dado corrompido, e seguir adiante faria as regras de reenvio e
   * cancelamento decidirem sobre um estado que elas não sabem ler.
   */
  if (!isMessageStatus(linha.status)) {
    throw new InternalError('Situacao de mensagem desconhecida no banco.');
  }

  return { ...linha, status: linha.status };
}
