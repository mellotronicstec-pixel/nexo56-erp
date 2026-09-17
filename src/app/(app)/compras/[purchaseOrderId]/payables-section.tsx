'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { Alert, Badge, Button, Card, CardBody, FormField, Input } from '@/design-system/components';
import { formatBRL } from '@/core/money/format';
import {
  INSTALLMENTS_MAX,
  TITLE_STATUS_TONE,
  titleStatusLabel,
} from '@/modules/finance/domain/finance';
import { EMPTY_FINANCE_STATE, type FinanceActionState } from '../../financeiro/action-state';

type ActionFn = (previous: FinanceActionState, formData: FormData) => Promise<FinanceActionState>;

export interface ReceiptPayableRow {
  receiptId: string;
  /** Ja formatado pelo servidor, no fuso da empresa: o cliente nao decide fuso. */
  receivedAtLabel: string;
  documentNumber: string | null;
  payable: {
    id: string;
    formattedNumber: string;
    amount: string;
    settledAmount: string;
    outstanding: string;
    status: string;
  } | null;
}

function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant="secondary" loading={pending} disabled={pending}>
      {children}
    </Button>
  );
}

/**
 * Contas a pagar do pedido de compra (Prompt 12, itens 33, 34, 37 e 69).
 *
 * UMA CONTA POR RECEBIMENTO, nunca uma por pedido.
 *
 * Esta e a decisao que faz a soma fechar. O fornecedor manda 6 das 10 pecas
 * hoje e as outras 4 na semana que vem — e cobra as duas entregas
 * separadamente. Uma conta por PEDIDO daria duas escolhas igualmente ruins:
 * criar a conta no pedido (e passar a dever por mercadoria que nunca chegou)
 * ou editar o valor a cada entrega (e corrigir um titulo que ja pode ter
 * pagamento). Uma conta por RECEBIMENTO faz R$ 600 + R$ 400 somarem exatos
 * R$ 1.000, e sobrevive ao cancelamento do resto do pedido.
 *
 * GERAR A CONTA NAO MUDA O PEDIDO, e pagar a conta tambem nao: o Financeiro
 * nao escreve em `purchase_orders`. Quitar nao recebe mercadoria, e receber
 * mercadoria nao paga ninguem.
 */
export function PayablesSection({
  purchaseOrderId,
  rows,
  canCreate,
  today,
  action,
}: {
  purchaseOrderId: string;
  rows: ReceiptPayableRow[];
  canCreate: boolean;
  today: string;
  action: ActionFn;
}) {
  const [state, formAction] = useActionState(action, EMPTY_FINANCE_STATE);

  if (rows.length === 0) {
    return (
      <Card>
        <CardBody>
          <p className="text-small text-ink-500">
            Nenhuma mercadoria recebida ainda. A conta a pagar nasce quando a mercadoria chega — no
            pedido nao se deve nada.
          </p>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardBody className="space-y-4">
        {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
        {state.success ? <Alert tone="success">{state.success}</Alert> : null}

        <ul className="divide-y divide-ink-100">
          {rows.map((row) => (
            <li key={row.receiptId} className="space-y-2 py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium text-ink-900">
                  Recebimento de {row.receivedAtLabel}
                  {row.documentNumber ? (
                    <span className="font-normal text-ink-500"> — nota {row.documentNumber}</span>
                  ) : null}
                </p>
                {row.payable ? (
                  <Badge tone={TITLE_STATUS_TONE[row.payable.status as never] ?? 'neutral'}>
                    {titleStatusLabel(row.payable.status, 'payable')}
                  </Badge>
                ) : (
                  <Badge tone="warning">Sem conta a pagar</Badge>
                )}
              </div>

              {row.payable ? (
                <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-small">
                  <span className="text-ink-700">
                    <span className="text-ink-500">Conta </span>
                    {row.payable.formattedNumber}
                  </span>
                  <span className="tabular-nums text-ink-700">
                    <span className="text-ink-500">Valor </span>
                    {formatBRL(row.payable.amount)}
                  </span>
                  <span className="tabular-nums text-ink-700">
                    <span className="text-ink-500">Em aberto </span>
                    {formatBRL(row.payable.outstanding)}
                  </span>
                  <Link
                    href={`/financeiro/titulos/${row.payable.id}`}
                    className="font-semibold text-brand-600 hover:underline"
                  >
                    Abrir no Financeiro
                  </Link>
                </div>
              ) : canCreate ? (
                <form
                  action={formAction}
                  className="flex flex-wrap items-end gap-3 rounded-md border border-ink-200 p-3"
                >
                  <input type="hidden" name="purchaseOrderId" value={purchaseOrderId} />
                  <input type="hidden" name="receiptId" value={row.receiptId} />

                  <FormField label="Vencimento" className="w-44">
                    {(field) => (
                      <Input {...field} name="dueDate" type="date" defaultValue={today} />
                    )}
                  </FormField>

                  <FormField label="Parcelas" className="w-28">
                    {(field) => (
                      <Input
                        {...field}
                        name="installmentCount"
                        type="number"
                        min={1}
                        max={INSTALLMENTS_MAX}
                        defaultValue={1}
                      />
                    )}
                  </FormField>

                  <SubmitButton>Gerar conta a pagar</SubmitButton>
                </form>
              ) : (
                <p className="text-small text-ink-500">
                  Nenhuma conta a pagar gerada para este recebimento.
                </p>
              )}
            </li>
          ))}
        </ul>

        <p className="text-small text-ink-500">
          Uma conta por recebimento: assim duas entregas parciais somam exatamente o que chegou, e
          nada e cobrado por mercadoria que nunca veio.
        </p>
      </CardBody>
    </Card>
  );
}
