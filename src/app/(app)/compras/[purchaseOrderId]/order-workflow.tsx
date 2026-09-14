'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  FormField,
  Modal,
  Textarea,
} from '@/design-system/components';
import {
  CANCEL_REASON_MAX,
  CANCEL_REASON_MIN,
  type PurchaseOrderStatus,
} from '@/modules/purchasing/domain/purchasing';
import { EMPTY_PURCHASING_STATE, type PurchasingActionState } from '../action-state';

type ActionFn = (
  previous: PurchasingActionState,
  formData: FormData,
) => Promise<PurchasingActionState>;

export interface TransitionOption {
  to: PurchaseOrderStatus;
  label: string;
  description: string;
  requiresReason: boolean;
}

function SubmitButton({
  children,
  variant = 'primary',
}: {
  children: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'destructive' | 'ghost';
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} loading={pending} disabled={pending}>
      {children}
    </Button>
  );
}

/**
 * Transicoes do pedido (Prompt 11, itens 16, 17, 18 e 25).
 *
 * SO APARECE O QUE E POSSIVEL. A matriz do dominio decide quais transicoes
 * existem a partir da situacao atual, e o servidor confere de novo — botao
 * desabilitado e mudo ensina a equipe a ignorar a interface.
 *
 * "RECEBIDO" E "PARCIALMENTE RECEBIDO" NAO SAO BOTOES. Elas sao consequencia
 * da aritmetica do recebimento: nao existe "marcar como recebido" que possa
 * contrariar o que efetivamente chegou na caixa.
 *
 * CANCELAR EXIGE MOTIVO, e por isso abre um dialogo em vez de agir no clique:
 * cancelamento e a unica transicao que alguem vai precisar explicar depois.
 */
export function PurchaseOrderWorkflow({
  purchaseOrderId,
  transitions,
  action,
}: {
  purchaseOrderId: string;
  transitions: TransitionOption[];
  action: ActionFn;
}) {
  const [state, formAction] = useActionState(action, EMPTY_PURCHASING_STATE);
  const [cancelOpen, setCancelOpen] = useState(false);

  const diretas = transitions.filter((transition) => !transition.requiresReason);
  const comMotivo = transitions.filter((transition) => transition.requiresReason);

  if (transitions.length === 0 && !state.success && !state.error) return null;

  return (
    <Card>
      <CardHeader
        title="Situacao do pedido"
        description="Registrar que o pedido foi feito NAO envia nada ao fornecedor: o Nexo56 anota o que voce ja combinou por telefone, WhatsApp ou balcao."
        headingLevel={2}
      />
      <CardBody className="space-y-4">
        {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
        {state.success ? <Alert tone="success">{state.success}</Alert> : null}

        <div className="flex flex-wrap gap-3">
          {diretas.map((transition) => (
            <form key={transition.to} action={formAction}>
              <input type="hidden" name="purchaseOrderId" value={purchaseOrderId} />
              <input type="hidden" name="to" value={transition.to} />
              <SubmitButton variant="primary">{transition.label}</SubmitButton>
            </form>
          ))}

          {comMotivo.map((transition) => (
            <Button
              key={transition.to}
              type="button"
              variant="secondary"
              onClick={() => setCancelOpen(true)}
            >
              {transition.label}
            </Button>
          ))}
        </div>

        {diretas.length > 0 ? (
          <ul className="space-y-1 text-small text-ink-600">
            {diretas.map((transition) => (
              <li key={transition.to}>
                <strong className="font-medium text-ink-700">{transition.label}:</strong>{' '}
                {transition.description}
              </li>
            ))}
          </ul>
        ) : null}
      </CardBody>

      {comMotivo.length > 0 ? (
        <Modal
          open={cancelOpen}
          onClose={() => setCancelOpen(false)}
          title="Cancelar pedido"
          description="O que ja foi recebido permanece no estoque. Cancelar encerra o que ainda nao chegou."
        >
          <form action={formAction} className="space-y-4">
            <input type="hidden" name="purchaseOrderId" value={purchaseOrderId} />
            <input type="hidden" name="to" value="cancelled" />

            <FormField
              id="cancel-reason"
              label="Motivo do cancelamento"
              required
              hint={`Pelo menos ${CANCEL_REASON_MIN} caracteres. Quem ler o pedido daqui a seis meses precisa entender o que aconteceu.`}
            >
              {(props) => (
                <Textarea
                  {...props}
                  name="reason"
                  rows={3}
                  required
                  minLength={CANCEL_REASON_MIN}
                  maxLength={CANCEL_REASON_MAX}
                />
              )}
            </FormField>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setCancelOpen(false)}>
                Voltar
              </Button>
              <SubmitButton variant="destructive">Cancelar pedido</SubmitButton>
            </div>
          </form>
        </Modal>
      ) : null}
    </Card>
  );
}
