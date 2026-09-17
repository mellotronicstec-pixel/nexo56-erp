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
  MoneyInput,
  Select,
  Textarea,
  type ButtonVariant,
} from '@/design-system/components';
import { formatBRL } from '@/core/money/format';
import { CASH_REASON_MAX, CASH_REASON_MIN } from '@/modules/finance/domain/finance';
import { EMPTY_FINANCE_STATE, type FinanceActionState } from '../action-state';

type ActionFn = (previous: FinanceActionState, formData: FormData) => Promise<FinanceActionState>;

export interface CashAccountOption {
  id: string;
  name: string;
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
 * Abertura do caixa (Prompt 12, itens 21 a 23).
 *
 * UM CAIXA ABERTO POR CONTA, garantido por indice UNICO no banco — nao por
 * uma checagem nesta tela. Dois atendentes tocando "Abrir caixa" no mesmo
 * segundo e um evento comum na troca de turno, e so o banco consegue recusar
 * o segundo com certeza.
 *
 * O VALOR INICIAL E O QUE ESTA NA GAVETA, contado a mao. O sistema nao
 * adivinha: se ontem sobrou troco, alguem precisa dizer quanto.
 */
export function OpenCashForm({
  accounts,
  action,
}: {
  accounts: CashAccountOption[];
  action: ActionFn;
}) {
  const [state, formAction] = useActionState(action, EMPTY_FINANCE_STATE);

  if (accounts.length === 0) {
    return (
      <Alert tone="warning">
        Nenhuma conta de caixa esta disponivel nesta unidade. O caixa operacional exige uma conta do
        tipo dinheiro <strong>vinculada a esta loja</strong> — uma conta em especie compartilhada
        pela empresa seria uma gaveta sem endereco, que ninguem sabe quem conta no fim do dia.
        Cadastre uma nas configuracoes do Financeiro.
      </Alert>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Abrir o caixa"
        description="O dia comeca com o que ja esta na gaveta. Conte o troco antes de abrir."
        headingLevel={2}
      />
      <CardBody>
        <form action={formAction} className="space-y-4">
          {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
          {state.success ? <Alert tone="success">{state.success}</Alert> : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Conta" required>
              {(field) => (
                <Select {...field} name="financialAccountId" defaultValue={accounts[0]?.id ?? ''}>
                  {accounts.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>

            <FormField label="Valor inicial (troco)" hint="Deixe vazio se a gaveta comeca zerada.">
              {(field) => <MoneyInput {...field} name="openingAmount" />}
            </FormField>
          </div>

          <FormField label="Observacao">
            {(field) => <Textarea {...field} name="notes" rows={2} />}
          </FormField>

          <div className="flex justify-end">
            <SubmitButton>Abrir caixa</SubmitButton>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

/**
 * Suprimento e sangria (Prompt 12, item 24).
 *
 * SUPRIMENTO e dinheiro que entra na gaveta sem ser venda — troco trazido do
 * cofre. SANGRIA e dinheiro que sai sem ser pagamento — a retirada de
 * seguranca no meio da tarde. Os dois viram movimento no razao, com motivo
 * obrigatorio: e justamente o dinheiro que entra e sai "por fora" que
 * inviabiliza a conferencia no fim do dia quando nao fica registrado.
 */
export function CashAdjustmentForm({ sessionId, action }: { sessionId: string; action: ActionFn }) {
  const [state, formAction] = useActionState(action, EMPTY_FINANCE_STATE);
  const [kind, setKind] = useState<'supply' | 'withdrawal'>('supply');

  return (
    <Card>
      <CardHeader
        title="Suprimento e sangria"
        description="Dinheiro que entra ou sai da gaveta sem ser venda nem pagamento."
        headingLevel={2}
      />
      <CardBody>
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="sessionId" value={sessionId} />

          {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
          {state.success ? <Alert tone="success">{state.success}</Alert> : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Tipo" required>
              {(field) => (
                <Select
                  {...field}
                  name="kind"
                  value={kind}
                  onChange={(event) =>
                    setKind(event.target.value === 'withdrawal' ? 'withdrawal' : 'supply')
                  }
                >
                  <option value="supply">Suprimento (entra na gaveta)</option>
                  <option value="withdrawal">Sangria (sai da gaveta)</option>
                </Select>
              )}
            </FormField>

            <FormField label="Valor" required>
              {(field) => <MoneyInput {...field} name="amount" />}
            </FormField>
          </div>

          <FormField
            label="Motivo"
            required
            hint={`Entre ${CASH_REASON_MIN} e ${CASH_REASON_MAX} caracteres. Fica no historico e na auditoria.`}
          >
            {(field) => <Textarea {...field} name="reason" rows={2} maxLength={CASH_REASON_MAX} />}
          </FormField>

          <div className="flex justify-end">
            <SubmitButton variant="secondary">
              {kind === 'supply' ? 'Registrar suprimento' : 'Registrar sangria'}
            </SubmitButton>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

/**
 * Fechamento do caixa (Prompt 12, itens 25 a 27).
 *
 * O CAMPO DE CONTAGEM VEM VAZIO, DE PROPOSITO.
 *
 * Preencher com o valor esperado economizaria dois segundos e destruiria o
 * unico proposito do fechamento: descobrir a diferenca. Com o numero ja la,
 * todo caixa fecha certinho — inclusive o que esta com R$ 50 a menos.
 *
 * A DIFERENCA NAO SOME. Sobra e falta sao ditas em voz alta e gravadas. Um
 * sistema que engole a diferenca ensina a equipe que o caixa nunca erra, e
 * ai o primeiro erro de verdade passa despercebido por semanas.
 */
export function CloseCashForm({
  sessionId,
  expectedAmount,
  action,
}: {
  sessionId: string;
  expectedAmount: string;
  action: ActionFn;
}) {
  const [state, formAction] = useActionState(action, EMPTY_FINANCE_STATE);
  const [conferido, setConferido] = useState(false);

  return (
    <Card>
      <CardHeader
        title="Fechar o caixa"
        description="Conte o dinheiro da gaveta e informe o que encontrou. O sistema compara e registra a diferenca."
        headingLevel={2}
      />
      <CardBody>
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="sessionId" value={sessionId} />

          {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
          {state.success ? <Alert tone="success">{state.success}</Alert> : null}

          {!conferido ? (
            <>
              <Alert tone="info">
                Conte o dinheiro ANTES de ver o valor esperado. O fechamento existe para descobrir a
                diferenca; ver o numero antes faz todo caixa fechar certinho, inclusive o que esta
                faltando.
              </Alert>
              <Button type="button" variant="secondary" onClick={() => setConferido(true)}>
                Ja contei, quero informar o valor
              </Button>
            </>
          ) : (
            <>
              <FormField
                label="Valor contado na gaveta"
                required
                hint="O que voce contou, nao o que o sistema espera."
              >
                {(field) => <MoneyInput {...field} name="countedAmount" />}
              </FormField>

              <FormField label="Observacao">
                {(field) => <Textarea {...field} name="notes" rows={2} />}
              </FormField>

              <details className="rounded-md border border-ink-200 p-3">
                <summary className="cursor-pointer text-ui font-medium text-ink-700">
                  Ver o valor esperado pelo sistema
                </summary>
                <p className="mt-2 text-ui tabular-nums text-ink-900">
                  {formatBRL(expectedAmount)}
                </p>
                <p className="mt-1 text-small text-ink-500">
                  Valor de abertura mais entradas, menos saidas, registradas nesta sessao.
                </p>
              </details>

              <div className="flex justify-end">
                <SubmitButton>Fechar caixa</SubmitButton>
              </div>
            </>
          )}
        </form>
      </CardBody>
    </Card>
  );
}
