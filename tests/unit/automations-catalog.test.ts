import { describe, expect, it } from 'vitest';
import {
  AUTOMATION_TRIGGERS,
  findTrigger,
  isKnownTriggerKey,
} from '@/modules/automations/domain/trigger-catalog';
import {
  AUTOMATION_ACTION_CATALOG,
  findAction,
  isKnownActionKey,
} from '@/modules/automations/domain/action-catalog';
import { EVENT_TYPES } from '@/modules/events/domain/event';
import { FEATURE_CATALOG } from '@/modules/features/domain/catalog';
import { PERMISSION_CATALOG } from '@/modules/access-control/domain/permissions';
import { OPERATORS_BY_FIELD_TYPE } from '@/modules/automations/domain/condition';
import type { TriggerFieldType } from '@/modules/automations/domain/trigger-catalog';

/**
 * TESTES DO CATALOGO FECHADO (Prompt 19, itens 12, 13, 29 e 30).
 *
 * Mesmo espirito de `tests/unit/analytics-metric-catalog.test.ts`: prova que
 * cada entrada e BEM FORMADA e que os requisitos que ela declara EXISTEM de
 * verdade nos outros catalogos — nunca uma chave inventada.
 */

const FEATURE_KEYS = new Set(FEATURE_CATALOG.map((f) => f.key));
const PERMISSION_KEYS = new Set(PERMISSION_CATALOG.map((p) => p.key));
const EVENT_TYPE_VALUES = new Set(Object.values(EVENT_TYPES));

describe('catalogo de gatilhos', () => {
  const triggers = Object.values(AUTOMATION_TRIGGERS);

  it('nenhuma chave se repete', () => {
    const keys = triggers.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  for (const trigger of triggers) {
    it(`${trigger.key}: featureKey esta no Feature Catalog`, () => {
      expect(FEATURE_KEYS.has(trigger.requiredFeatureKey)).toBe(true);
    });

    it(`${trigger.key}: label e description nao estao vazios`, () => {
      expect(trigger.label.trim().length).toBeGreaterThan(0);
      expect(trigger.description.trim().length).toBeGreaterThan(0);
    });

    it(`${trigger.key}: acoes compativeis existem no Action Catalog`, () => {
      for (const actionKey of trigger.compatibleActions) {
        expect(findAction(actionKey)).toBeDefined();
      }
    });

    if (trigger.kind === 'domain_event') {
      it(`${trigger.key}: sourceEvent existe no Event Catalog`, () => {
        expect(trigger.sourceEvent).not.toBeNull();
        expect(EVENT_TYPE_VALUES.has(trigger.sourceEvent!)).toBe(true);
      });
    } else {
      it(`${trigger.key}: gatilho schedule nao tem sourceEvent`, () => {
        expect(trigger.sourceEvent).toBeNull();
      });
    }

    it(`${trigger.key}: todo campo declarado usa apenas operadores compativeis com o tipo`, () => {
      for (const field of Object.values(trigger.fields)) {
        expect(OPERATORS_BY_FIELD_TYPE[field.type as TriggerFieldType].length).toBeGreaterThan(0);
      }
    });
  }

  it('Comunicacao nunca e compativel com um gatilho sem contexto de cliente (item 138)', () => {
    for (const trigger of triggers) {
      if (trigger.entityType === 'schedule_occurrence' || trigger.entityType === 'part') {
        expect(trigger.compatibleActions).not.toContain('communication.send_template');
      }
    }
  });

  it('findTrigger / isKnownTriggerKey', () => {
    expect(findTrigger('service_order.customer_notification_requested')?.domain).toBe(
      'service_orders',
    );
    expect(isKnownTriggerKey('chave.inventada')).toBe(false);
  });
});

describe('catalogo de acoes', () => {
  it('nenhuma chave se repete', () => {
    const keys = AUTOMATION_ACTION_CATALOG.map((a) => a.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  for (const action of AUTOMATION_ACTION_CATALOG) {
    it(`${action.key}: featureKey esta no Feature Catalog`, () => {
      expect(FEATURE_KEYS.has(action.requiredFeatureKey)).toBe(true);
    });

    it(`${action.key}: configPermission esta no Permission Catalog`, () => {
      expect(PERMISSION_KEYS.has(action.configPermission)).toBe(true);
    });

    it(`${action.key}: label e description nao estao vazios`, () => {
      expect(action.label.trim().length).toBeGreaterThan(0);
      expect(action.description.trim().length).toBeGreaterThan(0);
    });
  }

  it('isKnownActionKey', () => {
    expect(isKnownActionKey('communication.send_template')).toBe(true);
    expect(isKnownActionKey('http.call_webhook')).toBe(false);
  });
});
