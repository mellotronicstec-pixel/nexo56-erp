'use client';

import Link from 'next/link';
import { useActionState, useId, useState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  FormField,
  Textarea,
} from '@/design-system/components';
import {
  CUSTOMER_REPORT_MAX,
  INTERNAL_NOTES_MAX,
} from '@/modules/service-orders/domain/service-order';
import { EMPTY_SERVICE_ORDER_STATE, type ServiceOrderActionState } from './action-state';

/**
 * Abertura da Ordem de Servico (Prompt 07, itens 89 a 93).
 *
 * ABERTURA RAPIDA, SEM REDIGITACAO (item 89): cliente, equipamento e unidade
 * ja foram resolvidos antes de chegar aqui e aparecem como RESUMO, nao como
 * campos. O atendente com o cliente na frente digita uma coisa so — o que o
 * cliente contou.
 */

/**
 * Chave de idempotencia do comando.
 *
 * Gerada UMA vez por formulario montado. Duplo clique, F5 e retentativa depois
 * de queda de rede reenviam a MESMA chave, e o servidor reencontra a OS ja
 * aberta em vez de abrir a segunda (itens 32, 92 e 93).
 *
 * `crypto.randomUUID` existe em todo navegador que este ERP suporta; o
 * fallback cobre contexto sem `crypto` (nao-https antigo) sem quebrar o envio
 * — ali a protecao volta a ser a do banco, que continua valendo.
 */
function newCommandKey(seed: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${seed}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" loading={pending} disabled={pending}>
      {pending ? 'Abrindo...' : 'Abrir Ordem de Servico'}
    </Button>
  );
}

export function ServiceOrderForm({
  action,
  equipmentId,
  intakeId,
  cancelHref,
  summary,
}: {
  action: (
    previous: ServiceOrderActionState,
    formData: FormData,
  ) => Promise<ServiceOrderActionState>;
  equipmentId: string;
  intakeId: string | null;
  cancelHref: string;
  /** Resumo renderizado no servidor: cliente, equipamento, unidade, recebimento. */
  summary: React.ReactNode;
}) {
  const [state, formAction] = useActionState(action, EMPTY_SERVICE_ORDER_STATE);
  const seed = useId();
  const [commandKey] = useState(() => newCommandKey(seed));

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="equipmentId" value={equipmentId} />
      {intakeId ? <input type="hidden" name="intakeId" value={intakeId} /> : null}
      <input type="hidden" name="idempotencyKey" value={commandKey} />

      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}

      {summary}

      <Card>
        <CardHeader
          title="Relato do cliente"
          description="O que a pessoa contou sobre o problema, com as palavras dela."
          headingLevel={2}
        />
        <CardBody className="space-y-4">
          {/*
            RELATO NAO E DIAGNOSTICO (item 22). O texto de apoio diz isso em
            voz alta, porque o campo em branco convida o atendente a arriscar
            um parecer — e o parecer sai depois, de quem abriu o aparelho.
          */}
          <FormField
            id="customerReport"
            label="Relato do cliente"
            required
            hint="Exemplo: o aparelho nao liga depois de uma queda de energia. Nao e diagnostico tecnico."
          >
            {(props) => (
              <Textarea
                {...props}
                name="customerReport"
                rows={5}
                required
                maxLength={CUSTOMER_REPORT_MAX}
                placeholder="Cliente informa que..."
              />
            )}
          </FormField>

          <FormField
            id="internalNotes"
            label="Observacoes internas"
            hint="Recado para a equipe. Nao sera apresentado ao cliente."
          >
            {(props) => (
              <Textarea {...props} name="internalNotes" rows={3} maxLength={INTERNAL_NOTES_MAX} />
            )}
          </FormField>
        </CardBody>
        <CardFooter className="flex flex-wrap items-center justify-end gap-3">
          <Link href={cancelHref} className="text-ui font-medium text-ink-600 hover:underline">
            Cancelar
          </Link>
          <SubmitButton />
        </CardFooter>
      </Card>
    </form>
  );
}

/** Edicao dos dados de abertura (item 111). */
export function ServiceOrderEditForm({
  action,
  serviceOrderId,
  customerReport,
  internalNotes,
  cancelHref,
}: {
  action: (
    previous: ServiceOrderActionState,
    formData: FormData,
  ) => Promise<ServiceOrderActionState>;
  serviceOrderId: string;
  customerReport: string;
  internalNotes: string;
  cancelHref: string;
}) {
  const [state, formAction] = useActionState(action, EMPTY_SERVICE_ORDER_STATE);

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="serviceOrderId" value={serviceOrderId} />

      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}

      <Card>
        <CardHeader
          title="Dados de abertura"
          description="Cliente, equipamento e unidade nao mudam por aqui: eles sao a identidade deste atendimento."
          headingLevel={2}
        />
        <CardBody className="space-y-4">
          <FormField
            id="customerReport"
            label="Relato do cliente"
            required
            hint="Alteracoes ficam registradas na trilha de auditoria, com o texto anterior."
          >
            {(props) => (
              <Textarea
                {...props}
                name="customerReport"
                rows={5}
                required
                maxLength={CUSTOMER_REPORT_MAX}
                defaultValue={customerReport}
              />
            )}
          </FormField>

          <FormField
            id="internalNotes"
            label="Observacoes internas"
            hint="Recado para a equipe. Nao sera apresentado ao cliente."
          >
            {(props) => (
              <Textarea
                {...props}
                name="internalNotes"
                rows={3}
                maxLength={INTERNAL_NOTES_MAX}
                defaultValue={internalNotes}
              />
            )}
          </FormField>
        </CardBody>
        <CardFooter className="flex flex-wrap items-center justify-end gap-3">
          <Link href={cancelHref} className="text-ui font-medium text-ink-600 hover:underline">
            Cancelar
          </Link>
          <EditSubmitButton />
        </CardFooter>
      </Card>
    </form>
  );
}

function EditSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending} disabled={pending}>
      {pending ? 'Salvando...' : 'Salvar alteracoes'}
    </Button>
  );
}
