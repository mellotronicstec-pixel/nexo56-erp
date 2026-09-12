'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Alert, Badge, Button, Field, Input } from '@/design-system/components';
import { EMPTY_STATE, type ActionState } from './action-state';

/**
 * Formularios da administracao de usuarios.
 *
 * Cada um recebe a action por props para nao duplicar o tratamento de estado,
 * erro e "segredo de exibicao unica" (senha inicial, codigo de redefinicao).
 */

type Action = (state: ActionState, formData: FormData) => Promise<ActionState>;

function SubmitButton({
  children,
  variant = 'primary',
  size = 'md',
  confirmLabel,
}: {
  children: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  confirmLabel?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant={variant}
      size={size}
      loading={pending}
      onClick={(event) => {
        if (confirmLabel && !window.confirm(confirmLabel)) event.preventDefault();
      }}
    >
      {children}
    </Button>
  );
}

/** Caixa de segredo exibido uma unica vez. */
function SecretBox({ secret }: { secret: NonNullable<ActionState['secret']> }) {
  return (
    <Alert tone="warning" title={secret.label}>
      <p className="mt-1 font-mono text-body break-all text-ink-900">{secret.value}</p>
      <p className="mt-2 text-small text-ink-600">{secret.hint}</p>
    </Alert>
  );
}

function Feedback({ state }: { state: ActionState }) {
  return (
    <>
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      {state.success && !state.secret ? <Alert tone="success">{state.success}</Alert> : null}
      {state.secret ? <SecretBox secret={state.secret} /> : null}
    </>
  );
}

export function CreateUserForm({ action }: { action: Action }) {
  const [state, formAction] = useActionState(action, EMPTY_STATE);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <Feedback state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="new-user-name" label="Nome completo" required>
          {(props) => <Input {...props} name="name" autoComplete="name" required />}
        </Field>
        <Field id="new-user-email" label="E-mail" required>
          {(props) => <Input {...props} name="email" type="email" inputMode="email" required />}
        </Field>
      </div>
      <SubmitButton>Criar usuario</SubmitButton>
    </form>
  );
}

export function RenameUserForm({
  action,
  userId,
  currentName,
}: {
  action: Action;
  userId: string;
  currentName: string;
}) {
  const [state, formAction] = useActionState(action, EMPTY_STATE);

  return (
    <form action={formAction} className="space-y-3" noValidate>
      <Feedback state={state} />
      <input type="hidden" name="userId" value={userId} />
      <Field id="user-name" label="Nome completo" required>
        {(props) => <Input {...props} name="name" defaultValue={currentName} required />}
      </Field>
      <SubmitButton size="sm" variant="secondary">
        Salvar
      </SubmitButton>
    </form>
  );
}

/** Form de uma acao so, com campos ocultos. Usado por vinculos e perfis. */
export function ActionForm({
  action,
  fields,
  label,
  variant = 'secondary',
  confirmLabel,
  children,
}: {
  action: Action;
  fields: Record<string, string>;
  label: string;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  confirmLabel?: string;
  children?: React.ReactNode;
}) {
  const [state, formAction] = useActionState(action, EMPTY_STATE);

  return (
    <form action={formAction} className="space-y-2">
      <Feedback state={state} />
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {children}
      <SubmitButton size="sm" variant={variant} confirmLabel={confirmLabel}>
        {label}
      </SubmitButton>
    </form>
  );
}

/** Atribuicao de perfil com escolha de escopo em linguagem de produto. */
export function AssignRoleForm({
  action,
  userId,
  roles,
  units,
}: {
  action: Action;
  userId: string;
  roles: Array<{ id: string; name: string }>;
  units: Array<{ id: string; name: string }>;
}) {
  const [state, formAction] = useActionState(action, EMPTY_STATE);

  return (
    <form action={formAction} className="space-y-3">
      <Feedback state={state} />
      <input type="hidden" name="userId" value={userId} />

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <label htmlFor="assign-role" className="block text-ui font-medium text-ink-700">
            Perfil
          </label>
          <select
            id="assign-role"
            name="roleId"
            required
            className="h-10 w-full rounded-md border border-ink-300 bg-white px-3 text-ui text-ink-900 shadow-xs"
          >
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="assign-scope" className="block text-ui font-medium text-ink-700">
            Onde vale
          </label>
          <select
            id="assign-scope"
            name="scope"
            defaultValue="TENANT"
            className="h-10 w-full rounded-md border border-ink-300 bg-white px-3 text-ui text-ink-900 shadow-xs"
          >
            <option value="TENANT">Todas as unidades autorizadas</option>
            <option value="UNIT">Somente uma unidade</option>
          </select>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="assign-unit" className="block text-ui font-medium text-ink-700">
            Unidade
          </label>
          <select
            id="assign-unit"
            name="unitId"
            className="h-10 w-full rounded-md border border-ink-300 bg-white px-3 text-ui text-ink-900 shadow-xs disabled:bg-ink-50"
            disabled={units.length === 0}
          >
            {units.length === 0 ? (
              <option value="">Nenhuma unidade vinculada</option>
            ) : (
              units.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.name}
                </option>
              ))
            )}
          </select>
        </div>
      </div>

      <p className="text-small text-ink-500">
        Um perfil em <Badge>somente uma unidade</Badge> exige que o usuario ja esteja vinculado a
        ela.
      </p>

      <SubmitButton size="sm">Atribuir perfil</SubmitButton>
    </form>
  );
}
