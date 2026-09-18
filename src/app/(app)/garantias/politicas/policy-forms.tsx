'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  Alert,
  Button,
  FormField,
  Input,
  Select,
  Textarea,
  type ButtonVariant,
} from '@/design-system/components';
import {
  COVERAGE_SUMMARY_MAX,
  DURATION_MAX,
  DURATION_MIN,
  DURATION_UNIT_LABEL,
  DURATION_UNITS,
  EXCLUSIONS_MAX,
  TERMS_MAX,
  WARRANTY_TYPE_LABEL,
  WARRANTY_TYPES,
} from '@/modules/warranties/domain/warranty';
import { EMPTY_WARRANTY_STATE, type WarrantyActionState } from '../action-state';

type ActionFn = (previous: WarrantyActionState, formData: FormData) => Promise<WarrantyActionState>;

export interface PolicyDraft {
  id: string;
  name: string;
  type: string;
  durationAmount: number;
  durationUnit: string;
  coverageSummary: string | null;
  exclusions: string | null;
  terms: string | null;
  status: string;
  version: number;
}

function SubmitButton({
  children,
  variant = 'primary',
}: {
  children: React.ReactNode;
  variant?: ButtonVariant;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} loading={pending} disabled={pending}>
      {children}
    </Button>
  );
}

/**
 * Politica de garantia (Prompt 13, itens 6 a 9 e 91).
 *
 * A POLITICA E O PADRAO SUGERIDO, NAO A VERDADE DA GARANTIA EMITIDA. Quando
 * alguem emite uma garantia a partir desta politica, os termos sao COPIADOS
 * para a garantia; editar esta tela amanha nao muda uma linha do certificado
 * entregue ontem.
 *
 * Isso e dito na propria tela de proposito: a duvida "se eu mudar aqui, muda
 * la atras?" e a primeira que aparece, e a resposta errada faria alguem
 * hesitar em corrigir um texto ruim por medo de reescrever o passado.
 */
export function PolicyForm({ policy, action }: { policy?: PolicyDraft; action: ActionFn }) {
  const [state, formAction] = useActionState(action, EMPTY_WARRANTY_STATE);
  const editando = Boolean(policy);

  return (
    <form action={formAction} className="space-y-4">
      {policy ? (
        <>
          <input type="hidden" name="policyId" value={policy.id} />
          {/*
            A versao esperada viaja no formulario: se outra pessoa salvou esta
            mesma politica enquanto esta tela estava aberta, o servidor recusa
            em vez de sobrescrever o trabalho dela em silencio.
          */}
          <input type="hidden" name="expectedVersion" value={String(policy.version)} />
        </>
      ) : null}

      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}

      <FormField label="Nome da politica" required>
        {(field) => (
          <Input
            {...field}
            name="name"
            required
            maxLength={120}
            defaultValue={policy?.name ?? ''}
            placeholder="Garantia padrao de bancada"
          />
        )}
      </FormField>

      <div className="grid gap-4 sm:grid-cols-3">
        <FormField label="Tipo" required>
          {(field) => (
            <Select {...field} name="type" required defaultValue={policy?.type ?? 'internal'}>
              {WARRANTY_TYPES.map((value) => (
                <option key={value} value={value}>
                  {WARRANTY_TYPE_LABEL[value]}
                </option>
              ))}
            </Select>
          )}
        </FormField>

        <FormField label="Duracao" required>
          {(field) => (
            <Input
              {...field}
              name="durationAmount"
              type="number"
              inputMode="numeric"
              required
              min={DURATION_MIN}
              max={DURATION_MAX}
              defaultValue={policy?.durationAmount ?? 3}
            />
          )}
        </FormField>

        <FormField label="Unidade" required>
          {(field) => (
            <Select
              {...field}
              name="durationUnit"
              required
              defaultValue={policy?.durationUnit ?? 'months'}
            >
              {DURATION_UNITS.map((value) => (
                <option key={value} value={value}>
                  {DURATION_UNIT_LABEL[value]}
                </option>
              ))}
            </Select>
          )}
        </FormField>
      </div>

      <FormField
        label="Resumo da cobertura"
        hint="O que esta garantia cobre, em portugues de balcao."
      >
        {(field) => (
          <Textarea
            {...field}
            name="coverageSummary"
            rows={3}
            maxLength={COVERAGE_SUMMARY_MAX}
            defaultValue={policy?.coverageSummary ?? ''}
          />
        )}
      </FormField>

      <FormField label="Exclusoes" hint="O que NAO esta coberto. Escrever isso evita discussao.">
        {(field) => (
          <Textarea
            {...field}
            name="exclusions"
            rows={3}
            maxLength={EXCLUSIONS_MAX}
            defaultValue={policy?.exclusions ?? ''}
          />
        )}
      </FormField>

      <FormField label="Termos" hint="Condicoes completas, impressas no certificado.">
        {(field) => (
          <Textarea
            {...field}
            name="terms"
            rows={4}
            maxLength={TERMS_MAX}
            defaultValue={policy?.terms ?? ''}
          />
        )}
      </FormField>

      <p className="text-small text-ink-500">
        Alterar esta politica NAO altera nenhuma garantia ja emitida. Os termos sao copiados no
        momento da emissao — um certificado entregue em janeiro continua dizendo o que dizia em
        janeiro.
      </p>

      <div className="flex justify-end">
        <SubmitButton variant={editando ? 'secondary' : 'primary'}>
          {editando ? 'Salvar politica' : 'Criar politica'}
        </SubmitButton>
      </div>
    </form>
  );
}

/**
 * Ativar ou desativar a politica (item 9).
 *
 * DESATIVAR NAO E APAGAR. A politica desativada some das emissoes novas e
 * continua explicando as garantias antigas — quem abrir uma garantia de dois
 * anos atras ainda encontra a politica que a originou.
 */
export function PolicyStatusForm({
  policyId,
  status,
  action,
}: {
  policyId: string;
  status: string;
  action: ActionFn;
}) {
  const [state, formAction] = useActionState(action, EMPTY_WARRANTY_STATE);
  const desativando = status === 'active';

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="policyId" value={policyId} />
      <input type="hidden" name="status" value={desativando ? 'inactive' : 'active'} />

      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}

      <SubmitButton variant={desativando ? 'outline' : 'secondary'}>
        {desativando ? 'Desativar' : 'Reativar'}
      </SubmitButton>
    </form>
  );
}
