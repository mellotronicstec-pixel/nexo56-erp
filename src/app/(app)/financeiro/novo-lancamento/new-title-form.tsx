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
  MoneyInput,
  Select,
  Textarea,
} from '@/design-system/components';
import {
  INSTALLMENTS_MAX,
  TITLE_DESCRIPTION_MAX,
  TITLE_NOTES_MAX,
  TITLE_PAYEE_MAX,
  type TitleDirection,
} from '@/modules/finance/domain/finance';
import { EMPTY_FINANCE_STATE, type FinanceActionState } from '../action-state';

type ActionFn = (previous: FinanceActionState, formData: FormData) => Promise<FinanceActionState>;

export interface PartyOption {
  id: string;
  name: string;
}

export interface CategoryOption {
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
 * Lancamento manual de titulo (Prompt 12, itens 28, 32 a 37 e 57).
 *
 * O PARCELAMENTO E CALCULADO PELO SERVIDOR, nao aqui. Esta tela pergunta
 * quantas parcelas e qual o primeiro vencimento; quem divide os centavos e o
 * dominio, com a sobra indo para as PRIMEIRAS parcelas — R$ 100 em 3 vezes
 * viram 33,34 + 33,33 + 33,33, que somam exatamente 100. Um calculo de
 * apoio no cliente pareceria util e passaria a divergir do real no primeiro
 * arredondamento diferente.
 *
 * A CONTRAPARTE DEPENDE DA DIRECAO (item 8). Um cliente nao e favorecido de
 * conta a pagar, e um fornecedor nao deve dinheiro para a loja. O formulario
 * mostra o campo certo, e o banco recusa a combinacao errada por CHECK — a
 * tela e conveniencia, a restricao e que e garantia.
 */
export function NewTitleForm({
  direction,
  unitId,
  unitName,
  customers,
  suppliers,
  categories,
  today,
  createTitleAction,
  createExpenseAction,
}: {
  direction: TitleDirection;
  unitId: string;
  unitName: string;
  customers: PartyOption[];
  suppliers: PartyOption[];
  categories: CategoryOption[];
  today: string;
  createTitleAction: ActionFn;
  createExpenseAction: ActionFn;
}) {
  const recebivel = direction === 'receivable';

  const [state, formAction] = useActionState(
    recebivel ? createTitleAction : createExpenseAction,
    EMPTY_FINANCE_STATE,
  );

  /**
   * Em conta a pagar a pessoa escolhe entre fornecedor cadastrado e um nome
   * solto: a conta de luz nao tem fornecedor no cadastro, e obrigar a criar um
   * so para lancar a despesa e o tipo de exigencia que faz o financeiro voltar
   * para a planilha.
   */
  const [favorecidoCadastrado, setFavorecidoCadastrado] = useState(suppliers.length > 0);
  const [parcelas, setParcelas] = useState(1);

  return (
    <Card>
      <CardHeader
        title={recebivel ? 'Nova conta a receber' : 'Nova conta a pagar'}
        description={
          recebivel
            ? 'Uma cobranca avulsa. A cobranca de uma Ordem de Servico nasce na propria OS, com o valor do orcamento aprovado.'
            : 'Uma despesa avulsa. A conta de uma compra nasce no recebimento da mercadoria, nao aqui.'
        }
        headingLevel={2}
      />
      <CardBody>
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="unitId" value={unitId} />
          {recebivel ? <input type="hidden" name="direction" value="receivable" /> : null}

          {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
          {state.success ? <Alert tone="success">{state.success}</Alert> : null}

          <p className="text-small text-ink-500">
            O titulo pertence a unidade <strong className="text-ink-700">{unitName}</strong>.
          </p>

          {recebivel ? (
            <FormField
              label="Cliente"
              required
              hint="Conta a receber e sempre de um cliente: quem deve para a loja."
            >
              {(field) => (
                <Select {...field} name="customerId" defaultValue="">
                  <option value="" disabled>
                    Escolha o cliente
                  </option>
                  {customers.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
          ) : (
            <>
              <fieldset className="space-y-2">
                <legend className="text-ui font-medium text-ink-700">Favorecido</legend>
                <label className="flex items-center gap-2 text-ui text-ink-700">
                  <input
                    type="radio"
                    name="tipoFavorecido"
                    value="fornecedor"
                    checked={favorecidoCadastrado}
                    onChange={() => setFavorecidoCadastrado(true)}
                    className="size-4"
                  />
                  Fornecedor cadastrado
                </label>
                <label className="flex items-center gap-2 text-ui text-ink-700">
                  <input
                    type="radio"
                    name="tipoFavorecido"
                    value="outro"
                    checked={!favorecidoCadastrado}
                    onChange={() => setFavorecidoCadastrado(false)}
                    className="size-4"
                  />
                  Outro (aluguel, energia, imposto)
                </label>
              </fieldset>

              {favorecidoCadastrado ? (
                <FormField label="Fornecedor" required>
                  {(field) => (
                    <Select {...field} name="supplierId" defaultValue="">
                      <option value="" disabled>
                        Escolha o fornecedor
                      </option>
                      {suppliers.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </FormField>
              ) : (
                <FormField
                  label="Nome do favorecido"
                  required
                  hint="Quem recebe o dinheiro. Nao cria cadastro de fornecedor."
                >
                  {(field) => <Input {...field} name="payeeName" maxLength={TITLE_PAYEE_MAX} />}
                </FormField>
              )}
            </>
          )}

          <FormField
            label="Descricao"
            required
            hint="O que e, em palavras que quem ler daqui a seis meses entenda."
          >
            {(field) => <Input {...field} name="description" maxLength={TITLE_DESCRIPTION_MAX} />}
          </FormField>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Valor total" required>
              {(field) => <MoneyInput {...field} name="amount" />}
            </FormField>

            <FormField label="Categoria">
              {(field) => (
                <Select {...field} name="categoryId" defaultValue="">
                  <option value="">Sem categoria</option>
                  {categories.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>

            <FormField
              label="Parcelas"
              required
              hint={
                parcelas > 1
                  ? 'As demais vencem a cada mes. A sobra dos centavos vai para as primeiras parcelas, e a soma bate exatamente com o total.'
                  : 'A vista e 1 parcela.'
              }
            >
              {(field) => (
                <Input
                  {...field}
                  name="installmentCount"
                  type="number"
                  min={1}
                  max={INSTALLMENTS_MAX}
                  value={parcelas}
                  onChange={(event) => setParcelas(Number(event.target.value) || 1)}
                />
              )}
            </FormField>

            <FormField label={parcelas > 1 ? 'Vencimento da 1a parcela' : 'Vencimento'} required>
              {(field) => <Input {...field} name="dueDate" type="date" defaultValue={today} />}
            </FormField>
          </div>

          <FormField label="Observacao">
            {(field) => <Textarea {...field} name="notes" rows={3} maxLength={TITLE_NOTES_MAX} />}
          </FormField>

          <div className="flex justify-end">
            <SubmitButton>{recebivel ? 'Criar cobranca' : 'Registrar despesa'}</SubmitButton>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
