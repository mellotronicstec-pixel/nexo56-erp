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
  Modal,
  MoneyInput,
  Select,
  Textarea,
} from '@/design-system/components';
import { formatBRL, normalizeAmountInput, normalizeQuantityInput } from '@/core/money/format';
import { Money } from '@/core/money/money';
import { QUOTE_ITEM_KINDS, QUOTE_ITEM_KIND_LABEL } from '@/modules/quotes/domain/quote';
import { EMPTY_QUOTE_STATE, type QuoteActionState } from './action-state';

/**
 * Editor de itens do orcamento (Prompt 09, itens 84 a 88).
 *
 * O TOTAL MOSTRADO AQUI E UMA PREVIA (item 36). Quem calcula de verdade e o
 * servidor, a partir das linhas gravadas; esta conta existe para a pessoa ver
 * o efeito do que digitou antes de salvar, e usa o mesmo `Money` do backend —
 * nunca aritmetica de ponto flutuante.
 */

type ActionFn = (previous: QuoteActionState, formData: FormData) => Promise<QuoteActionState>;

export interface EditableItem {
  kind: string;
  description: string;
  quantity: string;
  unitPrice: string;
  discount: string;
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
    kind: 'service',
    description: '',
    quantity: '1',
    unitPrice: '',
    discount: '',
  };
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

/** Previa dos totais, com a MESMA aritmetica do servidor. */
function previewTotals(rows: readonly Row[], globalDiscount: string) {
  let subtotal = Money.zero();

  for (const row of rows) {
    const quantity = normalizeQuantityInput(row.quantity);
    const price = normalizeAmountInput(row.unitPrice);
    if (!quantity || !price) continue;

    try {
      const gross = Money.parse(price).multiply(quantity);
      const discount = Money.parse(normalizeAmountInput(row.discount) ?? '0');
      const line = gross.subtract(discount);
      subtotal = subtotal.add(line.isNegative() ? Money.zero() : line);
    } catch {
      // Digitacao incompleta nao e erro: a linha so nao entra na previa ainda.
    }
  }

  let discount = Money.zero();
  try {
    discount = Money.parse(normalizeAmountInput(globalDiscount) ?? '0');
  } catch {
    discount = Money.zero();
  }
  if (discount.compare(subtotal) > 0) discount = subtotal;

  return { subtotal, discount, total: subtotal.subtract(discount) };
}

