'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  FormField,
  Input,
  Select,
  Textarea,
} from '@/design-system/components';
import { NEED_JUSTIFICATION_MAX } from '@/modules/purchasing/domain/purchasing';
import { EMPTY_PURCHASING_STATE, type PurchasingActionState } from '../action-state';

type ActionFn = (
  previous: PurchasingActionState,
  formData: FormData,
) => Promise<PurchasingActionState>;

export interface PartOption {
  id: string;
  code: string;
  name: string;
}

function SubmitButton({ children, size }: { children: React.ReactNode; size?: 'sm' | 'md' }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size={size} loading={pending} disabled={pending}>
      {children}
    </Button>
  );
}

/**
 * Registro de necessidade (Prompt 11, itens 8 e 9).
 *
 * "PRECISAMOS COMPRAR ISTO" — e nao "compramos isto". Registrar aqui nao abre
 * pedido, nao avisa fornecedor e nao mexe no estoque. O texto da tela diz isso
 * antes do clique, porque a diferenca entre as duas frases e o que separa uma
 * lista de compras de uma despesa.
 */
export function NewNeedForm({
  action,
  unitId,
  parts,
  defaultPartId,
  serviceOrder,
}: {
  action: ActionFn;
  unitId: string;
  parts: PartOption[];
  defaultPartId?: string;
  /** OS que originou a necessidade, quando se chegou aqui pela ficha dela. */
  serviceOrder?: { id: string; label: string };
}) {
  const [state, formAction] = useActionState(action, EMPTY_PURCHASING_STATE);

  return (
    <form action={formAction}>
      <input type="hidden" name="unitId" value={unitId} />
      {serviceOrder ? <input type="hidden" name="serviceOrderId" value={serviceOrder.id} /> : null}

      <Card>
        <CardHeader
          title="Registrar necessidade"
          description="Anota que a peca faz falta nesta unidade. Nao compra nada e nao avisa ninguem."
          headingLevel={2}
        />
        <CardBody className="space-y-4">
          {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
          {state.success ? <Alert tone="success">{state.success}</Alert> : null}

          {serviceOrder ? (
            <Alert tone="info">
              Esta necessidade fica vinculada a {serviceOrder.label}. O vinculo e so uma anotacao: a
              situacao da Ordem de Servico nao muda por causa dele.
            </Alert>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <FormField id="need-part" label="Peca" required>
                {(props) => (
                  <Select {...props} name="partId" required defaultValue={defaultPartId ?? ''}>
                    <option value="" disabled>
                      Escolha a peca
                    </option>
                    {parts.map((part) => (
                      <option key={part.id} value={part.id}>
                        {part.code} — {part.name}
                      </option>
                    ))}
                  </Select>
                )}
              </FormField>
            </div>

            <FormField id="need-quantity" label="Quantidade" required>
              {(props) => (
                <Input {...props} name="quantity" inputMode="decimal" required placeholder="2" />
              )}
            </FormField>
          </div>

          <FormField
            id="need-justification"
            label="Por que precisa"
            hint="Opcional. Ajuda quem vai autorizar a despesa a entender o pedido."
          >
            {(props) => (
              <Textarea
                {...props}
                name="justification"
                rows={2}
                maxLength={NEED_JUSTIFICATION_MAX}
              />
            )}
          </FormField>

          <div className="flex justify-end">
            <SubmitButton>Registrar necessidade</SubmitButton>
          </div>
        </CardBody>
      </Card>
    </form>
  );
}

/** Cancela uma necessidade que ainda nao recebeu mercadoria. */
export function CancelNeedForm({ action, needId }: { action: ActionFn; needId: string }) {
  const [state, formAction] = useActionState(action, EMPTY_PURCHASING_STATE);

  return (
    <form action={formAction} className="inline-flex flex-col items-end gap-1">
      <input type="hidden" name="needId" value={needId} />
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      <Button type="submit" variant="ghost" size="sm">
        Cancelar
        <span className="sr-only"> esta necessidade</span>
      </Button>
    </form>
  );
}
