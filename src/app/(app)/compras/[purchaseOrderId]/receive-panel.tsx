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
  Input,
  Select,
  Textarea,
} from '@/design-system/components';
import { DOCUMENT_NUMBER_MAX } from '@/modules/purchasing/domain/purchasing';
import { EMPTY_PURCHASING_STATE, type PurchasingActionState } from '../action-state';

type ActionFn = (
  previous: PurchasingActionState,
  formData: FormData,
) => Promise<PurchasingActionState>;

export interface ReceivableLine {
  itemId: string;
  description: string;
  unitOfMeasure: string;
  ordered: string;
  received: string;
  pending: string;
}

export interface LocationOption {
  id: string;
  name: string;
}

function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending} disabled={pending}>
      {children}
    </Button>
  );
}

/**
 * Registro do recebimento (Prompt 11, itens 19 a 24 e 39).
 *
 * O RECEBIMENTO E O UNICO PONTO EM QUE O ESTOQUE MUDA. Aprovar nao muda,
 * registrar o pedido nao muda, cancelar nao desfaz. E por isso que este painel
 * so aparece quando o pedido esta aguardando entrega.
 *
 * RECEBER PARCIAL E O NORMAL, nao a excecao: o fornecedor manda 4 das 10 e
 * promete o resto na semana que vem. O campo ja vem preenchido com o que falta
 * — o caso comum e "chegou tudo o que faltava" — mas a pessoa corrige para o
 * que efetivamente veio na caixa.
 *
 * CHAVE DE COMANDO: nasce no cliente quando o painel monta. Duplo clique e o
 * retry depois de uma queda de rede reencontram o recebimento em vez de lancar
 * a mesma mercadoria duas vezes.
 */
export function ReceivePanel({
  purchaseOrderId,
  lines,
  locations,
  action,
}: {
  purchaseOrderId: string;
  lines: ReceivableLine[];
  locations: LocationOption[];
  action: ActionFn;
}) {
  /**
   * A chave muda a cada recebimento REGISTRADO com sucesso: a segunda entrega
   * legitima do mesmo pedido precisa de uma chave nova, senao ela seria
   * confundida com um reenvio da primeira.
   */
  const [commandKey, setCommandKey] = useState(() => crypto.randomUUID());

  const [state, formAction] = useActionState(
    async (previous: PurchasingActionState, formData: FormData) => {
      const result = await action(previous, formData);
      if (!result.error) setCommandKey(crypto.randomUUID());
      return result;
    },
    EMPTY_PURCHASING_STATE,
  );

  const pendentes = lines.filter((line) => Number(line.pending) > 0);

  return (
    <Card>
      <CardHeader
        title="Registrar recebimento"
        description="A mercadoria chegou. O estoque desta unidade sobe agora, e so agora."
        headingLevel={2}
      />
      <CardBody>
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="purchaseOrderId" value={purchaseOrderId} />
          <input type="hidden" name="commandKey" value={commandKey} />

          {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
          {state.success ? <Alert tone="success">{state.success}</Alert> : null}

          {pendentes.length === 0 ? (
            <Alert tone="info">Todos os itens deste pedido ja foram recebidos.</Alert>
          ) : null}

          {pendentes.map((line) => (
            <fieldset
              key={line.itemId}
              className="grid gap-3 rounded-lg border border-ink-200 p-4 sm:grid-cols-3"
            >
              <legend className="px-1 text-small font-medium text-ink-600">
                {line.description}
              </legend>
              <input type="hidden" name="receiveItemId" value={line.itemId} />

              <div className="sm:col-span-3">
                <p className="text-small text-ink-600">
                  Pedido: {line.ordered} {line.unitOfMeasure} · Ja recebido: {line.received}{' '}
                  {line.unitOfMeasure} ·{' '}
                  <strong className="font-medium text-ink-900">
                    Falta: {line.pending} {line.unitOfMeasure}
                  </strong>
                </p>
              </div>

              <FormField id={`receive-quantity-${line.itemId}`} label="Quantidade que chegou">
                {(props) => (
                  <Input
                    {...props}
                    name="receiveQuantity"
                    inputMode="decimal"
                    defaultValue={line.pending}
                  />
                )}
              </FormField>

              {locations.length > 0 ? (
                <FormField
                  id={`receive-location-${line.itemId}`}
                  label="Onde guardou"
                  hint="Opcional."
                >
                  {(props) => (
                    <Select {...props} name="receiveLocationId" defaultValue="">
                      <option value="">Nao informar</option>
                      {locations.map((location) => (
                        <option key={location.id} value={location.id}>
                          {location.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </FormField>
              ) : (
                <input type="hidden" name="receiveLocationId" value="" />
              )}
            </fieldset>
          ))}

          <div className="grid gap-4 sm:grid-cols-3">
            <FormField id="receipt-document" label="Numero da nota">
              {(props) => (
                <Input {...props} name="documentNumber" maxLength={DOCUMENT_NUMBER_MAX} />
              )}
            </FormField>

            <FormField id="receipt-document-date" label="Data da nota">
              {(props) => <Input {...props} name="documentDate" type="date" />}
            </FormField>

            <FormField id="receipt-notes" label="Observacoes">
              {(props) => <Textarea {...props} name="notes" rows={1} maxLength={300} />}
            </FormField>
          </div>

          <div className="flex justify-end">
            <SubmitButton>Registrar recebimento</SubmitButton>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
