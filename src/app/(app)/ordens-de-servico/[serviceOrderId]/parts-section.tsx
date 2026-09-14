'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  EmptyState,
  FormField,
  Input,
  Modal,
  Select,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Textarea,
} from '@/design-system/components';
import { MOVEMENT_REASON_MAX, reservationStatusLabel } from '@/modules/inventory/domain/inventory';
import { EMPTY_INVENTORY_STATE, type InventoryActionState } from '../../estoque/action-state';

/**
 * Pecas reservadas para a Ordem de Servico (Prompt 10, itens 69, 103 a 105).
 *
 * O QUE ESTA SECAO NAO FAZ: mudar a situacao da OS. Consumir uma peca registra
 * o consumo e some do disponivel — quem decide que o conserto comecou, ou
 * terminou, e quem conserta, pelo painel de situacao logo acima.
 *
 * Tambem NAO ha reserva automatica por causa de orcamento aprovado: reservar e
 * este botao, apertado por uma pessoa (itens 36 a 38).
 */

type ActionFn = (
  previous: InventoryActionState,
  formData: FormData,
) => Promise<InventoryActionState>;

/** Peca oferecida no seletor de reserva. */
export interface PartChoice {
  id: string;
  code: string;
  name: string;
}

export interface ReservationRow {
  id: string;
  partId: string;
  partCode: string;
  partName: string;
  unitOfMeasure: string;
  quantity: string;
  consumedQuantity: string;
  remaining: string;
  status: string;
}

function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending} disabled={pending}>
      {children}
    </Button>
  );
}

function formatQuantity(value: string): string {
  const [whole = '0', fraction = ''] = value.split('.');
  const trimmed = fraction.replace(/0+$/, '');
  return trimmed ? `${whole},${trimmed}` : whole;
}

