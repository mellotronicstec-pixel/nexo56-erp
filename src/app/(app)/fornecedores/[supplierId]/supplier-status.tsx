'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Alert, Button } from '@/design-system/components';
import { EMPTY_PURCHASING_STATE, type PurchasingActionState } from '../../compras/action-state';

type ActionFn = (
  previous: PurchasingActionState,
  formData: FormData,
) => Promise<PurchasingActionState>;

function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="secondary" size="sm" loading={pending} disabled={pending}>
      {children}
    </Button>
  );
}

/**
 * Ativar ou inativar o fornecedor (Prompt 11, item 6).
 *
 * INATIVAR NAO APAGA NADA, e o texto do botao diz isso antes do clique: os
 * pedidos, os recebimentos e o historico de precos continuam onde estao. O
 * fornecedor inativo apenas deixa de ser oferecido em pedido novo.
 */
export function SupplierStatusForm({
  supplierId,
  status,
  action,
}: {
  supplierId: string;
  status: string;
  action: ActionFn;
}) {
  const [state, formAction] = useActionState(action, EMPTY_PURCHASING_STATE);
  const next = status === 'active' ? 'inactive' : 'active';

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="supplierId" value={supplierId} />
      <input type="hidden" name="status" value={next} />

      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}

      <SubmitButton>
        {next === 'inactive' ? 'Inativar fornecedor' : 'Reativar fornecedor'}
      </SubmitButton>

      <p className="text-small text-ink-500">
        {next === 'inactive'
          ? 'O historico permanece. O fornecedor so deixa de aparecer em pedido novo.'
          : 'O fornecedor volta a aparecer na escolha de pedidos.'}
      </p>
    </form>
  );
}
