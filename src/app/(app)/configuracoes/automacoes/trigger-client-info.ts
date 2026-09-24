import { AUTOMATION_TRIGGERS } from '@/modules/automations/domain/trigger-catalog';
import type { TriggerClientInfo } from './automation-forms';

/**
 * Projeta o Trigger Catalog (servidor) para o formato SERIALIZAVEL que o
 * editor cliente precisa — nunca o objeto inteiro (que carrega `z.ZodTypeAny`,
 * nao serializavel pela fronteira Server->Client).
 */
export function triggersForClient(): TriggerClientInfo[] {
  return Object.values(AUTOMATION_TRIGGERS).map((trigger) => ({
    key: trigger.key,
    label: trigger.label,
    kind: trigger.kind,
    fields: Object.entries(trigger.fields).map(([name, field]) => ({
      name,
      label: field.label,
      type: field.type,
    })),
    compatibleActions: [...trigger.compatibleActions],
    needsScheduleConfig: trigger.configSchema !== null,
  }));
}
