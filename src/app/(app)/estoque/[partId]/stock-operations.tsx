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
  Modal,
  MoneyInput,
  Select,
  Textarea,
} from '@/design-system/components';
import {
  ADJUSTMENT_REASON_MIN,
  MOVEMENT_REASON_MAX,
  MOVEMENT_REFERENCE_MAX,
} from '@/modules/inventory/domain/inventory';
import { EMPTY_INVENTORY_STATE, type InventoryActionState } from '../action-state';

/**
 * Operacoes de estoque da peca na unidade ativa (Prompt 10, itens 101 a 107).
 *
 * CADA ACAO E UM DIALOGO COM CONFIRMACAO, e nao um campo solto na tela: no
 * celular um `input` de quantidade ao lado do saldo vira baixa acidental com
 * um toque errado.
 *
 * O QUE A PESSOA NAO PODE FAZER NAO APARECE. Botao desabilitado e mudo ensina
 * a equipe a ignorar a interface; o servidor recusa de qualquer forma, entao a
 * tela so mostra o que existe de verdade para aquela permissao.
 */

type ActionFn = (
  previous: InventoryActionState,
  formData: FormData,
) => Promise<InventoryActionState>;

export interface UnitOption {
  id: string;
  name: string;
}

export interface LocationOption {
  id: string;
  name: string;
}

type Operation = 'receive' | 'issue' | 'adjust' | 'transfer' | 'minimum';

const TITLES: Record<Operation, string> = {
  receive: 'Registrar entrada',
  issue: 'Registrar saida',
  adjust: 'Ajustar saldo',
  transfer: 'Transferir para outra unidade',
  minimum: 'Estoque minimo desta unidade',
};

const DESCRIPTIONS: Record<Operation, string> = {
  receive: 'A peca entrou fisicamente nesta unidade.',
  issue: 'A peca saiu fisicamente desta unidade. Nao muda a situacao da Ordem de Servico.',
  adjust: 'Corrige o saldo quando nada entrou nem saiu pela porta. Exige motivo.',
  transfer: 'Retira da unidade de origem e adiciona a de destino, na mesma operacao.',
  minimum: 'Abaixo deste disponivel, a peca aparece marcada na listagem. Zero desliga o aviso.',
};

function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending} disabled={pending}>
      {children}
    </Button>
  );
}

/**
 * Seletor de localizacao. Some quando a unidade nao tem prateleira cadastrada:
 * um `select` com uma opcao so ("nao informar") e ruido.
 */
function LocationField({
  name,
  label,
  locations,
}: {
  name: string;
  label: string;
  locations: LocationOption[];
}) {
  if (locations.length === 0) return null;

  return (
    <FormField id={`op-${name}`} label={label}>
      {(props) => (
        <Select {...props} name={name} defaultValue="">
          <option value="">Nao informar</option>
          {locations.map((location) => (
            <option key={location.id} value={location.id}>
              {location.name}
            </option>
          ))}
        </Select>
      )}
    </FormField>
  );
}

