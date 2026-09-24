import { z } from 'zod';
import { PERMISSIONS, type PermissionKey } from '@/modules/access-control/domain/permissions';
import { COMMUNICATION_CHANNELS } from '@/modules/communications/domain/communication';
import { FEATURES, type FeatureKey } from '@/modules/features/domain/catalog';

/**
 * CATALOGO FECHADO DE ACOES (Prompt 19, itens 29 e 30).
 *
 * Duas acoes na V1, e as duas tem fronteira clara: orquestram um SERVICO
 * OFICIAL de outro modulo, nunca escrevem tabela alheia (item 143), nunca
 * chamam infraestrutura concreta de provider (item 219/220). Nada aqui
 * executa codigo, SQL ou HTTP arbitrario (itens 22, 97 e 173/174).
 *
 * `configPermission` e a AUTORIDADE DE CONFIGURACAO (item 64): quem cria ou
 * edita uma regra com esta acao precisa ter, no proprio escopo da regra,
 * ALEM de `automations.manage`. `configSchema` valida o config da acao ao
 * salvar a versao — tamanho e forma limitados (item 137), nunca "aceita
 * qualquer coisa" (item 122).
 */

export const AUTOMATION_ACTION_KEYS = {
  COMMUNICATION_SEND_TEMPLATE: 'communication.send_template',
  AGENDA_CREATE_TASK: 'agenda.create_task',
} as const;

export type AutomationActionKey =
  (typeof AUTOMATION_ACTION_KEYS)[keyof typeof AUTOMATION_ACTION_KEYS];

export const communicationSendTemplateConfigSchema = z.object({
  templateId: z.string().trim().min(1),
  channel: z.enum(COMMUNICATION_CHANNELS),
});
export type CommunicationSendTemplateConfig = z.infer<typeof communicationSendTemplateConfigSchema>;

export const agendaCreateTaskConfigSchema = z.object({
  title: z.string().trim().min(1).max(160),
  notes: z.string().trim().max(2000).optional(),
  /** Dias corridos a partir de hoje (item 38); sem hora — `due_date` e civil. */
  dueOffsetDays: z.number().int().min(0).max(90).optional(),
});
export type AgendaCreateTaskConfig = z.infer<typeof agendaCreateTaskConfigSchema>;

export interface AutomationActionDefinition {
  readonly key: AutomationActionKey;
  readonly label: string;
  readonly targetModule: string;
  readonly requiredFeatureKey: FeatureKey;
  readonly configPermission: PermissionKey;
  readonly hasExternalEffect: boolean;
  readonly configSchema: z.ZodTypeAny;
  readonly idempotencyStrategy: string;
  readonly description: string;
}

export const AUTOMATION_ACTION_CATALOG: readonly AutomationActionDefinition[] = [
  {
    key: AUTOMATION_ACTION_KEYS.COMMUNICATION_SEND_TEMPLATE,
    label: 'Enviar comunicacao ao cliente (modelo)',
    targetModule: 'communications',
    requiredFeatureKey: FEATURES.COMMUNICATIONS_CORE,
    configPermission: PERMISSIONS.COMMUNICATIONS_SEND,
    hasExternalEffect: true,
    configSchema: communicationSendTemplateConfigSchema,
    idempotencyStrategy:
      '`automation:{executionId}:action:{actionIndex}` -> communication_messages.idempotency_key (UNIQUE tenant+chave).',
    description:
      'Usa o servico oficial de Comunicacao com um modelo existente. O destinatario sai do CONTATO PRINCIPAL do cliente no canal do modelo, nunca de texto digitado na regra.',
  },
  {
    key: AUTOMATION_ACTION_KEYS.AGENDA_CREATE_TASK,
    label: 'Criar tarefa na Agenda',
    targetModule: 'agenda',
    requiredFeatureKey: FEATURES.OPERATIONS_AGENDA,
    configPermission: PERMISSIONS.AGENDA_TASKS_CREATE,
    hasExternalEffect: false,
    configSchema: agendaCreateTaskConfigSchema,
    idempotencyStrategy:
      '`automation:{executionId}:action:{actionIndex}` -> agenda_tasks.idempotency_key (UNIQUE tenant+chave).',
    description:
      'Usa o servico oficial da Agenda. Titulo e observacoes sao texto estatico da regra; nunca interpolacao livre.',
  },
];

const BY_KEY = new Map<string, AutomationActionDefinition>(
  AUTOMATION_ACTION_CATALOG.map((a) => [a.key, a]),
);

export function findAction(key: string): AutomationActionDefinition | undefined {
  return BY_KEY.get(key);
}

export function isKnownActionKey(key: string): key is AutomationActionKey {
  return BY_KEY.has(key);
}
