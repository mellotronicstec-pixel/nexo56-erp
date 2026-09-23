'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Alert, Button } from '@/design-system/components';
import { confirmPortalLoginAction, type ConfirmLoginState } from './confirm-actions';

const INITIAL: ConfirmLoginState = { error: null };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" fullWidth loading={pending}>
      {pending ? 'Entrando...' : 'Confirmar entrada'}
    </Button>
  );
}

export function ConfirmLoginForm({ token }: { token: string }) {
  const boundAction = confirmPortalLoginAction.bind(null, token);
  const [state, formAction] = useActionState(boundAction, INITIAL);

  return (
    <form action={formAction} className="space-y-4">
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      <SubmitButton />
    </form>
  );
}
