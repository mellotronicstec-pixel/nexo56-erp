'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/design-system/components';
import { toggleFeatureAction, type ModuleFormState } from './actions';

const INITIAL: ModuleFormState = { error: null, success: null };

function ToggleButton({ enabled }: { enabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant={enabled ? 'secondary' : 'primary'} loading={pending}>
      {enabled ? 'Desativar' : 'Ativar'}
    </Button>
  );
}

export function ModuleToggle({ featureKey, enabled }: { featureKey: string; enabled: boolean }) {
  const [state, formAction] = useActionState(toggleFeatureAction, INITIAL);

  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <input type="hidden" name="featureKey" value={featureKey} />
      <input type="hidden" name="enabled" value={String(!enabled)} />
      <ToggleButton enabled={enabled} />
      {state.error ? <p className="text-small text-danger-700">{state.error}</p> : null}
    </form>
  );
}
