import { z } from 'zod';
import { EVENT_TYPES, type EventType } from '@/modules/events/domain/event';
import { FEATURES, type FeatureKey } from '@/modules/features/domain/catalog';

/** `HH:mm`, 24h, sem segundos — o mesmo grao de precisao do tick do coordenador. */
export const scheduleDailyConfigSchema = z.object({
  timeOfDay: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use o formato HH:mm.'),
});
export type ScheduleDailyConfig = z.infer<typeof scheduleDailyConfigSchema>;

/**
 * CATALOGO FECHADO DE GATILHOS (Prompt 19, itens 12, 13 e 15 a 17).
 *
 * "Toda automacao comeca de um FATO, nunca de uma string arbitraria que
 * alguem digitou." Uma regra so pode referenciar uma das chaves abaixo — o
 * RuleValidator rejeita qualquer outra (item 171). Nenhum evento tecnico do
 * Event Catalog entra aqui automaticamente: cada linha foi escolhida a dedo,
 * na inspecao profunda que precedeu este arquivo, entre os eventos que ja
 * tem comentario no proprio codigo dizendo "o Prompt 19 se conecta aqui".
 *
 * DUAS FAMILIAS (item 11): `domain_event` (reage a um fato que ja aconteceu)
 * e `schedule` (reage a um horario). `fields` e o catalogo fechado de campos
 * que uma CONDICAO pode usar (item 23) — nunca um path arbitrario do payload.
 * `compatibleActions` e o que impede, por construcao, uma acao de Comunicacao
 * numa regra agendada sem cliente nenhum no contexto (item 138).
 */

export type TriggerFieldType = 'string' | 'number' | 'boolean';

export interface TriggerFieldDefinition {
  readonly type: TriggerFieldType;
  readonly label: string;
}

export type AutomationTriggerKind = 'domain_event' | 'schedule';

export interface AutomationTriggerDefinition {
  readonly key: string;
  readonly label: string;
  readonly kind: AutomationTriggerKind;
  /** Evento de origem no Event Catalog. `null` para gatilhos `schedule`. */
  readonly sourceEvent: EventType | null;
  readonly domain: string;
  /** Feature que precisa estar ligada para o FATO existir (nao a do Motor). */
  readonly requiredFeatureKey: FeatureKey;
  readonly entityType: string;
  /**
   * Campo do payload que carrega a unidade do fato, quando existe. `null`
   * quando o gatilho nao tem unidade propria (ex.: agendamento).
   */
  readonly unitField: string | null;
  readonly fields: Readonly<Record<string, TriggerFieldDefinition>>;
  readonly compatibleActions: readonly string[];
  /** `true` quando alguma acao compativel pode produzir efeito PARA FORA
   *  do sistema (mensagem ao cliente) — usado pela UI (item 104). */
  readonly hasExternalEffectsPossible: boolean;
  /** Configuracao PROPRIA do gatilho (ex.: horario do agendamento). `null`
   *  quando o gatilho nao precisa de nenhuma (a maioria dos `domain_event`). */
  readonly configSchema: z.ZodTypeAny | null;
  readonly description: string;
}

export const AUTOMATION_TRIGGERS = {
  SERVICE_ORDER_CUSTOMER_NOTIFICATION_REQUESTED: {
    key: 'service_order.customer_notification_requested',
    label: 'Cliente marcado como avisado (Ordem de Servico)',
    kind: 'domain_event',
    sourceEvent: EVENT_TYPES.SERVICE_ORDER_CUSTOMER_NOTIFICATION_REQUESTED,
    domain: 'service_orders',
    requiredFeatureKey: FEATURES.CORE_SERVICE_ORDERS,
    entityType: 'service_order',
    unitField: 'unitId',
    fields: {
      unitId: { type: 'string', label: 'Unidade' },
      reason: { type: 'string', label: 'Motivo' },
      number: { type: 'number', label: 'Numero da OS' },
    },
    compatibleActions: ['communication.send_template', 'agenda.create_task'],
    hasExternalEffectsPossible: true,
    configSchema: null,
    description:
      'Dispara quando alguem confirma, pela tela da OS, que o cliente precisa ser avisado (ex.: "Informar Ordem Disponivel"). E a fronteira que o Prompt 16 deixou pronta e o Prompt 19 fecha.',
  },
  LOW_STOCK_DETECTED: {
    key: 'inventory.low_stock_detected',
    label: 'Estoque abaixo do minimo',
    kind: 'domain_event',
    sourceEvent: EVENT_TYPES.LOW_STOCK_DETECTED,
    domain: 'inventory',
    requiredFeatureKey: FEATURES.OPERATIONS_INVENTORY,
    entityType: 'part',
    unitField: 'unitId',
    fields: {
      unitId: { type: 'string', label: 'Unidade' },
      partId: { type: 'string', label: 'Peca' },
      onHand: { type: 'number', label: 'Saldo disponivel' },
      minimumQuantity: { type: 'number', label: 'Quantidade minima' },
    },
    /**
     * SEM Comunicacao (item 138): o fato nao tem cliente nenhum associado —
     * nao ha para quem mandar mensagem. So Agenda, para criar tarefa de
     * providenciar reposicao.
     */
    compatibleActions: ['agenda.create_task'],
    hasExternalEffectsPossible: false,
    configSchema: null,
    description: 'Dispara quando uma peca cai abaixo da quantidade minima configurada.',
  },
  SCHEDULE_DAILY: {
    key: 'schedule.daily',
    label: 'Agendamento diario',
    kind: 'schedule',
    sourceEvent: null,
    domain: 'schedule',
    requiredFeatureKey: FEATURES.AUTOMATION_CORE,
    entityType: 'schedule_occurrence',
    unitField: null,
    /** Sem campos: um horario nao tem payload de fato para condicionar (V1). */
    fields: {},
    /**
     * SEM Comunicacao (item 138): um agendamento nao carrega cliente nem
     * destinatario — nao ha contexto de quem mandar mensagem para.
     */
    compatibleActions: ['agenda.create_task'],
    hasExternalEffectsPossible: false,
    configSchema: scheduleDailyConfigSchema,
    description:
      'Dispara todo dia, num horario local configurado, para uma unidade da regra. Nao depende de nenhum fato: e o proprio calendario.',
  },
} as const satisfies Record<string, AutomationTriggerDefinition>;

export type AutomationTriggerName = keyof typeof AUTOMATION_TRIGGERS;

const BY_KEY = new Map<string, AutomationTriggerDefinition>(
  Object.values(AUTOMATION_TRIGGERS).map((t) => [t.key, t]),
);

const BY_SOURCE_EVENT = new Map<EventType, AutomationTriggerDefinition[]>();
for (const trigger of Object.values(AUTOMATION_TRIGGERS)) {
  if (!trigger.sourceEvent) continue;
  const list = BY_SOURCE_EVENT.get(trigger.sourceEvent) ?? [];
  list.push(trigger);
  BY_SOURCE_EVENT.set(trigger.sourceEvent, list);
}

export function findTrigger(key: string): AutomationTriggerDefinition | undefined {
  return BY_KEY.get(key);
}

export function triggersForEvent(type: EventType): readonly AutomationTriggerDefinition[] {
  return BY_SOURCE_EVENT.get(type) ?? [];
}

export function isKnownTriggerKey(key: string): boolean {
  return BY_KEY.has(key);
}