export function QuoteEditor({
  serviceOrderId,
  quoteId,
  version,
  initialItems,
  initialDiscount,
  initialValidUntil,
  initialCustomerNotes,
  initialInternalNotes,
  action,
}: {
  serviceOrderId: string;
  quoteId: string;
  version: number;
  initialItems: EditableItem[];
  initialDiscount: string;
  initialValidUntil: string;
  initialCustomerNotes: string;
  initialInternalNotes: string;
  action: ActionFn;
}) {
  const [state, formAction] = useActionState(action, EMPTY_QUOTE_STATE);

  const [rows, setRows] = useState<Row[]>(() =>
    initialItems.length > 0
      ? initialItems.map((item, index) => ({ ...item, key: `inicial-${index}` }))
      : [newRow()],
  );
  const [globalDiscount, setGlobalDiscount] = useState(
    initialDiscount === '0.00' ? '' : initialDiscount,
  );

  const totals = useMemo(() => previewTotals(rows, globalDiscount), [rows, globalDiscount]);

  const update = (key: string, patch: Partial<Row>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="quoteId" value={quoteId} />
      <input type="hidden" name="serviceOrderId" value={serviceOrderId} />
      {/* A versao lida vai junto: quem perder a corrida recebe aviso (item 96). */}
      <input type="hidden" name="expectedVersion" value={version} />

      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}

      <Card>
        <CardHeader
          title="Itens"
          description="Servicos e pecas propostos ao cliente. A descricao e livre."
          headingLevel={3}
        />
        <CardBody className="space-y-4">
          {/*
            UMA LINHA POR BLOCO, e nao uma tabela com scroll horizontal. Em
            360px uma tabela de cinco colunas obriga a arrastar a tela para ver
            o preco do que se esta digitando — e digitar preco sem ver o preco
            e como o erro de um zero a mais acontece.
          */}
          <ul className="space-y-4">
            {rows.map((row, index) => (
              <li
                key={row.key}
                className="rounded-lg border border-ink-200 p-3 sm:p-4"
                data-testid="item-row"
              >
                <div className="grid gap-3 sm:grid-cols-12">
                  <div className="sm:col-span-3">
                    <FormField id={`kind-${row.key}`} label="Tipo">
                      {(props) => (
                        <Select
                          {...props}
                          name="itemKind"
                          value={row.kind}
                          onChange={(event) => update(row.key, { kind: event.target.value })}
                        >
                          {QUOTE_ITEM_KINDS.map((kind) => (
                            <option key={kind} value={kind}>
                              {QUOTE_ITEM_KIND_LABEL[kind]}
                            </option>
                          ))}
                        </Select>
                      )}
                    </FormField>
                  </div>

                  <div className="sm:col-span-9">
                    <FormField id={`description-${row.key}`} label="Descricao" required>
                      {(props) => (
                        <Input
                          {...props}
                          name="itemDescription"
                          required
                          maxLength={200}
                          value={row.description}
                          onChange={(event) => update(row.key, { description: event.target.value })}
                        />
                      )}
                    </FormField>
                  </div>

                  <div className="sm:col-span-3">
                    <FormField id={`quantity-${row.key}`} label="Quantidade">
                      {(props) => (
                        <Input
                          {...props}
                          name="itemQuantity"
                          inputMode="decimal"
                          className="text-right tabular-nums"
                          value={row.quantity}
                          onChange={(event) => update(row.key, { quantity: event.target.value })}
                        />
                      )}
                    </FormField>
                  </div>

                  <div className="sm:col-span-4">
                    <FormField id={`price-${row.key}`} label="Valor unitario (R$)">
                      {(props) => (
                        <MoneyInput
                          {...props}
                          name="itemUnitPrice"
                          defaultValue={row.unitPrice}
                          onChange={(event) =>
                            update(row.key, { unitPrice: event.currentTarget.value })
                          }
                        />
                      )}
                    </FormField>
                  </div>

                  <div className="sm:col-span-3">
                    <FormField id={`discount-${row.key}`} label="Desconto (R$)">
                      {(props) => (
                        <MoneyInput
                          {...props}
                          name="itemDiscount"
                          defaultValue={row.discount}
                          onChange={(event) =>
                            update(row.key, { discount: event.currentTarget.value })
                          }
                        />
                      )}
                    </FormField>
                  </div>

                  <div className="flex items-end sm:col-span-2">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() =>
                        setRows((current) =>
                          current.length === 1
                            ? [newRow()]
                            : current.filter((item) => item.key !== row.key),
                        )
                      }
                    >
                      Remover
                      <span className="sr-only"> o item {index + 1}</span>
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>

          <Button
            type="button"
            variant="secondary"
            onClick={() => setRows((current) => [...current, newRow()])}
          >
            Adicionar item
          </Button>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Condicoes" headingLevel={3} />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <FormField
            id="quote-discount"
            label="Desconto no total (R$)"
            hint="Em valor. Percentual chega quando houver decisao comercial."
          >
            {(props) => (
              <MoneyInput
                {...props}
                name="discount"
                defaultValue={initialDiscount === '0.00' ? '' : initialDiscount}
                onChange={(event) => setGlobalDiscount(event.currentTarget.value)}
              />
            )}
          </FormField>

          <FormField
            id="quote-valid-until"
            label="Valido ate"
            hint="Opcional. Nao ha prazo padrao definido."
          >
            {(props) => (
              <Input {...props} type="date" name="validUntil" defaultValue={initialValidUntil} />
            )}
          </FormField>

          <div className="sm:col-span-2">
            <FormField
              id="quote-customer-notes"
              label="Observacoes para o cliente"
              hint="Sera apresentado ao cliente quando houver documento ou Portal."
            >
              {(props) => (
                <Textarea
                  {...props}
                  name="customerNotes"
                  rows={3}
                  maxLength={2000}
                  defaultValue={initialCustomerNotes}
                />
              )}
            </FormField>
          </div>

          <div className="sm:col-span-2">
            <FormField
              id="quote-internal-notes"
              label="Observacoes internas"
              hint="Recado da equipe. Nao vai ao cliente."
            >
              {(props) => (
                <Textarea
                  {...props}
                  name="internalNotes"
                  rows={2}
                  maxLength={2000}
                  defaultValue={initialInternalNotes}
                />
              )}
            </FormField>
          </div>
        </CardBody>
      </Card>

      {/*
        TOTAL SEMPRE VISIVEL (itens 87 e 88). Fica grudado na base no celular,
        onde a lista de itens e mais alta que a tela — sem isso, a pessoa
        digita valores sem nunca ver o efeito deles.
      */}
      <div className="sticky bottom-0 z-10 -mx-4 border-t border-ink-200 bg-white px-4 py-3 shadow-lg sm:mx-0 sm:rounded-lg sm:border">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <dl className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-ui">
            <div className="flex items-baseline gap-2">
              <dt className="text-ink-500">Subtotal</dt>
              <dd className="tabular-nums text-ink-800">{formatBRL(totals.subtotal)}</dd>
            </div>
            {!totals.discount.isZero() ? (
              <div className="flex items-baseline gap-2">
                <dt className="text-ink-500">Desconto</dt>
                <dd className="tabular-nums text-ink-800">− {formatBRL(totals.discount)}</dd>
              </div>
            ) : null}
            <div className="flex items-baseline gap-2">
              <dt className="font-semibold text-ink-700">Total</dt>
              <dd
                className="font-heading text-h5 font-semibold tabular-nums text-ink-900"
                data-testid="quote-total"
              >
                {formatBRL(totals.total)}
              </dd>
            </div>
          </dl>

          <SubmitButton>Salvar rascunho</SubmitButton>
        </div>
        <p className="mt-1 text-small text-ink-500">
          Previa. O valor gravado e recalculado pelo servidor ao salvar.
        </p>
      </div>
    </form>
  );
}

/** Acao com confirmacao e, quando exigido, motivo escrito. */
export function QuoteDecision({
  serviceOrderId,
  quoteId,
  version,
  label,
  title,
  description,
  confirmLabel,
  variant = 'primary',
  requiresReason = false,
  action,
}: {
  serviceOrderId: string;
  quoteId: string;
  version: number;
  label: string;
  title: string;
  description: string;
  confirmLabel: string;
  variant?: 'primary' | 'secondary' | 'destructive';
  requiresReason?: boolean;
  action: ActionFn;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(
    async (previous: QuoteActionState, formData: FormData) => {
      const result = await action(previous, formData);
      // O dialogo fecha sozinho quando a acao da certo; no erro permanece
      // aberto, com o aviso e o que foi digitado no lugar.
      if (!result.error) setOpen(false);
      return result;
    },
    EMPTY_QUOTE_STATE,
  );

  return (
    <>
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}

      <Button type="button" variant={variant} onClick={() => setOpen(true)}>
        {label}
      </Button>

      <Modal open={open} onClose={() => setOpen(false)} title={title} description={description}>
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="quoteId" value={quoteId} />
          <input type="hidden" name="serviceOrderId" value={serviceOrderId} />
          <input type="hidden" name="expectedVersion" value={version} />

          {requiresReason ? (
            <FormField id={`reason-${quoteId}`} label="Motivo" required>
              {(props) => <Textarea {...props} name="reason" rows={3} required maxLength={300} />}
            </FormField>
          ) : null}

          <div className="flex flex-wrap justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Voltar
            </Button>
            <SubmitButton variant={variant === 'destructive' ? 'destructive' : 'primary'}>
              {confirmLabel}
            </SubmitButton>
          </div>
        </form>
      </Modal>
    </>
  );
}

/** Botao simples de acao sem confirmacao (criar, revisar). */
export function QuoteSimpleAction({
  serviceOrderId,
  quoteId,
  label,
  variant = 'secondary',
  idempotencyKey,
  action,
}: {
  serviceOrderId: string;
  quoteId?: string;
  label: string;
  variant?: 'primary' | 'secondary' | 'ghost';
  idempotencyKey?: string;
  action: ActionFn;
}) {
  const [state, formAction] = useActionState(action, EMPTY_QUOTE_STATE);

  return (
    <form action={formAction} className="inline-flex flex-col gap-2">
      <input type="hidden" name="serviceOrderId" value={serviceOrderId} />
      {quoteId ? <input type="hidden" name="quoteId" value={quoteId} /> : null}
      {idempotencyKey ? <input type="hidden" name="idempotencyKey" value={idempotencyKey} /> : null}
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      <SubmitButton variant={variant}>{label}</SubmitButton>
    </form>
  );
}
