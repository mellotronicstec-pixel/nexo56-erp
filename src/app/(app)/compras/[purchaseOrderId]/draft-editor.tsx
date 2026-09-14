'use client';

import { useActionState, useMemo, useState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  FormField,
  Input,
  MoneyInput,
  Select,
  Textarea,
} from '@/design-system/components';
import { formatBRL, normalizeAmountInput, normalizeQuantityInput } from '@/core/money/format';
import { Money } from '@/core/money/money';
import { ORDER_NOTES_MAX } from '@/modules/purchasing/domain/purchasing';
import { EMPTY_PURCHASING_STATE, type PurchasingActionState } from '../action-state';

/**
 * Editor do rascunho do pedido (Prompt 11, itens 14, 15 e 62).
 *
 * O TOTAL MOSTRADO AQUI E UMA PREVIA. Quem calcula de verdade e o servidor, a
 * partir das linhas gravadas; esta conta existe para a pessoa ver o efeito do
 * que digitou antes de salvar, e usa o mesmo `Money` do backend — nunca
 * aritmetica de ponto flutuante.
 *
 * FRETE E DESCONTO FICAM NO PEDIDO, e nao rateados no custo de cada peca
 * (ADR-051). Diluir o frete mudaria silenciosamente o custo medio do estoque,
 * e ninguem conseguiria explicar por que a mesma peca passou a custar mais
 * sem ninguem ter mudado o preco.
 */

type ActionFn = (
  previous: PurchasingActionState,
  formData: FormData,
) => Promise<PurchasingActionState>;

export interface PartOption {
  id: string;
  code: string;
  name: string;
  unitOfMeasure: string;
}

export interface NeedOption {
  id: string;
  partId: string;
  label: string;
}

export interface EditableItem {
  partId: string;
  quantity: string;
  unitCost: string;
  supplierCode: string;
  purchaseNeedId: string;
}

interface Row extends EditableItem {
  /** Chave local. Nao e o id do banco: linha nova ainda nao tem id. */
  key: string;
}

let rowCounter = 0;
function newRow(): Row {
  rowCounter += 1;
  return {
    key: `linha-${rowCounter}`,
    partId: '',
    quantity: '1',
    unitCost: '',
    supplierCode: '',
    purchaseNeedId: '',
  };
}

function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending} disabled={pending}>
      {children}
    </Button>
  );
}

/** Previa dos totais, com a MESMA aritmetica do servidor. */
function previewTotals(
  rows: readonly Row[],
  discount: string,
  freight: string,
  otherCosts: string,
) {
  let subtotal = Money.zero();

  for (const row of rows) {
    const quantity = normalizeQuantityInput(row.quantity);
    const cost = normalizeAmountInput(row.unitCost);
    if (!row.partId || !quantity || !cost) continue;

    try {
      subtotal = subtotal.add(Money.parse(cost).multiply(quantity));
    } catch {
      // Digitacao incompleta nao e erro: a linha so nao entra na previa ainda.
    }
  }

  const parse = (raw: string) => {
    try {
      return Money.parse(normalizeAmountInput(raw) ?? '0');
    } catch {
      return Money.zero();
    }
  };

  let abatimento = parse(discount);
  if (abatimento.compare(subtotal) > 0) abatimento = subtotal;

  const total = subtotal.subtract(abatimento).add(parse(freight)).add(parse(otherCosts));

  return { subtotal, discount: abatimento, total };
}

