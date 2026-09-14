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
import { ORDER_NOTES_MAX } from '@/modules/purchasing/domain/purchasing';
import { EMPTY_PURCHASING_STATE, type PurchasingActionState } from '../action-state';

type ActionFn = (
  previous: PurchasingActionState,
  formData: FormData,
) => Promise<PurchasingActionState>;

export interface SupplierOption {
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
 * Abertura do pedido (Prompt 11, itens 13 e 55).
 *
 * O pedido nasce em RASCUNHO, e o texto da tela diz isso: escolher o
 * fornecedor nao compra nada, nao avisa ninguem e nao mexe no estoque.
 *
 * CHAVE DE COMANDO: nasce no cliente, uma vez, quando a tela monta o
 * formulario. Duplo clique no botao — e o retry depois de uma queda de rede —
 * reencontra o pedido ja aberto em vez de abrir um segundo com outro numero.
 */
export function NewPurchaseOrderForm({
  action,
  unitId,
  unitName,
  suppliers,
}: {
  action: ActionFn;
  unitId: string;
  unitName: string;
  suppliers: SupplierOption[];
}) {
  const [state, formAction] = useActionState(action, EMPTY_PURCHASING_STATE);

  /**
   * `useState` com inicializador de funcao: o sorteio acontece UMA vez, na
   * montagem, e nao a cada renderizacao — renderizar precisa ser puro.
   */
  const [commandKey] = useState(() => crypto.randomUUID());

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="unitId" value={unitId} />
      <input type="hidden" name="commandKey" value={commandKey} />

      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}

      <Card>
        <CardHeader
          title="Novo pedido de compra"
          description={`A mercadoria vai chegar na unidade ${unitName}. O pedido nasce como rascunho: nada e enviado ao fornecedor e o estoque nao muda.`}
          headingLevel={2}
        />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <FormField id="order-supplier" label="Fornecedor" required>
            {(props) => (
              <Select {...props} name="supplierId" required defaultValue="">
                <option value="" disabled>
                  Escolha o fornecedor
                </option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </Select>
            )}
          </FormField>

          <FormField
            id="order-expected"
            label="Previsao de entrega"
            hint="Opcional. E a data prometida, nao um compromisso do sistema."
          >
            {(props) => <Input {...props} name="expectedAt" type="date" />}
          </FormField>

          <div className="sm:col-span-2">
            <FormField id="order-notes" label="Observacoes internas">
              {(props) => (
                <Textarea {...props} name="internalNotes" rows={3} maxLength={ORDER_NOTES_MAX} />
              )}
            </FormField>
          </div>
        </CardBody>
      </Card>

      <div className="flex justify-end">
        <SubmitButton>Abrir rascunho</SubmitButton>
      </div>
    </form>
  );
}
