'use client';

import { useActionState, useMemo, useState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  FormField,
  Input,
  Radio,
  Select,
  Textarea,
} from '@/design-system/components';
import {
  CONDITION_OPERATORS,
  type ConditionOperator,
} from '@/modules/automations/domain/condition';
import {
  createRuleAction,
  setRuleEnabledAction,
  archiveRuleAction,
  updateRuleDefinitionAction,
} from './actions';
import { EMPTY_AUTOMATION_STATE, type AutomationActionState } from './action-state';

/**
 * O EDITOR DE REGRA (Prompt 19, itens 99 e 102).
 *
 * UM FORMULARIO ESTRUTURADO, NUNCA UM CANVAS (item 99): trigger, condicoes e
 * acoes sao listas simples, no mesmo padrao de linhas repetiveis do editor de
 * orcamento (`quote-editor.tsx`) — adicionar/remover linha, nunca arrastar
 * caixa nem desenhar seta.
 *
 * A definicao inteira (gatilho + condicoes + acoes) vai num UNICO campo
 * oculto, serializado em JSON no cliente e revalidada de ponta a ponta no
 * servidor por `parseRuleDefinition` (o mesmo portao usado pela leitura) —
 * o cliente nunca e a fonte de verdade do que e uma regra valida.
 */

export interface TriggerFieldInfo {
  name: string;
  label: string;
  type: 'string' | 'number' | 'boolean';
}

export interface TriggerClientInfo {
  key: string;
  label: string;
  kind: 'domain_event' | 'schedule';
  fields: TriggerFieldInfo[];
  compatibleActions: string[];
  needsScheduleConfig: boolean;
}

export interface TemplateOption {
  id: string;
  name: string;
  channel: string;
}

export interface UnitOption {
  id: string;
  name: string;
}

interface ConditionRow {
  key: string;
  field: string;
  operator: ConditionOperator;
  value: string;
}

type ActionRow =
  | { key: string; kind: 'communication.send_template'; templateId: string; channel: string }
  | {
      key: string;
      kind: 'agenda.create_task';
      title: string;
      notes: string;
      dueOffsetDays: string;
    };

let rowCounter = 0;
function nextKey(prefix: string): string {
  rowCounter += 1;
  return `${prefix}-${rowCounter}`;
}

const OPERATOR_LABEL: Record<ConditionOperator, string> = {
  equals: 'e igual a',
  not_equals: 'e diferente de',
  in: 'esta na lista',
  not_in: 'nao esta na lista',
  exists: 'existe',
  not_exists: 'nao existe',
  greater_than: 'e maior que',
  greater_or_equal: 'e maior ou igual a',
  less_than: 'e menor que',
  less_or_equal: 'e menor ou igual a',
};

function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" loading={pending} disabled={pending}>
      {children}
    </Button>
  );
}

function Feedback({ state }: { state: AutomationActionState }) {
  return (
    <div aria-live="polite" className="space-y-2">
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}
    </div>
  );
}

export interface RuleEditorProps {
  mode: 'create' | 'edit';
  ruleId?: string;
  initialName?: string;
  initialScopeKind?: 'UNIT_SET' | 'TENANT_WIDE';
  initialUnitIds?: string[];
  initialTriggerKey?: string;
  initialTriggerConfig?: { timeOfDay?: string };
  initialConditions?: Array<{ field: string; operator: string; value?: unknown }>;
  initialActions?: Array<{ key: string; config: Record<string, unknown> }>;
  units: UnitOption[];
  triggers: TriggerClientInfo[];
  templates: TemplateOption[];
  canTenantWide: boolean;
}

