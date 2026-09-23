'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Alert, Button, Field, Input } from '@/design-system/components';
import { requestPortalLoginAction, type RequestLoginState } from './actions';

const INITIAL: RequestLoginState = { submitted: false };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" fullWidth loading={pending}>
      {pending ? 'Enviando...' : 'Enviar link de acesso'}
    </Button>
  );
}

export function EntrarForm() {
  const [state, formAction] = useActionState(requestPortalLoginAction, INITIAL);

  if (state.submitted) {
    return (
      <Alert tone="success">
        Se este e-mail ou telefone tiver cadastro, enviamos um link de acesso. Ele vale por 15
        minutos.
      </Alert>
    );
  }

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <Field id="contact" label="E-mail ou telefone" required>
        {(props) => (
          <Input
            {...props}
            name="contact"
            autoComplete="username"
            autoFocus
            required
            placeholder="voce@exemplo.com ou (11) 99999-9999"
          />
        )}
      </Field>

      <SubmitButton />
    </form>
  );
}
