import 'server-only';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { affectedRows } from '@/core/db/affected-rows';
import { getDb } from '@/core/db/client';
import { isDuplicateKeyError } from '@/core/db/duplicate-key';
import { runInTransaction } from '@/core/db/unit-of-work';
import { BusinessRuleError, ConflictError, NotFoundError } from '@/core/errors';
import { newId } from '@/core/ids/id';
import { normalizeSearchable } from '@/core/text/normalize';
import { authorize } from '@/modules/access-control/application/authorization-service';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { AUDIT_ACTIONS, recordAudit } from '@/modules/audit/application/audit-service';
import { FEATURES } from '@/modules/features/domain/catalog';
import type { TenantContext } from '@/modules/tenancy/domain/tenant-context';
import {
  BODY_MAX,
  COMMUNICATION_CHANNELS,
  MESSAGE_PURPOSES,
  SUBJECT_MAX,
  TEMPLATE_NAME_MAX,
} from '../domain/communication';
import { assertTemplateDraft } from '../domain/template';
import { communicationTemplates } from '../infrastructure/schema';
import { blank, parse } from './communication-guards';

/**
 * MODELOS DE TEXTO (itens 21 a 25).
 *
 * O modelo é do TENANT e a permissão para mexer nele é própria: quem edita um
 * modelo muda o que todas as unidades vão dizer aos clientes amanhã, sem
 * enviar nada hoje. É configuração da empresa, não operação de balcão.
 *
 * NADA AQUI ENVIA MENSAGEM. Salvar um modelo não avisa ninguém.
 */

const draftSchema = z.object({
  name: z.string().trim().min(1, 'De um nome ao modelo.').max(TEMPLATE_NAME_MAX),
  channel: z.enum(COMMUNICATION_CHANNELS),
  purpose: z.enum(MESSAGE_PURPOSES).optional(),
  subject: z.string().trim().max(SUBJECT_MAX).optional().or(z.literal('')),
  body: z.string().trim().min(1, 'Escreva o texto do modelo.').max(BODY_MAX),
});

export type TemplateInput = z.infer<typeof draftSchema>;

