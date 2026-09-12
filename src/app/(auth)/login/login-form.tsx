'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Alert, Button, Field, Input } from '@/design-system/components';
import { loginAction, type LoginFormState } from './actions';

const INITIAL: LoginFormState = {
  error: null,
  needsTenantSlug: false,
  values: { email: '', tenantSlug: '' },
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" fullWidth loading={pending}>
      {pending ? 'Entrando...' : 'Entrar'}
    </Button>
  );
}

export function LoginForm() {
  const [state, formAction] = useActionState(loginAction, INITIAL);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}

      <Field id="email" label="E-mail" required>
        {(props) => (
          <Input
            {...props}
            name="email"
            type="email"
            autoComplete="username"
            inputMode="email"
            autoFocus
            required
            defaultValue={state.values.email}
            placeholder="voce@suaempresa.com.br"
          />
        )}
      </Field>

      <Field id="password" label="Senha" required>
        {(props) => (
          <Input
            {...props}
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        )}
      </Field>

      {state.needsTenantSlug ? (
        <Field
          id="tenantSlug"
          label="Identificador da empresa"
          hint="Seu e-mail esta vinculado a mais de uma empresa."
          required
        >
          {(props) => (
            <Input
              {...props}
              name="tenantSlug"
              autoComplete="organization"
              required
              defaultValue={state.values.tenantSlug}
            />
          )}
        </Field>
      ) : null}

      <SubmitButton />
    </form>
  );
}