export function PartsSection({
  serviceOrderId,
  reservations,
  parts,
  canReserve,
  canConsume,
  reserveAction,
  releaseAction,
  consumeAction,
}: {
  serviceOrderId: string;
  reservations: ReservationRow[];
  /** Pecas ativas do catalogo. Vazio = nao ha o que reservar ainda. */
  parts: PartChoice[];
  canReserve: boolean;
  canConsume: boolean;
  reserveAction: ActionFn;
  releaseAction: ActionFn;
  consumeAction: ActionFn;
}) {
  const [reserving, setReserving] = useState(false);
  const [consuming, setConsuming] = useState<ReservationRow | null>(null);
  const [releasing, setReleasing] = useState<ReservationRow | null>(null);
  const [commandKey, setCommandKey] = useState('');

  const [reserveState, reserveFormAction] = useActionState(
    async (previous: InventoryActionState, formData: FormData) => {
      const result = await reserveAction(previous, formData);
      if (!result.error) setReserving(false);
      return result;
    },
    EMPTY_INVENTORY_STATE,
  );

  const [consumeState, consumeFormAction] = useActionState(
    async (previous: InventoryActionState, formData: FormData) => {
      const result = await consumeAction(previous, formData);
      if (!result.error) setConsuming(null);
      return result;
    },
    EMPTY_INVENTORY_STATE,
  );

  const [releaseState, releaseFormAction] = useActionState(
    async (previous: InventoryActionState, formData: FormData) => {
      const result = await releaseAction(previous, formData);
      if (!result.error) setReleasing(null);
      return result;
    },
    EMPTY_INVENTORY_STATE,
  );

  const erro = reserveState.error ?? consumeState.error ?? releaseState.error;
  const sucesso = reserveState.success ?? consumeState.success ?? releaseState.success;

  const openConsume = (reservation: ReservationRow) => {
    setCommandKey(crypto.randomUUID());
    setConsuming(reservation);
  };

  return (
    <Card>
      <CardBody className="space-y-4">
        {erro ? <Alert tone="danger">{erro}</Alert> : null}
        {sucesso ? <Alert tone="success">{sucesso}</Alert> : null}

        {canReserve && parts.length > 0 ? (
          <div>
            <Button type="button" onClick={() => setReserving(true)}>
              Reservar peca
            </Button>
          </div>
        ) : null}

        {canReserve && parts.length === 0 ? (
          <p className="text-ui text-ink-600">
            Nao ha peca ativa no catalogo para reservar. Cadastre a peca em Estoque primeiro.
          </p>
        ) : null}

        {reservations.length === 0 ? (
          <EmptyState
            title="Nenhuma peca reservada"
            description="Reservar compromete a peca com este atendimento sem tira-la da prateleira. Aprovar orcamento nao reserva sozinho."
          />
        ) : (
          <Table caption="Pecas reservadas para esta Ordem de Servico">
            <THead>
              <TR>
                <TH>Peca</TH>
                <TH align="right">Reservado</TH>
                <TH align="right">Consumido</TH>
                <TH align="right">Em aberto</TH>
                <TH>Situacao</TH>
                <TH align="right" srOnly>
                  Acoes
                </TH>
              </TR>
            </THead>
            <TBody>
              {reservations.map((reservation) => (
                <TR key={reservation.id}>
                  <TD className="font-medium text-ink-900">
                    {reservation.partName}
                    <span className="block text-small font-normal text-ink-500">
                      {reservation.partCode}
                    </span>
                  </TD>
                  <TD align="right">{formatQuantity(reservation.quantity)}</TD>
                  <TD align="right">{formatQuantity(reservation.consumedQuantity)}</TD>
                  <TD align="right" className="font-medium text-ink-900">
                    {formatQuantity(reservation.remaining)}
                  </TD>
                  <TD>
                    <Badge tone={reservation.status === 'open' ? 'brand' : 'neutral'}>
                      {reservationStatusLabel(reservation.status)}
                    </Badge>
                  </TD>
                  <TD align="right">
                    {reservation.status === 'open' ? (
                      <div className="flex flex-wrap justify-end gap-2">
                        {canConsume ? (
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() => openConsume(reservation)}
                          >
                            Consumir
                          </Button>
                        ) : null}
                        {canReserve ? (
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => setReleasing(reservation)}
                          >
                            Liberar
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </CardBody>

      <Modal
        open={reserving}
        onClose={() => setReserving(false)}
        title="Reservar peca"
        description="A peca fica comprometida com este atendimento. O saldo fisico nao muda."
      >
        <form action={reserveFormAction} className="space-y-4">
          <input type="hidden" name="serviceOrderId" value={serviceOrderId} />

          <FormField
            id="reserve-part"
            label="Peca"
            required
            hint="So pecas ativas do catalogo. A reserva sai do saldo desta unidade."
          >
            {(props) => (
              <Select {...props} name="partId" required defaultValue="">
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

          <FormField id="reserve-quantity" label="Quantidade" required>
            {(props) => (
              <Input {...props} name="quantity" required inputMode="decimal" autoComplete="off" />
            )}
          </FormField>

          <FormField id="reserve-notes" label="Observacao">
            {(props) => (
              <Textarea {...props} name="notes" rows={2} maxLength={MOVEMENT_REASON_MAX} />
            )}
          </FormField>

          <div className="flex flex-wrap justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setReserving(false)}>
              Voltar
            </Button>
            <SubmitButton>Reservar</SubmitButton>
          </div>
        </form>
      </Modal>

      <Modal
        open={consuming !== null}
        onClose={() => setConsuming(null)}
        title="Consumir peca reservada"
        description="A peca sai do estoque agora. A situacao da Ordem de Servico nao muda."
      >
        {consuming ? (
          <form action={consumeFormAction} className="space-y-4">
            <input type="hidden" name="reservationId" value={consuming.id} />
            <input type="hidden" name="partId" value={consuming.partId} />
            <input type="hidden" name="serviceOrderId" value={serviceOrderId} />
            <input type="hidden" name="idempotencyKey" value={`consumo-${commandKey}`} />

            <p className="text-ui text-ink-700">
              {consuming.partName} — em aberto: {formatQuantity(consuming.remaining)}
            </p>

            <FormField id="consume-quantity" label="Quantidade a consumir" required>
              {(props) => (
                <Input
                  {...props}
                  name="quantity"
                  required
                  inputMode="decimal"
                  autoComplete="off"
                  defaultValue={formatQuantity(consuming.remaining)}
                />
              )}
            </FormField>

            <div className="flex flex-wrap justify-end gap-3">
              <Button type="button" variant="secondary" onClick={() => setConsuming(null)}>
                Voltar
              </Button>
              <SubmitButton>Confirmar consumo</SubmitButton>
            </div>
          </form>
        ) : null}
      </Modal>

      <Modal
        open={releasing !== null}
        onClose={() => setReleasing(null)}
        title="Liberar reserva"
        description="A quantidade volta ao disponivel. Nada sai do estoque."
      >
        {releasing ? (
          <form action={releaseFormAction} className="space-y-4">
            <input type="hidden" name="reservationId" value={releasing.id} />
            <input type="hidden" name="partId" value={releasing.partId} />
            <input type="hidden" name="serviceOrderId" value={serviceOrderId} />

            <p className="text-ui text-ink-700">
              {releasing.partName} — em aberto: {formatQuantity(releasing.remaining)}
            </p>

            <FormField id="release-quantity" label="Quantidade a liberar" required>
              {(props) => (
                <Input
                  {...props}
                  name="quantity"
                  required
                  inputMode="decimal"
                  autoComplete="off"
                  defaultValue={formatQuantity(releasing.remaining)}
                />
              )}
            </FormField>

            <div className="flex flex-wrap justify-end gap-3">
              <Button type="button" variant="secondary" onClick={() => setReleasing(null)}>
                Voltar
              </Button>
              <SubmitButton>Liberar</SubmitButton>
            </div>
          </form>
        ) : null}
      </Modal>
    </Card>
  );
}
