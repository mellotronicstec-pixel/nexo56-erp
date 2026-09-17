'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  FormField,
  Input,
  MoneyInput,
} from '@/design-system/components';
import { formatBRL } from '@/core/money/format';
import {
  INSTALLMENTS_MAX,
  TITLE_DESCRIPTION_MAX,
  TITLE_STATUS_TONE,
  titleStatusLabel,
} from '@/modules/finance/domain/finance';
import { EMPTY_FINANCE_STATE, type FinanceActionState } from '../../financeiro/action-state';

type ActionFn = (previous: FinanceActionState, formData: FormData) => Promise<FinanceActionState>;

export interface ServiceOrderCharge {
  id: string;
  number: number;
  amount: string;
  settledAmount: string;
  outstanding: string;
  status: string;
  dueDate: string;
  installmentCount: number;
  formattedNumber: string;
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
 * Financeiro na ficha da Ordem de Servico (Prompt 12, itens 29 e 68).
 *
 * A COBRANCA NASCE DE UM ATO HUMANO, nao da aprovacao do orcamento.
 *
 * Criar o titulo automaticamente quando o cliente aprova pareceria eficiente e
 * seria errado em quase toda assistencia: o orcamento e aprovado no telefone
 * na terca e o aparelho so e retirado na sexta, as vezes com desconto
 * combinado no balcao, as vezes em duas vezes no cartao. Um titulo criado na
 * terca, com o valor da terca, vira um numero que alguem tem que corrigir
 * depois — e corrigir titulo com liquidacao e o que nao se faz.
 *
 * O VALOR VEM PRE-PREENCHIDO com o total do orcamento aprovado, porque esse e
 * o caso comum. Continua editavel porque o desconto de balcao existe.
 *
 * A OS NAO MUDA DE SITUACAO POR CAUSA DO FINANCEIRO, e o Financeiro nao
 * escreve em `service_orders`. Receber nao entrega o aparelho; entregar nao
 * quita a conta. Sao dois fatos diferentes, e junta-los apagaria a informacao
 * mais util que a loja tem: quem ja pagou e ainda nao levou.
 */
export function FinanceSection({
  serviceOrderId,
  charge,
  suggestedAmount,
  suggestedDescription,
  today,
  canCreate,
  action,
}: {
  serviceOrderId: string;
  charge: ServiceOrderCharge | null;
  suggestedAmount: string | null;
  suggestedDescription: string;
  today: string;
  canCreate: boolean;
  action: ActionFn;
}) {
  const [state, formAction] = useActionState(action, EMPTY_FINANCE_STATE);
  const [aberto, setAberto] = useState(false);

  if (charge) {
    const quitado = Number(charge.outstanding) <= 0;

    return (
      <Card>
        <CardBody className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-medium text-ink-900">
                Cobranca {charge.formattedNumber}
                {charge.installmentCount > 1 ? ` — ${charge.installmentCount}x` : ''}
              </p>
              <p className="text-small text-ink-500">
                Vence em {charge.dueDate.split('-').reverse().join('/')}
              </p>
            </div>
            <Badge tone={TITLE_STATUS_TONE[charge.status as never] ?? 'neutral'}>
              {titleStatusLabel(charge.status, 'receivable')}
            </Badge>
          </div>

          <dl className="grid grid-cols-3 gap-3 text-small">
            <div>
              <dt className="text-ink-500">Valor</dt>
              <dd className="font-medium tabular-nums text-ink-900">{formatBRL(charge.amount)}</dd>
            </div>
            <div>
              <dt className="text-ink-500">Recebido</dt>
              <dd className="font-medium tabular-nums text-ink-900">
                {formatBRL(charge.settledAmount)}
              </dd>
            </div>
            <div>
              <dt className="text-ink-500">Em aberto</dt>
              <dd className="font-medium tabular-nums text-ink-900">
                {formatBRL(charge.outstanding)}
              </dd>
            </div>
          </dl>

          {quitado ? (
            <Alert tone="success">
              A cobranca esta quitada. A entrega do aparelho continua sendo um passo a parte: pagar
              nao retira, e retirar nao quita.
            </Alert>
          ) : null}

          <Link
            href={`/financeiro/titulos/${charge.id}`}
            className="touch-target inline-flex items-center text-ui font-semibold text-brand-600 hover:underline"
          >
            Abrir a cobranca no Financeiro
          </Link>
        </CardBody>
      </Card>
    );
  }

  if (!canCreate) {
    return (
      <Card>
        <CardBody>
          <p className="text-small text-ink-500">Nenhuma cobranca gerada para este atendimento.</p>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardBody className="space-y-4">
        {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
        {state.success ? <Alert tone="success">{state.success}</Alert> : null}

        {!aberto ? (
          <>
            <p className="text-ui text-ink-700">
              Nenhuma cobranca gerada ainda. Gerar a cobranca nao muda a situacao da Ordem de
              Servico, e a Ordem de Servico nao muda a situacao da cobranca.
            </p>
            {suggestedAmount ? (
              <p className="text-small text-ink-500">
                Ha um orcamento aprovado de {formatBRL(suggestedAmount)}. O valor vem sugerido dali
                e pode ser ajustado — desconto de balcao existe.
              </p>
            ) : (
              <p className="text-small text-ink-500">
                Nao ha orcamento aprovado nesta Ordem de Servico: informe o valor a cobrar.
              </p>
            )}
            <Button type="button" onClick={() => setAberto(true)}>
              Gerar cobranca
            </Button>
          </>
        ) : (
          <form action={formAction} className="space-y-4">
            <input type="hidden" name="serviceOrderId" value={serviceOrderId} />

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Valor a cobrar" required>
                {(field) => (
                  <MoneyInput {...field} name="amount" defaultValue={suggestedAmount ?? ''} />
                )}
              </FormField>

              <FormField label="Vencimento" required>
                {(field) => <Input {...field} name="dueDate" type="date" defaultValue={today} />}
              </FormField>

              <FormField
                label="Parcelas"
                hint="A divisao dos centavos e feita pelo servidor e soma exatamente o total."
              >
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

              <FormField label="Descricao">
                {(field) => (
                  <Input
                    {...field}
                    name="description"
                    defaultValue={suggestedDescription}
                    maxLength={TITLE_DESCRIPTION_MAX}
                  />
                )}
              </FormField>
            </div>

            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setAberto(false)}>
                Cancelar
              </Button>
              <SubmitButton>Gerar cobranca</SubmitButton>
            </div>
          </form>
        )}
      </CardBody>
    </Card>
  );
}