export async function createTemplate(
  context: TenantContext,
  rawInput: unknown,
): Promise<{ templateId: string }> {
  const input = parse(draftSchema, rawInput);

  await authorize(context, {
    permission: PERMISSIONS.COMMUNICATIONS_TEMPLATES_MANAGE,
    featureKey: FEATURES.COMMUNICATIONS_CORE,
  });

  /** A validação do texto contra o catálogo de variáveis mora no domínio. */
  const draft = assertTemplateDraft({
    name: input.name,
    channel: input.channel,
    purpose: input.purpose ?? 'generic',
    subject: blank(input.subject),
    body: input.body,
  });

  const templateId = newId();
  const now = new Date();

  try {
    await runInTransaction(async (tx) => {
      await tx.insert(communicationTemplates).values({
        id: templateId,
        tenantId: context.tenantId,
        name: draft.name,
        nameNormalized: normalizeSearchable(draft.name),
        channel: draft.channel,
        purpose: draft.purpose,
        subject: draft.subject,
        body: draft.body,
        status: 'active',
        activeMarker: 1,
        createdBy: context.userId,
        updatedBy: context.userId,
        createdAt: now,
        updatedAt: now,
      });

      await recordAudit(
        {
          action: AUDIT_ACTIONS.MESSAGE_TEMPLATE_CREATED,
          entityType: 'communication_template',
          entityId: templateId,
          tenantId: context.tenantId,
          userId: context.userId,
          after: { channel: draft.channel, purpose: draft.purpose },
        },
        tx,
      );
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new ConflictError('Ja existe um modelo ativo com esse nome.');
    }
    throw error;
  }

  return { templateId };
}

const updateSchema = draftSchema.extend({
  templateId: z.string().trim().min(1),
  expectedVersion: z.coerce.number().int().positive().optional(),
});

/**
 * Edita o modelo.
 *
 * EDITAR O MODELO NÃO REESCREVE MENSAGEM NENHUMA (item 22). O texto já
 * enviado foi copiado para `communication_messages` no momento do envio;
 * daqui em diante o modelo novo vale para as mensagens novas. Se fosse
 * referência em vez de cópia, corrigir uma vírgula hoje mudaria o que o
 * histórico diz que o cliente leu no mês passado.
 *
 * O CANAL PODE MUDAR, mas o assunto segue o canal: virar WhatsApp apaga o
 * assunto, e o CHECK do banco recusaria qualquer outra combinação.
 */
export async function updateTemplate(context: TenantContext, rawInput: unknown): Promise<void> {
  const input = parse(updateSchema, rawInput);

  await authorize(context, {
    permission: PERMISSIONS.COMMUNICATIONS_TEMPLATES_MANAGE,
    featureKey: FEATURES.COMMUNICATIONS_CORE,
  });

  const draft = assertTemplateDraft({
    name: input.name,
    channel: input.channel,
    purpose: input.purpose ?? 'generic',
    subject: blank(input.subject),
    body: input.body,
  });

  const now = new Date();

  try {
    await runInTransaction(async (tx) => {
      /**
       * A CONDIÇÃO VAI NO `WHERE` (ADR-044). `status = 'active'` impede editar
       * um modelo arquivado, e a versão esperada — quando informada — faz duas
       * edições simultâneas resultarem numa recusa em vez de uma sobrescrita
       * silenciosa.
       */
      const resultado = await tx
        .update(communicationTemplates)
        .set({
          name: draft.name,
          nameNormalized: normalizeSearchable(draft.name),
          channel: draft.channel,
          purpose: draft.purpose,
          subject: draft.subject,
          body: draft.body,
          updatedBy: context.userId,
          updatedAt: now,
          version: sql`${communicationTemplates.version} + 1`,
        })
        .where(
          and(
            eq(communicationTemplates.id, input.templateId),
            eq(communicationTemplates.tenantId, context.tenantId),
            eq(communicationTemplates.status, 'active'),
            input.expectedVersion
              ? eq(communicationTemplates.version, input.expectedVersion)
              : sql`1 = 1`,
          ),
        );

      if (affectedRows(resultado) === 0) {
        throw new ConflictError(
          'O modelo mudou ou foi arquivado desde que esta tela abriu. Recarregue e tente de novo.',
        );
      }

      await recordAudit(
        {
          action: AUDIT_ACTIONS.MESSAGE_TEMPLATE_UPDATED,
          entityType: 'communication_template',
          entityId: input.templateId,
          tenantId: context.tenantId,
          userId: context.userId,
          after: { channel: draft.channel, purpose: draft.purpose },
        },
        tx,
      );
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new ConflictError('Ja existe um modelo ativo com esse nome.');
    }
    throw error;
  }
}

/**
 * ARQUIVA. NÃO APAGA (item 25).
 *
 * Mensagens enviadas apontam para o modelo que as produziu, e essa
 * procedência responde "este modelo anda gerando recusa?". Apagar a linha
 * apagaria a resposta — e a foreign key, que é `restrict`, recusaria de
 * qualquer forma.
 */
export async function archiveTemplate(context: TenantContext, templateId: string): Promise<void> {
  await authorize(context, {
    permission: PERMISSIONS.COMMUNICATIONS_TEMPLATES_MANAGE,
    featureKey: FEATURES.COMMUNICATIONS_CORE,
  });

  const now = new Date();

  await runInTransaction(async (tx) => {
    const resultado = await tx
      .update(communicationTemplates)
      .set({
        status: 'archived',
        /** NULL libera o nome para um modelo novo sem apagar este. */
        activeMarker: null,
        archivedAt: now,
        archivedBy: context.userId,
        updatedBy: context.userId,
        updatedAt: now,
        version: sql`${communicationTemplates.version} + 1`,
      })
      .where(
        and(
          eq(communicationTemplates.id, templateId),
          eq(communicationTemplates.tenantId, context.tenantId),
          eq(communicationTemplates.status, 'active'),
        ),
      );

    if (affectedRows(resultado) === 0) {
      throw new BusinessRuleError('Este modelo nao esta ativo.');
    }

    await recordAudit(
      {
        action: AUDIT_ACTIONS.MESSAGE_TEMPLATE_ARCHIVED,
        entityType: 'communication_template',
        entityId: templateId,
        tenantId: context.tenantId,
        userId: context.userId,
      },
      tx,
    );
  });
}

export interface TemplateSummary {
  id: string;
  name: string;
  channel: string;
  purpose: string;
  subject: string | null;
  body: string;
  status: string;
  version: number;
}

/** Os modelos do tenant. Ver modelo exige ver comunicação, não gerenciá-la. */
export async function listTemplates(
  context: TenantContext,
  options: { includeArchived?: boolean } = {},
): Promise<TemplateSummary[]> {
  await authorize(context, {
    permission: PERMISSIONS.COMMUNICATIONS_VIEW,
    featureKey: FEATURES.COMMUNICATIONS_CORE,
  });

  return getDb()
    .select({
      id: communicationTemplates.id,
      name: communicationTemplates.name,
      channel: communicationTemplates.channel,
      purpose: communicationTemplates.purpose,
      subject: communicationTemplates.subject,
      body: communicationTemplates.body,
      status: communicationTemplates.status,
      version: communicationTemplates.version,
    })
    .from(communicationTemplates)
    .where(
      and(
        eq(communicationTemplates.tenantId, context.tenantId),
        options.includeArchived ? sql`1 = 1` : eq(communicationTemplates.status, 'active'),
      ),
    )
    .orderBy(communicationTemplates.nameNormalized);
}

/** Um modelo específico, já garantido como do tenant de quem pergunta. */
export async function findTemplate(
  context: TenantContext,
  templateId: string,
): Promise<TemplateSummary> {
  await authorize(context, {
    permission: PERMISSIONS.COMMUNICATIONS_VIEW,
    featureKey: FEATURES.COMMUNICATIONS_CORE,
  });

  const [linha] = await getDb()
    .select({
      id: communicationTemplates.id,
      name: communicationTemplates.name,
      channel: communicationTemplates.channel,
      purpose: communicationTemplates.purpose,
      subject: communicationTemplates.subject,
      body: communicationTemplates.body,
      status: communicationTemplates.status,
      version: communicationTemplates.version,
    })
    .from(communicationTemplates)
    .where(
      and(
        eq(communicationTemplates.id, templateId),
        eq(communicationTemplates.tenantId, context.tenantId),
      ),
    )
    .limit(1);

  if (!linha) throw new NotFoundError('Modelo nao encontrado.');
  return linha;
}