export function PurchaseDraftEditor({
  purchaseOrderId,
  initialItems,
  initialDiscount,
  initialFreight,
  initialOtherCosts,
  initialExpectedAt,
  initialInternalNotes,
  initialSupplierNotes,
  parts,
  needs,
  action,
}: {
  purchaseOrderId: string;
  initialItems: EditableItem[];
  initialDiscount: string;
  initialFreight: string;
  initialOtherCosts: string;
  initialExpectedAt: string;
  initialInternalNotes: string;
  initialSupplierNotes: string;
  parts: PartOption[];
  /** Necessidades abertas desta unidade, para vincular a linha (item 29). */
  needs: NeedOption[];
  action: ActionFn;
}) {
  const [state, formAction] = useActionState(action, EMPTY_PURCHASING_STATE);

  const [rows, setRows] = useState<Row[]>(() =>
    initialItems.length > 0
      ? initialItems.map((item) => {
          rowCounter += 1;
          return { ...item, key: `linha-${rowCounter}` };
        })
      : [newRow()],
  );

  /** Zero nao se mostra: campo vazio e mais honesto que "R$ 0,00" digitado. */
  const semZero = (value: string) => (value === '0.00' ? '' : value);

  const [discount, setDiscount] = useState(() => semZero(initialDiscount));
  const [freight, setFreight] = useState(() => semZero(initialFreight));
  const [otherCosts, setOtherCosts] = useState(() => semZero(initialOtherCosts));

  const totals = useMemo(
    () => previewTotals(rows, discount, freight, otherCosts),
    [rows, discount, freight, otherCosts],
  );

  const patchRow = (key: string, patch: Partial<Row>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="purchaseOrderId" value={purchaseOrderId} />

      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}

      <Card>
        <CardHeader
          title="Itens do pedido"
          description="O que se esta comprando e por quanto. O custo aqui e o que o fornecedor cobra — nao e o preco de venda."
          headingLevel={2}
          action={
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setRows((current) => [...current, newRow()])}
            >
              Adicionar item
            </Button>
          }
        />
        <CardBody className="space-y-4">
          {parts.length === 0 ? (
            <Alert tone="info">
              Nenhuma peca ativa no catalogo. Cadastre a peca no Estoque antes de comprar: o pedido
              compra peca do catalogo, e nao texto livre.
            </Alert>
          ) : null}

          {rows.map((row, index) => {
            const peca = parts.find((part) => part.id === row.partId);
            const necessidadesDaPeca = needs.filter((need) => need.partId === row.partId);

            return (
              <fieldset
                key={row.key}
                className="grid gap-3 rounded-lg border border-ink-200 p-4 md:grid-cols-12"
              >
                <legend className="px-1 text-small font-medium text-ink-600">
                  Item {index + 1}
                </legend>

                <div className="md:col-span-5">
                  <FormField id={`item-part-${row.key}`} label="Peca" required>
                    {(props) => (
                      <Select
                        {...props}
                        name="itemPartId"
                        required
                        value={row.partId}
                        onChange={(event) =>
                          patchRow(row.key, { partId: event.target.value, purchaseNeedId: '' })
                        }
                      >
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

                <div className="md:col-span-2">
                  <FormField id={`item-quantity-${row.key}`} label="Quantidade" required>
                    {(props) => (
                      <Input
                        {...props}
                        name="itemQuantity"
                        inputMode="decimal"
                        required
                        value={row.quantity}
                        onChange={(event) => patchRow(row.key, { quantity: event.target.value })}
                      />
                    )}
                  </FormField>
                </div>

                <div className="md:col-span-2">
                  <FormField id={`item-cost-${row.key}`} label="Custo unitario" required>
                    {(props) => (
                      <MoneyInput
                        {...props}
                        name="itemUnitCost"
                        required
                        defaultValue={row.unitCost}
                        onChange={(event) =>
                          patchRow(row.key, { unitCost: event.currentTarget.value })
                        }
                      />
                    )}
                  </FormField>
                </div>

                <div className="md:col-span-2">
                  <FormField
                    id={`item-supplier-code-${row.key}`}
                    label="Codigo no fornecedor"
                    hint="Opcional."
                  >
                    {(props) => (
                      <Input
                        {...props}
                        name="itemSupplierCode"
                        maxLength={60}
                        value={row.supplierCode}
                        onChange={(event) =>
                          patchRow(row.key, { supplierCode: event.target.value })
                        }
                      />
                    )}
                  </FormField>
                </div>

                <div className="flex items-end md:col-span-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setRows((current) =>
                        current.length === 1 ? current : current.filter((r) => r.key !== row.key),
                      )
                    }
                    disabled={rows.length === 1}
                  >
                    Remover
                    <span className="sr-only"> o item {index + 1}</span>
                  </Button>
                </div>

                <div className="md:col-span-12">
                  <FormField
                    id={`item-need-${row.key}`}
                    label="Atende a necessidade"
                    hint="Opcional. Vincular deixa claro para quem pediu que a compra foi feita — e a necessidade so fecha quando a peca chegar."
                  >
                    {(props) => (
                      <Select
                        {...props}
                        name="itemNeedId"
                        value={row.purchaseNeedId}
                        onChange={(event) =>
                          patchRow(row.key, { purchaseNeedId: event.target.value })
                        }
                        disabled={necessidadesDaPeca.length === 0}
                      >
                        <option value="">Nao vincular</option>
                        {necessidadesDaPeca.map((need) => (
                          <option key={need.id} value={need.id}>
                            {need.label}
                          </option>
                        ))}
                      </Select>
                    )}
                  </FormField>
                  {peca ? (
                    <p className="mt-1 text-small text-ink-500">
                      Unidade de medida: {peca.unitOfMeasure}
                    </p>
                  ) : null}
                </div>
              </fieldset>
            );
          })}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Valores e previsao"
          description="Frete e outros custos entram no total do pedido. Eles NAO sao diluidos no custo de cada peca: o custo medio do estoque continua sendo o que se pagou pela peca."
          headingLevel={2}
        />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <FormField id="order-discount" label="Desconto do fornecedor">
            {(props) => (
              <MoneyInput
                {...props}
                name="discount"
                defaultValue={semZero(initialDiscount)}
                onChange={(event) => setDiscount(event.currentTarget.value)}
              />
            )}
          </FormField>

          <FormField id="order-freight" label="Frete">
            {(props) => (
              <MoneyInput
                {...props}
                name="freight"
                defaultValue={semZero(initialFreight)}
                onChange={(event) => setFreight(event.currentTarget.value)}
              />
            )}
          </FormField>

          <FormField id="order-other-costs" label="Outros custos">
            {(props) => (
              <MoneyInput
                {...props}
                name="otherCosts"
                defaultValue={semZero(initialOtherCosts)}
                onChange={(event) => setOtherCosts(event.currentTarget.value)}
              />
            )}
          </FormField>

          <FormField id="order-expected-at" label="Previsao de entrega">
            {(props) => (
              <Input {...props} name="expectedAt" type="date" defaultValue={initialExpectedAt} />
            )}
          </FormField>

          <div className="sm:col-span-2">
            <FormField id="order-supplier-notes" label="Observacoes para o fornecedor">
              {(props) => (
                <Textarea
                  {...props}
                  name="supplierNotes"
                  rows={2}
                  maxLength={ORDER_NOTES_MAX}
                  defaultValue={initialSupplierNotes}
                />
              )}
            </FormField>
          </div>

          <div className="sm:col-span-2">
            <FormField id="order-internal-notes" label="Observacoes internas">
              {(props) => (
                <Textarea
                  {...props}
                  name="internalNotes"
                  rows={2}
                  maxLength={ORDER_NOTES_MAX}
                  defaultValue={initialInternalNotes}
                />
              )}
            </FormField>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <dl className="space-y-2 text-ui">
            <div className="flex justify-between">
              <dt className="text-ink-600">Subtotal dos itens</dt>
              <dd className="font-medium text-ink-900">{formatBRL(totals.subtotal)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-600">Desconto</dt>
              <dd className="font-medium text-ink-900">- {formatBRL(totals.discount)}</dd>
            </div>
            <div className="flex justify-between border-t border-ink-200 pt-2">
              <dt className="font-semibold text-ink-900">Total do pedido</dt>
              <dd className="font-semibold text-ink-900">{formatBRL(totals.total)}</dd>
            </div>
          </dl>
          <p className="mt-2 text-small text-ink-500">
            Previa calculada nesta tela. O valor que vale e o que o servidor grava ao salvar.
          </p>
        </CardBody>
      </Card>

      <div className="flex justify-end">
        <SubmitButton>Salvar rascunho</SubmitButton>
      </div>
    </form>
  );
}
