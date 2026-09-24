import { describe, expect, it } from 'vitest';
import {
  MAX_ACTIONS_PER_RULE,
  MAX_CONDITIONS_PER_RULE,
  parseRuleDefinition,
} from '@/modules/automations/domain/rule-definition';

/**
 * TESTES DO PORTAO DE ESCRITA DA DEFINICAO (Prompt 19, itens 121 a 123 e
 * 136 a 138 e 171).
 *
 * `parseRuleDefinition` e o UNICO lugar que decide se um JSON vira uma
 * definicao valida — os testes de injecao (item 171) vivem aqui.
 */

const validNotificationDefinition = {
  schemaVersion: 1,
  triggerKey: 'service_order.customer_notification_requested',
  conditions: { all: [] },
  actions: [
    { key: 'communication.send_template', config: { templateId: 't1', channel: 'whatsapp' } },
  ],
};

describe('caminho feliz', () => {
  it('aceita uma definicao bem formada', () => {
    const result = parseRuleDefinition(validNotificationDefinition);
    expect(result.ok).toBe(true);
  });

  it('aceita condicoes compativeis com o tipo do campo declarado pelo gatilho', () => {
    const result = parseRuleDefinition({
      ...validNotificationDefinition,
      conditions: { all: [{ field: 'reason', operator: 'equals', value: 'ready_for_pickup' }] },
    });
    expect(result.ok).toBe(true);
  });
});

describe('injecao / payload invalido (item 171)', () => {
  it('rejeita gatilho desconhecido', () => {
    const result = parseRuleDefinition({
      ...validNotificationDefinition,
      triggerKey: 'gatilho.inventado',
    });
    expect(result.ok).toBe(false);
  });

  it('rejeita acao desconhecida', () => {
    const result = parseRuleDefinition({
      ...validNotificationDefinition,
      actions: [{ key: 'http.call_webhook', config: { url: 'https://evil.example' } }],
    });
    expect(result.ok).toBe(false);
  });

  it('rejeita campo de condicao que o gatilho nao declara', () => {
    const result = parseRuleDefinition({
      ...validNotificationDefinition,
      conditions: { all: [{ field: 'customer.passwordHash', operator: 'equals', value: 'x' }] },
    });
    expect(result.ok).toBe(false);
  });

  it('rejeita operador incompativel com o tipo do campo (item 26)', () => {
    const result = parseRuleDefinition({
      ...validNotificationDefinition,
      conditions: { all: [{ field: 'reason', operator: 'greater_than', value: 5 }] },
    });
    expect(result.ok).toBe(false);
  });

  it('rejeita acao incompativel com o gatilho (item 138): Comunicacao num agendamento', () => {
    const result = parseRuleDefinition({
      schemaVersion: 1,
      triggerKey: 'schedule.daily',
      triggerConfig: { timeOfDay: '09:00' },
      conditions: { all: [] },
      actions: [
        { key: 'communication.send_template', config: { templateId: 't1', channel: 'whatsapp' } },
      ],
    });
    expect(result.ok).toBe(false);
  });

  it('rejeita configuracao de acao invalida (item 122: JSON nunca e "aceita qualquer coisa")', () => {
    const result = parseRuleDefinition({
      ...validNotificationDefinition,
      actions: [{ key: 'communication.send_template', config: { templateId: '', channel: 'fax' } }],
    });
    expect(result.ok).toBe(false);
  });

  it('rejeita payload sobredimensionado: mais condicoes que o limite', () => {
    const conditions = Array.from({ length: MAX_CONDITIONS_PER_RULE + 1 }, () => ({
      field: 'reason',
      operator: 'equals' as const,
      value: 'x',
    }));
    const result = parseRuleDefinition({
      ...validNotificationDefinition,
      conditions: { all: conditions },
    });
    expect(result.ok).toBe(false);
  });

  it('rejeita payload sobredimensionado: mais acoes que o limite', () => {
    const actions = Array.from({ length: MAX_ACTIONS_PER_RULE + 1 }, () => ({
      key: 'agenda.create_task',
      config: { title: 'x' },
    }));
    const result = parseRuleDefinition({ ...validNotificationDefinition, actions });
    expect(result.ok).toBe(false);
  });

  it('rejeita schemaVersion desconhecida', () => {
    const result = parseRuleDefinition({ ...validNotificationDefinition, schemaVersion: 99 });
    expect(result.ok).toBe(false);
  });

  it('rejeita triggerConfig ausente quando o gatilho exige (schedule.daily)', () => {
    const result = parseRuleDefinition({
      schemaVersion: 1,
      triggerKey: 'schedule.daily',
      conditions: { all: [] },
      actions: [{ key: 'agenda.create_task', config: { title: 'Conferir estoque' } }],
    });
    expect(result.ok).toBe(false);
  });

  it('rejeita string/objeto/numero cru no lugar da definicao', () => {
    expect(parseRuleDefinition('nao e um objeto').ok).toBe(false);
    expect(parseRuleDefinition(42).ok).toBe(false);
    expect(parseRuleDefinition(null).ok).toBe(false);
    expect(parseRuleDefinition(undefined).ok).toBe(false);
  });
});
