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
  type ButtonVariant,
} from '@/design-system/components';
import { formatBRL } from '@/core/money/format';
import {
  CANCEL_REASON_MAX,
  CANCEL_REASON_MIN,
  REVERSAL_REASON_MAX,
  REVERSAL_REASON_MIN,
  TITLE_DESCRIPTION_MAX,
  TITLE_NOTES_MAX,
} from '@/modules/finance/domain/finance';
import { EMPTY_FINANCE_STATE, type FinanceActionState } from '../../action-state';

type ActionFn = (previous: FinanceActionState, formData: FormData) => Promise<FinanceActionState>;

export interface CategoryOption {
  id: string;
  name: string;
}

export interface ReversibleSettlement {
  id: string;
  amount: string;
  effectiveDate: string;
  accountName: string;
  methodName: string;
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
 * Edicao do que e editavel (Prompt 12, item 30).
 *
 * O QUE NAO APARECE AQUI E O RECADO: valor, vencimento, parcelas e direcao nao
 * tem campo. Nao e esquecimento — um titulo que ja tem liquidacao registrada e
 * um fato contabil, e mudar o valor dele depois transformaria o extrato numa
 * ficcao. O que se corrige e o texto: descricao, categoria e observacao.
 */
export function TitleEditForm({
  titleId,
  description,
  categoryId,
  notes,
  categories,
  action,
}: {
  titleId: string;
  description: string;
  categoryId: string | null;
  notes: string | null;
  categories: CategoryOption[];
  action: ActionFn;
}) {
  const [state, formAction] = useActionState(action, EMPTY_FINANCE_STATE);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="titleId" value={titleId} />

      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}

      <FormField label="Descricao" required>
        {(field) => (
          <Input
            {...field}
            name="description"
            defaultValue={description}
            maxLength={TITLE_DESCRIPTION_MAX}
          />
        )}
      </FormField>

      <FormField label="Categoria">
        {(field) => (
          <Select {...field} name="categoryId" defaultValue={categoryId ?? ''}>
            <option value="">Sem categoria</option>
            {categories.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </Select>
        )}
      </FormField>

      <FormField label="Observacao">
        {(field) => (
          <Textarea
            {...field}
            name="notes"
            rows={3}
            defaultValue={notes ?? ''}
            maxLength={TITLE_NOTES_MAX}
          />
        )}
      </FormField>

      <div className="flex justify-end">
        <SubmitButton variant="secondary">Salvar</SubmitButton>
      </div>
    </form>
  );
}

/**
 * Estorno de uma liquidacao (Prompt 12, itens 45 a 48).
 *
 * ESTORNAR NAO E APAGAR. A liquidacao original continua no historico com a
 * situacao `Estornada`, e o razao ganha um movimento CONTRARIO — nunca uma
 * linha que some. Quem conferir o extrato de amanha vai ver as duas pernas e
 * entender o que aconteceu; se a linha sumisse, o saldo mudaria sozinho e
 * ninguem conseguiria explicar.
 *
 * O MOTIVO E OBRIGATORIO porque estorno sem motivo e o caminho mais curto para
 * um caixa que ninguem consegue auditar seis meses depois.
 */
export function ReverseSettlementForm({
  titleId,
  settlements,
  action,
}: {
  titleId: string;
  settlements: ReversibleSettlement[];
  action: ActionFn;
}) {
  const [state, formAction] = useActionState(action, EMPTY_FINANCE_STATE);
  const [aberto, setAberto] = useState(false);

  if (settlements.length === 0) return null;

  return (
    <Card>
      <CardHeader
        title="Estornar um lancamento"
        description="Para quando o dinheiro voltou: cheque devolvido, pagamento cancelado ou lancamento feito na conta errada."
        headingLevel={2}
      />
      <CardBody>
        {state.success ? <Alert tone="success">{state.success}</Alert> : null}

        {!aberto ? (
          <Button type="button" variant="secondary" onClick={() => setAberto(true)}>
            Estornar um lancamento
          </Button>
        ) : (
          <form action={formAction} className="space-y-4">
            <input type="hidden" name="titleId" value={titleId} />

            {state.error ? <Alert tone="danger">{state.error}</Alert> : null}

            <Alert tone="warning">
              O lancamento original continua no historico e o razao recebe um movimento contrario.
              Nada e apagado.
            </Alert>

            <FormField label="Lancamento" required>
              {(field) => (
                <Select {...field} name="settlementId">
                  {settlements.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.effectiveDate.split('-').reverse().join('/')}
                      {' — '}
                      {formatBRL(item.amount)}
                      {' — '}
                      {item.accountName}
                      {' / '}
                      {item.methodName}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>

            <FormField
              label="Motivo"
              required
              hint={`Entre ${REVERSAL_REASON_MIN} e ${REVERSAL_REASON_MAX} caracteres. Fica no historico do titulo e na auditoria.`}
            >
              {(field) => (
                <Textarea {...field} name="reason" rows={2} maxLength={REVERSAL_REASON_MAX} />
              )}
            </FormField>

            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setAberto(false)}>
                Cancelar
              </Button>
              <SubmitButton variant="destructive">Confirmar estorno</SubmitButton>
            </div>
          </form>
        )}
      </CardBody>
    </Card>
  );
}

/**
 * Cancelamento do titulo (Prompt 12, item 31).
 *
 * SO ENQUANTO NADA FOI PAGO. O botao nem aparece depois da primeira
 * liquidacao, e o caso de uso recusa de novo no servidor — a tela esconder
 * nao e protecao, e cortesia. Um titulo com dinheiro recebido nao se cancela:
 * estorna-se o recebimento primeiro, e ai sim ele pode ser cancelado.
 */
export function CancelTitleForm({ titleId, action }: { titleId: string; action: ActionFn }) {
  const [state, formAction] = useActionState(action, EMPTY_FINANCE_STATE);
  const [aberto, setAberto] = useState(false);

  return (
    <Card>
      <CardHeader
        title="Cancelar titulo"
        description="Para quando o titulo nao deveria existir: lancado em duplicidade, na unidade errada ou por engano."
        headingLevel={2}
      />
      <CardBody>
        {state.success ? <Alert tone="success">{state.success}</Alert> : null}

        {!aberto ? (
          <Button type="button" variant="secondary" onClick={() => setAberto(true)}>
            Cancelar titulo
          </Button>
        ) : (
          <form action={formAction} className="space-y-4">
            <input type="hidden" name="titleId" value={titleId} />

            {state.error ? <Alert tone="danger">{state.error}</Alert> : null}

            <FormField
              label="Motivo"
              required
              hint={`Entre ${CANCEL_REASON_MIN} e ${CANCEL_REASON_MAX} caracteres. Fica no historico e na auditoria.`}
            >
              {(field) => (
                <Textarea {...field} name="reason" rows={2} maxLength={CANCEL_REASON_MAX} />
              )}
            </FormField>

            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setAberto(false)}>
                Voltar
              </Button>
              <SubmitButton variant="destructive">Confirmar cancelamento</SubmitButton>
            </div>
          </form>
        )}
      </CardBody>
    </Card>
  );
}