export function StockOperations({
  partId,
  unitId,
  unitName,
  unitOfMeasureLabel,
  minimumQuantity,
  locations,
  transferTargets,
  can,
  actions,
}: {
  partId: string;
  unitId: string;
  unitName: string;
  unitOfMeasureLabel: string;
  minimumQuantity: string;
  locations: LocationOption[];
  transferTargets: UnitOption[];
  can: {
    receive: boolean;
    issue: boolean;
    adjust: boolean;
    transfer: boolean;
    minimum: boolean;
  };
  actions: {
    receive: ActionFn;
    issue: ActionFn;
    adjust: ActionFn;
    transfer: ActionFn;
    minimum: ActionFn;
  };
}) {
  const [operation, setOperation] = useState<Operation | null>(null);

  /**
   * CHAVE DE COMANDO, UMA POR LANCAMENTO (itens 119 e 120).
   *
   * E o que faz o duplo clique — e o retry depois de uma queda de rede — nao
   * lancar a mesma entrada duas vezes: a segunda chegada com a mesma chave
   * reencontra o movimento em vez de criar outro.
   *
   * Ela nasce no CLIENTE, no clique que ABRE o dialogo — nunca durante a
   * renderizacao, que precisa ser pura. Abrir de novo produz outra chave, e e
   * isso que separa "a segunda entrada legitima do dia" de "o mesmo comando
   * reenviado": a primeira comeca com um clique novo, a segunda nao.
   */
  const [commandKey, setCommandKey] = useState('');

  /** Abrir o dialogo e o evento que produz a chave. */
  const open = (next: Operation) => {
    setCommandKey(crypto.randomUUID());
    setOperation(next);
  };

  const close = () => setOperation(null);

  function useOperationState(action: ActionFn) {
    return useActionState(async (previous: InventoryActionState, formData: FormData) => {
      const result = await action(previous, formData);
      if (!result.error) setOperation(null);
      return result;
    }, EMPTY_INVENTORY_STATE);
  }

  const [receiveState, receiveAction] = useOperationState(actions.receive);
  const [issueState, issueAction] = useOperationState(actions.issue);
  const [adjustState, adjustAction] = useOperationState(actions.adjust);
  const [transferState, transferAction] = useOperationState(actions.transfer);
  const [minimumState, minimumAction] = useOperationState(actions.minimum);

  const erro =
    receiveState.error ??
    issueState.error ??
    adjustState.error ??
    transferState.error ??
    minimumState.error;

  const sucesso =
    receiveState.success ??
    issueState.success ??
    adjustState.success ??
    transferState.success ??
    minimumState.success;

  return (
    <Card>
      <CardHeader
        title="Movimentar"
        description={`Operacoes desta peca na unidade ${unitName}.`}
        headingLevel={2}
      />
      <CardBody className="space-y-4">
        {erro ? <Alert tone="danger">{erro}</Alert> : null}
        {sucesso ? <Alert tone="success">{sucesso}</Alert> : null}

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {can.receive ? (
            <Button type="button" onClick={() => open('receive')}>
              Entrada
            </Button>
          ) : null}
          {can.issue ? (
            <Button type="button" variant="secondary" onClick={() => open('issue')}>
              Saida
            </Button>
          ) : null}
          {can.transfer && transferTargets.length > 0 ? (
            <Button type="button" variant="secondary" onClick={() => open('transfer')}>
              Transferir
            </Button>
          ) : null}
          {can.minimum ? (
            <Button type="button" variant="ghost" onClick={() => open('minimum')}>
              Estoque minimo
            </Button>
          ) : null}
          {can.adjust ? (
            <Button type="button" variant="destructive" onClick={() => open('adjust')}>
              Ajustar saldo
            </Button>
          ) : null}
        </div>

        {!can.receive && !can.issue && !can.adjust && !can.transfer ? (
          <p className="text-ui text-ink-600">
            Voce pode consultar o estoque desta unidade, mas nao movimenta-lo.
          </p>
        ) : null}
      </CardBody>

      {/* --- Entrada (item 101) --------------------------------------------- */}
      <Modal
        open={operation === 'receive'}
        onClose={close}
        title={TITLES.receive}
        description={DESCRIPTIONS.receive}
      >
        <form action={receiveAction} className="space-y-4">
          <input type="hidden" name="partId" value={partId} />
          <input type="hidden" name="unitId" value={unitId} />
          <input type="hidden" name="idempotencyKey" value={`entrada-${commandKey}`} />

          <FormField id="receive-quantity" label={`Quantidade (${unitOfMeasureLabel})`} required>
            {(props) => (
              <Input {...props} name="quantity" required inputMode="decimal" autoComplete="off" />
            )}
          </FormField>

          <LocationField name="locationId" label="Localizacao" locations={locations} />

          <FormField
            id="receive-cost"
            label="Custo unitario"
            hint="Opcional. Alimenta o custo medio."
          >
            {(props) => <MoneyInput {...props} name="unitCost" />}
          </FormField>

          <FormField
            id="receive-reference"
            label="Referencia"
            hint="Nota, fornecedor ou quem trouxe. Texto livre."
          >
            {(props) => <Input {...props} name="reference" maxLength={MOVEMENT_REFERENCE_MAX} />}
          </FormField>

          <div className="flex flex-wrap justify-end gap-3">
            <Button type="button" variant="secondary" onClick={close}>
              Voltar
            </Button>
            <SubmitButton>Registrar entrada</SubmitButton>
          </div>
        </form>
      </Modal>

      {/* --- Saida (item 102) ----------------------------------------------- */}
      <Modal
        open={operation === 'issue'}
        onClose={close}
        title={TITLES.issue}
        description={DESCRIPTIONS.issue}
      >
        <form action={issueAction} className="space-y-4">
          <input type="hidden" name="partId" value={partId} />
          <input type="hidden" name="unitId" value={unitId} />
          <input type="hidden" name="idempotencyKey" value={`saida-${commandKey}`} />

          <FormField id="issue-quantity" label={`Quantidade (${unitOfMeasureLabel})`} required>
            {(props) => (
              <Input {...props} name="quantity" required inputMode="decimal" autoComplete="off" />
            )}
          </FormField>

          <LocationField name="locationId" label="Localizacao" locations={locations} />

          <FormField
            id="issue-order"
            label="Ordem de Servico"
            hint="Opcional. Precisa ser da mesma unidade do estoque."
          >
            {(props) => <Input {...props} name="serviceOrderId" autoComplete="off" />}
          </FormField>

          <FormField id="issue-reference" label="Referencia">
            {(props) => <Input {...props} name="reference" maxLength={MOVEMENT_REFERENCE_MAX} />}
          </FormField>

          <div className="flex flex-wrap justify-end gap-3">
            <Button type="button" variant="secondary" onClick={close}>
              Voltar
            </Button>
            <SubmitButton>Registrar saida</SubmitButton>
          </div>
        </form>
      </Modal>

      {/* --- Ajuste (item 107): acao sensivel, motivo obrigatorio ------------ */}
      <Modal
        open={operation === 'adjust'}
        onClose={close}
        title={TITLES.adjust}
        description={DESCRIPTIONS.adjust}
      >
        <form action={adjustAction} className="space-y-4">
          <input type="hidden" name="partId" value={partId} />
          <input type="hidden" name="unitId" value={unitId} />

          <Alert tone="warning">
            O ajuste reescreve o saldo sem que nada tenha entrado ou saido. Fica registrado na
            auditoria com o seu nome e com o motivo informado.
          </Alert>

          <FormField id="adjust-direction" label="Sentido" required>
            {(props) => (
              <Select {...props} name="direction" defaultValue="in">
                <option value="in">Acrescentar ao saldo</option>
                <option value="out">Retirar do saldo</option>
              </Select>
            )}
          </FormField>

          <FormField id="adjust-quantity" label={`Quantidade (${unitOfMeasureLabel})`} required>
            {(props) => (
              <Input {...props} name="quantity" required inputMode="decimal" autoComplete="off" />
            )}
          </FormField>

          <LocationField name="locationId" label="Localizacao" locations={locations} />

          <FormField id="adjust-reason" label="Motivo" required>
            {(props) => (
              <Textarea
                {...props}
                name="reason"
                rows={3}
                required
                minLength={ADJUSTMENT_REASON_MIN}
                maxLength={MOVEMENT_REASON_MAX}
                placeholder="Contagem fisica, peca quebrada na bancada, erro de lancamento..."
              />
            )}
          </FormField>

          <div className="flex flex-wrap justify-end gap-3">
            <Button type="button" variant="secondary" onClick={close}>
              Voltar
            </Button>
            <SubmitButton>Confirmar ajuste</SubmitButton>
          </div>
        </form>
      </Modal>

      {/* --- Transferencia (item 106) ---------------------------------------- */}
      <Modal
        open={operation === 'transfer'}
        onClose={close}
        title={TITLES.transfer}
        description={DESCRIPTIONS.transfer}
      >
        <form action={transferAction} className="space-y-4">
          <input type="hidden" name="partId" value={partId} />
          <input type="hidden" name="fromUnitId" value={unitId} />
          <input type="hidden" name="idempotencyKey" value={`transferencia-${commandKey}`} />

          <p className="text-ui text-ink-700">
            Origem: <strong>{unitName}</strong>
          </p>

          <FormField id="transfer-to" label="Unidade de destino" required>
            {(props) => (
              <Select {...props} name="toUnitId" required defaultValue="">
                <option value="" disabled>
                  Escolha a unidade
                </option>
                {transferTargets.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.name}
                  </option>
                ))}
              </Select>
            )}
          </FormField>

          <FormField id="transfer-quantity" label={`Quantidade (${unitOfMeasureLabel})`} required>
            {(props) => (
              <Input {...props} name="quantity" required inputMode="decimal" autoComplete="off" />
            )}
          </FormField>

          <LocationField
            name="fromLocationId"
            label="Localizacao de origem"
            locations={locations}
          />

          <FormField id="transfer-notes" label="Observacao">
            {(props) => (
              <Textarea {...props} name="notes" rows={2} maxLength={MOVEMENT_REASON_MAX} />
            )}
          </FormField>

          <p className="text-small text-ink-600">
            A transferencia e imediata: o saldo sai daqui e entra la na mesma operacao. O sistema
            nao acompanha o transporte.
          </p>

          <div className="flex flex-wrap justify-end gap-3">
            <Button type="button" variant="secondary" onClick={close}>
              Voltar
            </Button>
            <SubmitButton>Transferir</SubmitButton>
          </div>
        </form>
      </Modal>

      {/* --- Estoque minimo (item 59) ---------------------------------------- */}
      <Modal
        open={operation === 'minimum'}
        onClose={close}
        title={TITLES.minimum}
        description={DESCRIPTIONS.minimum}
      >
        <form action={minimumAction} className="space-y-4">
          <input type="hidden" name="partId" value={partId} />
          <input type="hidden" name="unitId" value={unitId} />

          <FormField
            id="minimum-quantity"
            label={`Estoque minimo (${unitOfMeasureLabel})`}
            hint="Zero significa nao acompanhar esta peca nesta unidade."
          >
            {(props) => (
              <Input
                {...props}
                name="minimumQuantity"
                inputMode="decimal"
                autoComplete="off"
                defaultValue={minimumQuantity}
              />
            )}
          </FormField>

          <div className="flex flex-wrap justify-end gap-3">
            <Button type="button" variant="secondary" onClick={close}>
              Voltar
            </Button>
            <SubmitButton>Salvar minimo</SubmitButton>
          </div>
        </form>
      </Modal>
    </Card>
  );
}
