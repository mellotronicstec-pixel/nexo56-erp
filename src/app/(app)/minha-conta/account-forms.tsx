'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Alert, Button, Field, Input } from '@/design-system/components';
import { EMPTY_ACCOUNT_STATE, type AccountActionState } from './action-state';

type Action = (state: AccountActionState, formData: FormData) => Promise<AccountActionState>;

function Submit({
  children,
  variant = 'primary',
  size = 'md',
}: {
  children: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} size={size} loading={pending}>
      {children}
    </Button>
  );
}

function Feedback({ state }: { state: AccountActionState }) {
  return (
    <>
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}
    </>
  );
}

export function ChangePasswordForm({ action, minLength }: { action: Action; minLength: number }) {
  const [state, formAction] = useActionState(action, EMPTY_ACCOUNT_STATE);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <Feedback state={state} />

      <Field id="current-password" label="Senha atual" required>
        {(props) => (
          <Input
            {...props}
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            required
          />
        )}
      </Field>

      <Field
        id="new-password"
        label="Nova senha"
        hint={`Minimo de ${minLength} caracteres. Prefira uma frase longa a simbolos decorativos.`}
        required
      >
        {(props) => (
          <Input
            {...props}
            name="newPassword"
            type="password"
            autoComplete="new-password"
            required
          />
        )}
      </Field>

      <Field id="confirm-password" label="Confirme a nova senha" required>
        {(props) => (
          <Input
            {...props}
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
          />
        )}
      </Field>

      <label className="flex items-start gap-2 text-ui text-ink-700">
        <input
          type="checkbox"
          name="revokeOtherSessions"
          value="true"
          defaultChecked
          className="mt-0.5 size-4 accent-brand-500"
        />
        <span>
          Encerrar as outras sessoes
          <span className="block text-small text-ink-500">
            Recomendado se voce suspeita que alguem teve acesso a sua conta.
          </span>
        </span>
      </label>

      <Submit>Alterar senha</Submit>
    </form>
  );
}

export function SessionActions({
  revokeOne,
  revokeOthers,
  sessions,
}: {
  revokeOne: Action;
  revokeOthers: Action;
  sessions: Array<{
    id: string;
    isCurrent: boolean;
    userAgentSummary: string | null;
    lastUsed: string;
    expires: string;
  }>;
}) {
  const [oneState, revokeOneAction] = useActionState(revokeOne, EMPTY_ACCOUNT_STATE);
  const [othersState, revokeOthersAction] = useActionState(revokeOthers, EMPTY_ACCOUNT_STATE);
  const hasOthers = sessions.some((session) => !session.isCurrent);

  return (
    <div className="space-y-3">
      <Feedback state={oneState} />
      <Feedback state={othersState} />

      <ul className="space-y-2">
        {sessions.map((session) => (
          <li
            key={session.id}
            className="flex flex-col gap-2 rounded-md border border-ink-200 p-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <p className="font-medium text-ink-900">
                {session.userAgentSummary ?? 'Dispositivo nao identificado'}
                {session.isCurrent ? (
                  <span className="ml-2 rounded-full border border-success-500/30 bg-success-50 px-2 py-0.5 text-small font-medium text-success-700">
                    esta sessao
                  </span>
                ) : null}
              </p>
              <p className="mt-0.5 text-small text-ink-500">
                Ultimo uso: {session.lastUsed} · Expira: {session.expires}
              </p>
            </div>

            {!session.isCurrent ? (
              <form action={revokeOneAction}>
                <input type="hidden" name="sessionId" value={session.id} />
                <Submit size="sm" variant="ghost">
                  Encerrar
                </Submit>
              </form>
            ) : null}
          </li>
        ))}
      </ul>

      {hasOthers ? (
        <form action={revokeOthersAction} className="border-t border-ink-200 pt-3">
          <Submit size="sm" variant="secondary">
            Encerrar todas as outras sessoes
          </Submit>
        </form>
      ) : null}
    </div>
  );
}
