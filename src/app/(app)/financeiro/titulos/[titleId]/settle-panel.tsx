'use client';

import { useMemo, useState } from 'react';
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
  MoneyInput,
  Select,
  Textarea,
} from '@/design-system/components';
import { formatBRL } from '@/core/money/format';
import {
  CARD_INSTALLMENTS_MAX,
  SETTLEMENT_NOTES_MAX,
  SETTLEMENT_REFERENCE_MAX,
  SETTLEMENT_NOUN,
  supportsCardInstallments,
  supportsCashSession,
  type TitleDirection,
} from '@/modules/finance/domain/finance';
import { EMPTY_FINANCE_STATE, type FinanceActionState } from '../../action-state';

type ActionFn = (previous: FinanceActionState, formData: FormData) => Promise<FinanceActionState>;

export interface SettleableInstallment {
  id: string;
  number: number;
  amount: string;
  settledAmount: string;
  outstanding: string;
  dueDate: string;
}

export interface AccountOption {
  id: string;
  name: string;
  kind: string;
}

export interface MethodOption {
  id: string;
  name: string;
  kind: string;
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
 * Registro de recebimento ou pagamento (Prompt 12, itens 38 a 44 e 67).
 *
 * PAGAR PARCIAL E O NORMAL, nao a excecao: o cliente deixa metade e volta na
 * sexta. Por isso o campo de valor ja vem preenchido com o saldo da parcela —
 * o caso comum e "pagou o que faltava" — mas continua editavel para o valor
 * que efetivamente entrou na gaveta. Quem decide se cabe e o servidor.
 *
 * CHAVE DE COMANDO (item 42): nasce no cliente quando o painel monta e muda
 * a cada liquidacao REGISTRADA com sucesso. Duplo clique, botao voltar e o
 * retry depois de uma queda de rede reencontram a mesma liquidacao em vez de
 * lancar o dinheiro duas vezes; ja o segundo pagamento legitimo da mesma
 * parcela precisa de chave nova, senao seria confundido com um reenvio.
 *
 * O CAIXA APARECE QUANDO E EXIGIDO: contas do tipo dinheiro so aceitam
 * liquidacao com sessao aberta, e a tela diz isso ANTES do envio em vez de
 * deixar a pessoa contar o dinheiro e so entao receber uma recusa.
 *
 * A pergunta e sobre A CONTA ESCOLHIDA, nao sobre a loja. Com duas contas em
 * especie na mesma unidade, "ha algum caixa aberto aqui?" respondia sim
 * enquanto a conta do formulario continuava fechada — e a recusa so aparecia
 * depois do envio. Por isso a prop e o conjunto das contas abertas.
 */
export function SettlePanel({
  titleId,
  direction,
  installments,
  accounts,
  methods,
  accountsWithOpenCash,
  today,
  action,
}: {
  titleId: string;
  direction: TitleDirection;
  installments: SettleableInstallment[];
  accounts: AccountOption[];
  methods: MethodOption[];
  accountsWithOpenCash: readonly string[];
  today: string;
  action: ActionFn;
}) {
  const [commandKey, setCommandKey] = useState(() => crypto.randomUUID());

  const [state, formAction] = useActionState(
    async (previous: FinanceActionState, formData: FormData) => {
      const result = await action(previous, formData);
      if (!result.error) setCommandKey(crypto.randomUUID());
      return result;
    },
    EMPTY_FINANCE_STATE,
  );

  const [installmentId, setInstallmentId] = useState(() => installments[0]?.id ?? '');
  /**
   * A conta inicial e a PRIMEIRA QUE VAI FUNCIONAR, nao a primeira da lista.
   *
   * Ordenadas por nome, "Caixa da loja" costuma vir antes de "Banco" — e se o
   * caixa estiver fechado o formulario abria ja bloqueado, com um aviso antes
   * de a pessoa ter escolhido coisa nenhuma. Preferir uma conta utilizavel faz
   * o aviso aparecer quando ele significa alguma coisa: quando a pessoa
   * escolheu de proposito um caixa fechado.
   */
  const [accountId, setAccountId] = useState(() => {
    const utilizavel = accounts.find(
      (item) => !supportsCashSession(item.kind) || accountsWithOpenCash.includes(item.id),
    );
    return (utilizavel ?? accounts[0])?.id ?? '';
  });
  const [methodId, setMethodId] = useState(() => methods[0]?.id ?? '');

  const parcela = useMemo(
    () => installments.find((item) => item.id === installmentId) ?? installments[0],
    [installments, installmentId],
  );
  const conta = accounts.find((item) => item.id === accountId);
  const forma = methods.find((item) => item.id === methodId);

  const exigeCaixa = conta ? supportsCashSession(conta.kind) : false;
  const bloqueadoPorCaixa = exigeCaixa && !accountsWithOpenCash.includes(accountId);
  const mostraParcelasDoCartao = forma ? supportsCardInstallments(forma.kind) : false;

  const ato = SETTLEMENT_NOUN[direction];

  if (installments.length === 0) {
    return (
      <Card>
        <CardHeader title={`Registrar ${ato}`} headingLevel={2} />
        <CardBody>
          <Alert tone="info">Nao ha parcela em aberto neste titulo.</Alert>
        </CardBody>
      </Card>
    );
  }

  if (accounts.length === 0 || methods.length === 0) {
    return (
      <Card>
        <CardHeader title={`Registrar ${ato}`} headingLevel={2} />
        <CardBody>
          <Alert tone="warning">
            {accounts.length === 0
              ? 'Nao ha conta financeira ativa para esta unidade. Sem uma conta nao existe onde registrar a entrada do dinheiro.'
              : 'Nao ha forma de pagamento ativa. Cadastre ao menos uma nas configuracoes do Financeiro.'}
          </Alert>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title={`Registrar ${ato}`}
        description="O lancamento entra no razao financeiro e muda o saldo da conta. Nao se apaga: se estiver errado, estorna-se."
        headingLevel={2}
      />
      <CardBody>
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="titleId" value={titleId} />
          <input type="hidden" name="direction" value={direction} />
          <input type="hidden" name="commandKey" value={commandKey} />

          {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
          {state.success ? <Alert tone="success">{state.success}</Alert> : null}

          {bloqueadoPorCaixa ? (
            <Alert tone="warning">
              O caixa da conta <strong>{conta?.name}</strong> esta fechado. Abra este caixa antes de
              registrar — assim a gaveta fecha no fim do dia batendo com o sistema. Ter outro caixa
              aberto na loja nao serve: o dinheiro entra na gaveta desta conta.
            </Alert>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Parcela" required>
              {(field) => (
                <Select
                  {...field}
                  name="installmentId"
                  value={installmentId}
                  onChange={(event) => setInstallmentId(event.target.value)}
                >
                  {installments.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.number}
                      {' — vence '}
                      {item.dueDate.split('-').reverse().join('/')}
                      {' — saldo '}
                      {formatBRL(item.outstanding)}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>

            <FormField
              label="Valor"
              required
              hint={
                parcela
                  ? `Saldo desta parcela: ${formatBRL(parcela.outstanding)}. Pode ser menor, nunca maior.`
                  : undefined
              }
            >
              {(field) => (
                <MoneyInput
                  {...field}
                  key={parcela?.id ?? 'sem-parcela'}
                  name="amount"
                  defaultValue={parcela?.outstanding ?? ''}
                />
              )}
            </FormField>

            <FormField label="Conta financeira" required>
              {(field) => (
                <Select
                  {...field}
                  name="financialAccountId"
                  value={accountId}
                  onChange={(event) => setAccountId(event.target.value)}
                >
                  {accounts.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>

            <FormField label="Forma de pagamento" required>
              {(field) => (
                <Select
                  {...field}
                  name="paymentMethodId"
                  value={methodId}
                  onChange={(event) => setMethodId(event.target.value)}
                >
                  {methods.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>

            <FormField label="Data" hint="O dia em que o dinheiro efetivamente mudou de maos.">
              {(field) => (
                <Input {...field} name="effectiveDate" type="date" defaultValue={today} />
              )}
            </FormField>

            {mostraParcelasDoCartao ? (
              <FormField
                label="Parcelas no cartao"
                hint="Registro do que foi combinado na maquininha. O Nexo56 nao fala com a adquirente."
              >
                {(field) => (
                  <Input
                    {...field}
                    name="cardInstallments"
                    type="number"
                    min={1}
                    max={CARD_INSTALLMENTS_MAX}
                    defaultValue={1}
                  />
                )}
              </FormField>
            ) : null}

            <FormField
              label="Referencia"
              hint="Numero do comprovante, do documento ou da transacao, se houver."
            >
              {(field) => (
                <Input {...field} name="reference" maxLength={SETTLEMENT_REFERENCE_MAX} />
              )}
            </FormField>
          </div>

          <FormField label="Observacao">
            {(field) => (
              <Textarea {...field} name="notes" rows={2} maxLength={SETTLEMENT_NOTES_MAX} />
            )}
          </FormField>

          <div className="flex justify-end">
            <SubmitButton>{`Registrar ${ato}`}</SubmitButton>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