export function RuleEditor(props: RuleEditorProps) {
  const isEdit = props.mode === 'edit';
  const action = isEdit ? updateRuleDefinitionAction : createRuleAction;
  const [state, formAction] = useActionState<AutomationActionState, FormData>(
    action,
    EMPTY_AUTOMATION_STATE,
  );

  const [name, setName] = useState(props.initialName ?? '');
  const [scopeKind, setScopeKind] = useState<'UNIT_SET' | 'TENANT_WIDE'>(
    props.initialScopeKind ?? 'UNIT_SET',
  );
  const [unitIds, setUnitIds] = useState<string[]>(props.initialUnitIds ?? []);
  const [triggerKey, setTriggerKey] = useState(
    props.initialTriggerKey ?? props.triggers[0]?.key ?? '',
  );
  const [timeOfDay, setTimeOfDay] = useState(props.initialTriggerConfig?.timeOfDay ?? '09:00');

  const trigger = useMemo(
    () => props.triggers.find((t) => t.key === triggerKey),
    [props.triggers, triggerKey],
  );

  const [conditions, setConditions] = useState<ConditionRow[]>(() =>
    (props.initialConditions ?? []).map((c) => ({
      key: nextKey('cond'),
      field: c.field,
      operator: c.operator as ConditionOperator,
      value: c.value === undefined ? '' : String(c.value),
    })),
  );

  const [actions, setActions] = useState<ActionRow[]>(() =>
    (props.initialActions ?? []).map((a) => toActionRow(a)),
  );

  const scopeAllowsSchedule = scopeKind === 'UNIT_SET' && unitIds.length > 0;

  const definitionJson = useMemo(() => {
    const definition = {
      schemaVersion: 1,
      triggerKey,
      triggerConfig: trigger?.needsScheduleConfig ? { timeOfDay } : undefined,
      conditions: {
        all: conditions
          .filter((c) => c.field)
          .map((c) => ({
            field: c.field,
            operator: c.operator,
            value:
              c.operator === 'exists' || c.operator === 'not_exists'
                ? undefined
                : parseValue(c.value),
          })),
      },
      actions: actions.map((a) => ({ key: a.key, config: actionRowConfig(a) })),
    };
    return JSON.stringify(definition);
  }, [triggerKey, trigger, timeOfDay, conditions, actions]);

  function toggleUnit(unitId: string) {
    setUnitIds((current) =>
      current.includes(unitId) ? current.filter((u) => u !== unitId) : [...current, unitId],
    );
  }

  function addCondition() {
    setConditions((c) => [
      ...c,
      {
        key: nextKey('cond'),
        field: trigger?.fields[0]?.name ?? '',
        operator: 'equals',
        value: '',
      },
    ]);
  }

  function addAction(kind: ActionRow['kind']) {
    setActions((a) => [
      ...a,
      kind === 'communication.send_template'
        ? {
            key: 'communication.send_template',
            kind,
            templateId: props.templates[0]?.id ?? '',
            channel: props.templates[0]?.channel ?? 'whatsapp',
          }
        : { key: 'agenda.create_task', kind, title: '', notes: '', dueOffsetDays: '' },
    ]);
  }

  return (
    <form action={formAction} className="space-y-6">
      {isEdit ? <input type="hidden" name="ruleId" value={props.ruleId} /> : null}
      <input type="hidden" name="definitionJson" value={definitionJson} />

      <Card>
        <CardHeader title="Nome" headingLevel={2} />
        <CardBody>
          <FormField id="rule-name" label="Nome da regra" required>
            {(field) => (
              <Input
                {...field}
                name="name"
                required
                maxLength={160}
                value={name}
                disabled={isEdit}
                onChange={(e) => setName(e.target.value)}
              />
            )}
          </FormField>
          {isEdit ? (
            <p className="text-sm text-ink-500">O nome nao muda ao editar a definicao.</p>
          ) : null}
        </CardBody>
      </Card>

      {!isEdit ? (
        <Card>
          <CardHeader title="Escopo" headingLevel={2} />
          <CardBody className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:gap-6">
              <Radio
                name="scopeKindChoice"
                checked={scopeKind === 'UNIT_SET'}
                onChange={() => setScopeKind('UNIT_SET')}
                label="Unidades especificas"
              />
              <Radio
                name="scopeKindChoice"
                checked={scopeKind === 'TENANT_WIDE'}
                onChange={() => setScopeKind('TENANT_WIDE')}
                label="Toda a empresa"
                disabled={!props.canTenantWide}
              />
            </div>
            <input type="hidden" name="scopeKind" value={scopeKind} />
            {scopeKind === 'UNIT_SET' ? (
              <div className="flex flex-wrap gap-3">
                {props.units.map((unit) => (
                  <div key={unit.id}>
                    <Checkbox
                      checked={unitIds.includes(unit.id)}
                      onChange={() => toggleUnit(unit.id)}
                      label={unit.name}
                    />
                    {unitIds.includes(unit.id) ? (
                      <input type="hidden" name="unitIds" value={unit.id} />
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-ink-500">
                Opera em qualquer unidade autorizada quando o fato acontecer.
              </p>
            )}
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader title="Gatilho" headingLevel={2} />
        <CardBody className="space-y-3">
          <FormField id="trigger-key" label="Quando" required>
            {(field) => (
              <Select
                {...field}
                value={triggerKey}
                disabled={isEdit}
                onChange={(e) => setTriggerKey(e.target.value)}
              >
                {props.triggers.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          {trigger?.needsScheduleConfig ? (
            <FormField
              id="time-of-day"
              label="Horario (fuso da empresa)"
              required
              hint="Dispara alguns minutos depois deste horario."
            >
              {(field) => (
                <Input
                  {...field}
                  type="time"
                  value={timeOfDay}
                  onChange={(e) => setTimeOfDay(e.target.value)}
                />
              )}
            </FormField>
          ) : null}
          {trigger?.kind === 'schedule' && !scopeAllowsSchedule && !isEdit ? (
            <Alert tone="warning">
              Regras agendadas exigem uma ou mais unidades especificas escolhidas acima.
            </Alert>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Condicoes (opcional)" headingLevel={2} />
        <CardBody className="space-y-3">
          {conditions.length === 0 ? (
            <p className="text-sm text-ink-500">
              Sem condicoes: a regra dispara sempre que o gatilho acontecer.
            </p>
          ) : null}
          <ul className="space-y-3">
            {conditions.map((row) => (
              <li key={row.key} className="rounded-lg border border-ink-200 p-3">
                <div className="grid gap-3 sm:grid-cols-12 sm:items-end">
                  <div className="sm:col-span-4">
                    <FormField id={`cond-field-${row.key}`} label="Campo">
                      {(field) => (
                        <Select
                          {...field}
                          value={row.field}
                          onChange={(e) =>
                            updateCondition(setConditions, row.key, { field: e.target.value })
                          }
                        >
                          {(trigger?.fields ?? []).map((f) => (
                            <option key={f.name} value={f.name}>
                              {f.label}
                            </option>
                          ))}
                        </Select>
                      )}
                    </FormField>
                  </div>
                  <div className="sm:col-span-4">
                    <FormField id={`cond-op-${row.key}`} label="Operador">
                      {(field) => (
                        <Select
                          {...field}
                          value={row.operator}
                          onChange={(e) =>
                            updateCondition(setConditions, row.key, {
                              operator: e.target.value as ConditionOperator,
                            })
                          }
                        >
                          {CONDITION_OPERATORS.map((op) => (
                            <option key={op} value={op}>
                              {OPERATOR_LABEL[op]}
                            </option>
                          ))}
                        </Select>
                      )}
                    </FormField>
                  </div>
                  {row.operator !== 'exists' && row.operator !== 'not_exists' ? (
                    <div className="sm:col-span-3">
                      <FormField id={`cond-value-${row.key}`} label="Valor">
                        {(field) => (
                          <Input
                            {...field}
                            value={row.value}
                            onChange={(e) =>
                              updateCondition(setConditions, row.key, { value: e.target.value })
                            }
                          />
                        )}
                      </FormField>
                    </div>
                  ) : null}
                  <div className="sm:col-span-1">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setConditions((c) => c.filter((r) => r.key !== row.key))}
                    >
                      Remover
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <Button
            type="button"
            variant="secondary"
            onClick={addCondition}
            disabled={!trigger || trigger.fields.length === 0}
          >
            Adicionar condicao
          </Button>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Acoes" headingLevel={2} />
        <CardBody className="space-y-3">
          <ul className="space-y-4">
            {actions.map((row, index) => (
              <li key={index} className="rounded-lg border border-ink-200 p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <Badge tone="neutral">
                    {row.kind === 'communication.send_template' ? 'Comunicacao' : 'Agenda'}
                  </Badge>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setActions((a) => a.filter((_, i) => i !== index))}
                  >
                    Remover acao
                  </Button>
                </div>
                {row.kind === 'communication.send_template' ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <FormField id={`action-template-${index}`} label="Modelo" required>
                      {(field) => (
                        <Select
                          {...field}
                          value={row.templateId}
                          onChange={(e) => {
                            const template = props.templates.find((t) => t.id === e.target.value);
                            setActions((a) =>
                              a.map((r, i) =>
                                i === index
                                  ? ({
                                      ...r,
                                      templateId: e.target.value,
                                      channel:
                                        template?.channel ?? (r as { channel: string }).channel,
                                    } as ActionRow)
                                  : r,
                              ),
                            );
                          }}
                        >
                          {props.templates.length === 0 ? (
                            <option value="">Nenhum modelo ativo</option>
                          ) : null}
                          {props.templates.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name} ({t.channel})
                            </option>
                          ))}
                        </Select>
                      )}
                    </FormField>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <FormField id={`action-title-${index}`} label="Titulo da tarefa" required>
                      {(field) => (
                        <Input
                          {...field}
                          maxLength={160}
                          value={row.title}
                          onChange={(e) =>
                            setActions((a) =>
                              a.map((r, i) =>
                                i === index ? ({ ...r, title: e.target.value } as ActionRow) : r,
                              ),
                            )
                          }
                        />
                      )}
                    </FormField>
                    <FormField id={`action-notes-${index}`} label="Observacoes (opcional)">
                      {(field) => (
                        <Textarea
                          {...field}
                          maxLength={2000}
                          value={row.notes}
                          onChange={(e) =>
                            setActions((a) =>
                              a.map((r, i) =>
                                i === index ? ({ ...r, notes: e.target.value } as ActionRow) : r,
                              ),
                            )
                          }
                        />
                      )}
                    </FormField>
                    <FormField
                      id={`action-due-${index}`}
                      label="Vencimento (dias a partir de hoje, opcional)"
                    >
                      {(field) => (
                        <Input
                          {...field}
                          type="number"
                          min={0}
                          max={90}
                          value={row.dueOffsetDays}
                          onChange={(e) =>
                            setActions((a) =>
                              a.map((r, i) =>
                                i === index
                                  ? ({ ...r, dueOffsetDays: e.target.value } as ActionRow)
                                  : r,
                              ),
                            )
                          }
                        />
                      )}
                    </FormField>
                  </div>
                )}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-3">
            {(trigger?.compatibleActions ?? []).includes('communication.send_template') ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => addAction('communication.send_template')}
              >
                Adicionar acao de Comunicacao
              </Button>
            ) : null}
            {(trigger?.compatibleActions ?? []).includes('agenda.create_task') ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => addAction('agenda.create_task')}
              >
                Adicionar acao de Agenda
              </Button>
            ) : null}
          </div>
        </CardBody>
      </Card>

      <Feedback state={state} />

      <div className="flex justify-end gap-3">
        <SubmitButton>{isEdit ? 'Salvar nova versao' : 'Salvar regra (desabilitada)'}</SubmitButton>
      </div>
    </form>
  );
}

function updateCondition(
  setConditions: React.Dispatch<React.SetStateAction<ConditionRow[]>>,
  key: string,
  patch: Partial<ConditionRow>,
): void {
  setConditions((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
}

function parseValue(raw: string): string | number {
  if (raw.trim() !== '' && !Number.isNaN(Number(raw))) return Number(raw);
  return raw;
}

function actionRowConfig(row: ActionRow): Record<string, unknown> {
  if (row.kind === 'communication.send_template') {
    return { templateId: row.templateId, channel: row.channel };
  }
  return {
    title: row.title,
    notes: row.notes || undefined,
    dueOffsetDays: row.dueOffsetDays ? Number(row.dueOffsetDays) : undefined,
  };
}

function toActionRow(a: { key: string; config: Record<string, unknown> }): ActionRow {
  if (a.key === 'communication.send_template') {
    return {
      key: a.key,
      kind: 'communication.send_template',
      templateId: String(a.config.templateId ?? ''),
      channel: String(a.config.channel ?? 'whatsapp'),
    };
  }
  return {
    key: a.key,
    kind: 'agenda.create_task',
    title: String(a.config.title ?? ''),
    notes: String(a.config.notes ?? ''),
    dueOffsetDays: a.config.dueOffsetDays === undefined ? '' : String(a.config.dueOffsetDays),
  };
}

// ---------------------------------------------------------------------------
// Botoes de acao simples (habilitar/desabilitar/arquivar)
// ---------------------------------------------------------------------------

export function EnableToggleForm({
  ruleId,
  enabled,
  hasExternalEffect,
}: {
  ruleId: string;
  enabled: boolean;
  hasExternalEffect: boolean;
}) {
  const [state, formAction] = useActionState<AutomationActionState, FormData>(
    setRuleEnabledAction,
    EMPTY_AUTOMATION_STATE,
  );
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="ruleId" value={ruleId} />
      <input type="hidden" name="enabled" value={String(!enabled)} />
      {!enabled && hasExternalEffect ? (
        <p className="text-sm text-ink-600">
          Habilitar esta regra pode gerar comunicacao automatica com o cliente.
        </p>
      ) : null}
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      <SubmitButton>{enabled ? 'Desabilitar' : 'Habilitar'}</SubmitButton>
    </form>
  );
}

export function ArchiveRuleForm({ ruleId }: { ruleId: string }) {
  const [state, formAction] = useActionState<AutomationActionState, FormData>(
    archiveRuleAction,
    EMPTY_AUTOMATION_STATE,
  );
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="ruleId" value={ruleId} />
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      <Button type="submit" variant="ghost">
        Arquivar regra
      </Button>
    </form>
  );
}
