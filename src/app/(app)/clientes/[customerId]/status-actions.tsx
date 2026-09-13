'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Alert, Button, Modal } from '@/design-system/components';
import { EMPTY_CUSTOMER_STATE, type CustomerActionState } from '../action-state';

/**
 * Ativar e inativar (Prompt 05, itens 36 e 37).
 *
 * A inativacao passa por um dialogo que explica a CONSEQUENCIA — nao um
 * "Tem certeza?" solto, e nunca `window.confirm`, que nao e estilizavel, nao
 * e acessivel e trava a aba. O dialogo e o `Modal` do Design System, com foco
 * preso, Esc e foco devolvido.
 *
 * Reativar nao pede confirmacao: e reversivel e nao destroi nada.
 */

function ConfirmButton({ label, variant }: { label: string; variant: 'destructive' | 'primary' }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} loading={pending}>
      {label}
    </Button>
  );
}

export function CustomerStatusActions({
  action,
  customerId,
  customerName,
  status,
}: {
  action: (previous: CustomerActionState, formData: FormData) => Promise<CustomerActionState>;
  customerId: string;
  customerName: string;
  status: 'active' | 'inactive';
}) {
  const [state, formAction] = useActionState(action, EMPTY_CUSTOMER_STATE);
  const [confirming, setConfirming] = useState(false);

  if (status === 'inactive') {
    return (
      <div className="space-y-2">
        {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
        <form action={formAction}>
          <input type="hidden" name="customerId" value={customerId} />
          <input type="hidden" name="status" value="active" />
          <ConfirmButton label="Reativar cliente" variant="primary" />
        </form>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}

      <Button variant="secondary" onClick={() => setConfirming(true)}>
        Inativar cliente
      </Button>

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Inativar este cliente?"
        description={customerName}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              Manter ativo
            </Button>
            <form action={formAction} onSubmit={() => setConfirming(false)}>
              <input type="hidden" name="customerId" value={customerId} />
              <input type="hidden" name="status" value="inactive" />
              <ConfirmButton label="Inativar" variant="destructive" />
            </form>
          </>
        }
      >
        <p>
          Inativar <strong>nao remove</strong> o cadastro nem o historico. O cliente deixa de
          aparecer na operacao do dia a dia e pode ser reativado a qualquer momento.
        </p>
      </Modal>
    </div>
  );
}
