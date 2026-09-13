'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Alert, Button, Field, Input, type ButtonVariant } from '@/design-system/components';
import { EMPTY_ROLE_STATE, type RoleActionState } from './action-state';

type Action = (state: RoleActionState, formData: FormData) => Promise<RoleActionState>;

function Submit({
  children,
  variant = 'primary',
  size = 'md',
  confirmLabel,
}: {
  children: React.ReactNode;
  variant?: ButtonVariant;
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

function Feedback({ state }: { state: RoleActionState }) {
  return (
    <>
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}
    </>
  );
}

export function CreateRoleForm({ action }: { action: Action }) {
  const [state, formAction] = useActionState(action, EMPTY_ROLE_STATE);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <Feedback state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="role-name" label="Nome do perfil" required>
          {(props) => <Input {...props} name="name" required placeholder="Ex.: Recepcao" />}
        </Field>
        <Field id="role-description" label="Descricao">
          {(props) => <Input {...props} name="description" />}
        </Field>
      </div>
      <Submit>Criar perfil</Submit>
    </form>
  );
}

export function RoleMetadataForm({
  action,
  roleId,
  name,
  description,
}: {
  action: Action;
  roleId: string;
  name: string;
  description: string;
}) {
  const [state, formAction] = useActionState(action, EMPTY_ROLE_STATE);

  return (
    <form action={formAction} className="space-y-3" noValidate>
      <Feedback state={state} />
      <input type="hidden" name="roleId" value={roleId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="edit-role-name" label="Nome" required>
          {(props) => <Input {...props} name="name" defaultValue={name} required />}
        </Field>
        <Field id="edit-role-description" label="Descricao">
          {(props) => <Input {...props} name="description" defaultValue={description} />}
        </Field>
      </div>
      <Submit size="sm" variant="secondary">
        Salvar
      </Submit>
    </form>
  );
}

export function DeleteRoleForm({ action, roleId }: { action: Action; roleId: string }) {
  const [state, formAction] = useActionState(action, EMPTY_ROLE_STATE);

  return (
    <form action={formAction} className="space-y-2">
      <Feedback state={state} />
      <input type="hidden" name="roleId" value={roleId} />
      <Submit size="sm" variant="destructive" confirmLabel="Excluir este perfil de acesso?">
        Excluir perfil
      </Submit>
    </form>
  );
}

export interface PermissionOption {
  key: string;
  name: string;
  description: string;
  highRisk: boolean;
  granted: boolean;
  /** Falso quando quem edita nao possui esta permissao e portanto nao pode conceder. */
  grantable: boolean;
}

export interface PermissionGroupView {
  key: string;
  name: string;
  description: string;
  permissions: PermissionOption[];
}

/**
 * Editor de permissoes agrupado por area, com nome amigavel e descricao —
 * nunca uma parede de chaves tecnicas (item 69). A chave continua visivel em
 * letra menor para quem precisa dela.
 */
export function RolePermissionsForm({
  action,
  roleId,
  groups,
  readOnly,
}: {
  action: Action;
  roleId: string;
  groups: PermissionGroupView[];
  readOnly: boolean;
}) {
  const [state, formAction] = useActionState(action, EMPTY_ROLE_STATE);

  return (
    <form action={formAction} className="space-y-5">
      <Feedback state={state} />
      <input type="hidden" name="roleId" value={roleId} />

      {groups.map((group) => (
        <fieldset key={group.key} className="space-y-2">
          <legend className="font-heading text-h6 font-semibold text-ink-800">{group.name}</legend>
          <p className="text-small text-ink-500">{group.description}</p>

          <ul className="mt-2 space-y-1.5">
            {group.permissions.map((permission) => (
              <li key={permission.key}>
                <label
                  className={`flex items-start gap-3 rounded-md border p-3 ${
                    permission.grantable && !readOnly
                      ? 'border-ink-200 hover:bg-ink-50'
                      : 'border-ink-200 bg-ink-50'
                  }`}
                >
                  <input
                    type="checkbox"
                    name="permissions"
                    value={permission.key}
                    defaultChecked={permission.granted}
                    disabled={readOnly || !permission.grantable}
                    className="mt-0.5 size-4 shrink-0 accent-brand-500"
                  />
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-ink-900">{permission.name}</span>
                      {permission.highRisk ? (
                        <span className="rounded-full border border-warning-500/30 bg-warning-50 px-2 py-0.5 text-small font-medium text-warning-700">
                          acesso sensivel
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-0.5 block text-small text-ink-500">
                      {permission.description}
                    </span>
                    <span className="mt-0.5 block font-mono text-small text-ink-500">
                      {permission.key}
                    </span>
                    {!permission.grantable && !readOnly ? (
                      <span className="mt-1 block text-small text-warning-700">
                        Voce nao possui esta permissao, entao nao pode conceder.
                      </span>
                    ) : null}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      ))}

      {!readOnly ? <Submit>Salvar permissoes</Submit> : null}
    </form>
  );
}
