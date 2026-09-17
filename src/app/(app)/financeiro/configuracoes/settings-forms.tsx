'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  Alert,
  Button,
  FormField,
  Input,
  Select,
  type ButtonVariant,
} from '@/design-system/components';
import {
  ACCOUNT_KIND_LABEL,
  ACCOUNT_KINDS,
  ACCOUNT_NAME_MAX,
  CATEGORY_KIND_LABEL,
  CATEGORY_KINDS,
  CATEGORY_NAME_MAX,
  PAYMENT_METHOD_KIND_LABEL,
  PAYMENT_METHOD_KINDS,
} from '@/modules/finance/domain/finance';
import { EMPTY_FINANCE_STATE, type FinanceActionState } from '../action-state';

type ActionFn = (previous: FinanceActionState, formData: FormData) => Promise<FinanceActionState>;

export interface UnitOption {
  id: string;
  name: string;
}

function SubmitButton({
  children,
  variant = 'primary',
  size,
}: {
  children: React.ReactNode;
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} size={size} loading={pending} disabled={pending}>
      {children}
    </Button>
  );
}

/**
 * Cadastro de conta financeira (Prompt 12, itens 14 a 17).
 *
 * A CONTA NASCE ZERADA, sempre. Nao ha campo de saldo inicial porque saldo nao
 * se digita: ele e a consequencia dos movimentos. Uma conta que ja nasce com
 * R$ 800 tem um saldo que nenhum extrato explica, e a primeira conferencia do
 * mes trava sem que ninguem descubra por que.
 *
 * SEM UNIDADE = CONTA COMPARTILHADA da empresa (a conta bancaria da matriz).
 * Com unidade, a conta serve so aquela loja — que e o caso do caixa da gaveta.
 */
export function AccountForm({ units, action }: { units: UnitOption[]; action: ActionFn }) {
  const [state, formAction] = useActionState(action, EMPTY_FINANCE_STATE);
  const [aberto, setAberto] = useState(false);

  if (!aberto) {
    return (
      <>
        {state.success ? <Alert tone="success">{state.success}</Alert> : null}
        <Button type="button" variant="secondary" onClick={() => setAberto(true)}>
          Nova conta financeira
        </Button>
      </>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Nome" required>
          {(field) => <Input {...field} name="name" maxLength={ACCOUNT_NAME_MAX} />}
        </FormField>

        <FormField label="Tipo" required hint="O tipo nao muda depois que a conta tem movimento.">
          {(field) => (
            <Select {...field} name="kind" defaultValue="cash">
              {ACCOUNT_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {ACCOUNT_KIND_LABEL[kind]}
                </option>
              ))}
            </Select>
          )}
        </FormField>

        <FormField
          label="Unidade"
          hint="Sem unidade, a conta serve a empresa inteira. O caixa da gaveta pertence a uma loja."
        >
          {(field) => (
            <Select {...field} name="unitId" defaultValue="">
              <option value="">Compartilhada pela empresa</option>
              {units.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.name}
                </option>
              ))}
            </Select>
          )}
        </FormField>

        <FormField label="Descricao">
          {(field) => <Input {...field} name="description" />}
        </FormField>
      </div>

      <Alert tone="info">
        A conta nasce com saldo zero. Saldo nao se digita: ele e a soma dos movimentos registrados.
      </Alert>

      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="secondary" onClick={() => setAberto(false)}>
          Cancelar
        </Button>
        <SubmitButton>Criar conta</SubmitButton>
      </div>
    </form>
  );
}

/** Forma de pagamento (item 18). E vocabulario do balcao, nao integracao. */
export function PaymentMethodForm({ action }: { action: ActionFn }) {
  const [state, formAction] = useActionState(action, EMPTY_FINANCE_STATE);

  return (
    <form action={formAction} className="space-y-4">
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}

      <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <FormField label="Nome" required>
          {(field) => <Input {...field} name="name" maxLength={ACCOUNT_NAME_MAX} />}
        </FormField>

        <FormField label="Tipo" required>
          {(field) => (
            <Select {...field} name="kind" defaultValue="pix">
              {PAYMENT_METHOD_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {PAYMENT_METHOD_KIND_LABEL[kind]}
                </option>
              ))}
            </Select>
          )}
        </FormField>

        <SubmitButton variant="secondary">Adicionar</SubmitButton>
      </div>
    </form>
  );
}

/** Categoria de receita ou despesa (item 20). Serve para agrupar, nao para bloquear. */
export function CategoryForm({ action }: { action: ActionFn }) {
  const [state, formAction] = useActionState(action, EMPTY_FINANCE_STATE);

  return (
    <form action={formAction} className="space-y-4">
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}

      <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <FormField label="Nome" required>
          {(field) => <Input {...field} name="name" maxLength={CATEGORY_NAME_MAX} />}
        </FormField>

        <FormField label="Tipo" required>
          {(field) => (
            <Select {...field} name="kind" defaultValue="expense">
              {CATEGORY_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {CATEGORY_KIND_LABEL[kind]}
                </option>
              ))}
            </Select>
          )}
        </FormField>

        <SubmitButton variant="secondary">Adicionar</SubmitButton>
      </div>
    </form>
  );
}

/**
 * Ativar e inativar (item 19).
 *
 * NAO HA EXCLUSAO. Uma forma de pagamento usada em 400 liquidacoes nao pode
 * sumir: o extrato de marco viraria uma lista de lancamentos sem forma. O que
 * existe e desativar — ela para de aparecer nos formularios novos e continua
 * explicando o passado.
 */
export function StatusToggleForm({
  field,
  id,
  status,
  label,
  action,
}: {
  field: string;
  id: string;
  status: string;
  label: string;
  action: ActionFn;
}) {
  const [state, formAction] = useActionState(action, EMPTY_FINANCE_STATE);
  const ativo = status === 'active';

  return (
    <form action={formAction} className="inline">
      <input type="hidden" name={field} value={id} />
      <input type="hidden" name="status" value={ativo ? 'inactive' : 'active'} />
      <SubmitButton variant="ghost" size="sm">
        {ativo ? 'Desativar' : 'Reativar'}
        <span className="sr-only"> {label}</span>
      </SubmitButton>
      {state.error ? <span className="ml-2 text-small text-danger-700">{state.error}</span> : null}
    </form>
  );
}

/** Semeadura dos padroes (item 20): dinheiro, PIX, cartoes e categorias basicas. */
export function DefaultsForm({ action }: { action: ActionFn }) {
  const [state, formAction] = useActionState(action, EMPTY_FINANCE_STATE);

  return (
    <form action={formAction} className="space-y-3">
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}
      <SubmitButton variant="secondary">Criar formas e categorias padrao</SubmitButton>
    </form>
  );
}
