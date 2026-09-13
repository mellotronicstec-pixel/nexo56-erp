'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  FormField,
  Input,
  Modal,
  Select,
  Textarea,
} from '@/design-system/components';
import { REASON_MAX, statusLabel, statusTone } from '@/modules/service-orders/domain/workflow';
import { EMPTY_SERVICE_ORDER_STATE, type ServiceOrderActionState } from '../action-state';

/**
 * Painel de workflow da Ordem de Servico (Prompt 08, itens 78 a 85).
 *
 * MOSTRA SO O QUE E VALIDO AGORA (item 79). As transicoes vem prontas do
 * servidor, ja filtradas por estado, permissao, feature e unidade — este
 * componente nao decide nada, ele desenha o que pode ser feito.
 *
 * Botao desabilitado e mudo ensina a equipe a ignorar a interface; por isso o
 * que nao e possivel simplesmente nao aparece, e o que depende de uma condicao
 * aparece com a condicao escrita (item 80).
 */

type ActionFn = (
  previous: ServiceOrderActionState,
  formData: FormData,
) => Promise<ServiceOrderActionState>;

export interface TransitionOption {
  to: string;
  label: string;
  requiresReason: boolean;
  hint?: string;
}

function SubmitButton({
  children,
  variant = 'primary',
  size,
}: {
  children: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'destructive' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} size={size} loading={pending} disabled={pending}>
      {children}
    </Button>
  );
}

export function WorkflowPanel({
  serviceOrderId,
  status,
  version,
  transitions,
  canCancel,
  transitionAction,
  cancelAction,
}: {
  serviceOrderId: string;
  status: string;
  version: number;
  transitions: TransitionOption[];
  canCancel: TransitionOption | null;
  transitionAction: ActionFn;
  cancelAction: ActionFn;
}) {
  /** Transicao em confirmacao. `null` = nenhum dialogo aberto. */
  const [pendingTransition, setPendingTransition] = useState<TransitionOption | null>(null);
  const [cancelling, setCancelling] = useState(false);

  /**
   * O DIALOGO FECHA SOZINHO QUANDO A ACAO DA CERTO.
   *
   * Sem isto, a pessoa confirma, a situacao muda no servidor, a pagina revalida
   * por baixo — e o dialogo continua aberto na tela, com o mesmo botao
   * "Confirmar" convidando a repetir uma transicao que ja aconteceu. No erro ele
   * permanece aberto de proposito: o aviso aparece logo abaixo, com o que foi
   * digitado ainda no lugar.
   */
  const [state, formAction] = useActionState(
    async (previous: ServiceOrderActionState, formData: FormData) => {
      const result = await transitionAction(previous, formData);
      if (!result.error) setPendingTransition(null);
      return result;
    },
    EMPTY_SERVICE_ORDER_STATE,
  );

  const [cancelState, cancelFormAction] = useActionState(
    async (previous: ServiceOrderActionState, formData: FormData) => {
      const result = await cancelAction(previous, formData);
      if (!result.error) setCancelling(false);
      return result;
    },
    EMPTY_SERVICE_ORDER_STATE,
  );

  return (
    <Card>
      <CardHeader
        title="Situacao"
        description="O que pode ser feito com esta Ordem de Servico agora."
        headingLevel={2}
      />
      <CardBody className="space-y-4">
        {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
        {cancelState.error ? <Alert tone="danger">{cancelState.error}</Alert> : null}

        <div className="flex flex-wrap items-center gap-2">
          {/* Cor NUNCA sozinha: o rotulo em texto acompanha o tom (item 86). */}
          <Badge tone={statusTone(status)}>{statusLabel(status)}</Badge>
        </div>

        {transitions.length === 0 && !canCancel ? (
          <p className="text-ui text-ink-600">
            Esta Ordem de Servico esta encerrada e nao muda mais de situacao.
          </p>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {transitions.map((option) => (
              <Button
                key={option.to}
                type="button"
                variant="primary"
                onClick={() => setPendingTransition(option)}
              >
                {option.label}
              </Button>
            ))}
            {canCancel ? (
              <Button type="button" variant="destructive" onClick={() => setCancelling(true)}>
                {canCancel.label}
              </Button>
            ) : null}
          </div>
        )}
      </CardBody>

      {/*
        CONFIRMACAO EXPLICITA (itens 83 e 84): no celular um `select` solto
        muda a situacao com um toque errado. O dialogo diz o que vai acontecer
        e exige uma segunda acao.
      */}
      <Modal
        open={pendingTransition !== null}
        onClose={() => setPendingTransition(null)}
        title={pendingTransition?.label ?? ''}
        description={pendingTransition?.hint}
      >
        {pendingTransition ? (
          <form action={formAction} className="space-y-4">
            <input type="hidden" name="serviceOrderId" value={serviceOrderId} />
            <input type="hidden" name="to" value={pendingTransition.to} />
            {/* A versao lida vai junto: quem perder a corrida recebe aviso. */}
            <input type="hidden" name="expectedVersion" value={version} />

            <p className="text-ui text-ink-700">
              A situacao passa de <strong>{statusLabel(status)}</strong> para{' '}
              <strong>{statusLabel(pendingTransition.to)}</strong>.
            </p>

            {pendingTransition.requiresReason ? (
              <FormField id="transition-reason" label="Motivo" required>
                {(props) => (
                  <Textarea {...props} name="reason" rows={3} required maxLength={REASON_MAX} />
                )}
              </FormField>
            ) : null}

            <div className="flex flex-wrap justify-end gap-3">
              <Button type="button" variant="secondary" onClick={() => setPendingTransition(null)}>
                Voltar
              </Button>
              <SubmitButton>Confirmar</SubmitButton>
            </div>
          </form>
        ) : null}
      </Modal>

      <Modal
        open={cancelling}
        onClose={() => setCancelling(false)}
        title="Cancelar Ordem de Servico"
        description="A ordem e encerrada sem conclusao. Nao e possivel desfazer."
      >
        <form action={cancelFormAction} className="space-y-4">
          <input type="hidden" name="serviceOrderId" value={serviceOrderId} />
          <input type="hidden" name="expectedVersion" value={version} />

          <FormField
            id="cancel-reason"
            label="Motivo do cancelamento"
            required
            hint="Fica registrado no historico e na trilha de auditoria."
          >
            {(props) => (
              <Textarea {...props} name="reason" rows={3} required maxLength={REASON_MAX} />
            )}
          </FormField>

          <div className="flex flex-wrap justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setCancelling(false)}>
              Voltar
            </Button>
            <SubmitButton variant="destructive">Cancelar a Ordem</SubmitButton>
          </div>
        </form>
      </Modal>
    </Card>
  );
}

/** Atribuicao de tecnico responsavel (itens 26 a 29). */
export function TechnicianPanel({
  serviceOrderId,
  technicianId,
  members,
  action,
}: {
  serviceOrderId: string;
  technicianId: string | null;
  members: { id: string; name: string }[];
  action: ActionFn;
}) {
  const [state, formAction] = useActionState(action, EMPTY_SERVICE_ORDER_STATE);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="serviceOrderId" value={serviceOrderId} />
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}

      <FormField
        id="technician"
        label="Tecnico responsavel"
        hint="Aparecem as pessoas ativas com acesso a unidade desta ordem."
      >
        {(props) => (
          <Select {...props} name="technicianId" defaultValue={technicianId ?? ''}>
            <option value="">Sem responsavel definido</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </Select>
        )}
      </FormField>

      {/*
        Sem `size="sm"`: no celular estas sao acoes principais, e o projeto
        exige 40px de altura para elas — o minimo de 24px da WCAG 2.2 e o piso,
        nao a meta. Apanhado pela regressao do Prompt 07.
      */}
      <SubmitButton variant="secondary">Salvar responsavel</SubmitButton>
    </form>
  );
}

/** Reagendamento do acompanhamento (itens 39 e 122). */
export function FollowUpPanel({
  serviceOrderId,
  followUpAt,
  action,
}: {
  serviceOrderId: string;
  followUpAt: string | null;
  action: ActionFn;
}) {
  const [state, formAction] = useActionState(action, EMPTY_SERVICE_ORDER_STATE);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="serviceOrderId" value={serviceOrderId} />
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}

      <FormField
        id="follow-up"
        label="Proximo acompanhamento"
        hint="Deixe em branco para tirar esta ordem da lista de pendencias."
      >
        {(props) => (
          <Input {...props} type="date" name="followUpAt" defaultValue={followUpAt ?? ''} />
        )}
      </FormField>

      <SubmitButton variant="secondary">Salvar prazo</SubmitButton>
    </form>
  );
}

/** Acao "Buscar Peca" — cria tarefa, NAO muda a situacao (itens 13 e 16). */
export function PartPickupPanel({
  serviceOrderId,
  action,
}: {
  serviceOrderId: string;
  action: ActionFn;
}) {
  const [state, formAction] = useActionState(action, EMPTY_SERVICE_ORDER_STATE);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="serviceOrderId" value={serviceOrderId} />
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}

      <FormField
        id="part-note"
        label="Qual peca e onde buscar"
        hint="Texto livre. O catalogo de fornecedores e locais chega com Estoque e Compras."
      >
        {(props) => <Textarea {...props} name="note" rows={2} maxLength={REASON_MAX} />}
      </FormField>

      <SubmitButton variant="secondary">Registrar busca de peca</SubmitButton>
    </form>
  );
}

/** Acao "Informar Ordem Disponivel" (itens 14, 17, 62 a 64). */
export function NotifyCustomerPanel({
  serviceOrderId,
  version,
  ready,
  action,
}: {
  serviceOrderId: string;
  version: number;
  /** `false` enquanto a preparacao nao estiver concluida. */
  ready: boolean;
  action: ActionFn;
}) {
  const [state, formAction] = useActionState(action, EMPTY_SERVICE_ORDER_STATE);

  if (!ready) {
    /** POR QUE NAO POSSO (item 80): a condicao em texto, no lugar do botao. */
    return (
      <Alert tone="info" title="Informar Ordem Disponivel">
        Conclua a preparacao para entrega antes de informar o cliente.
      </Alert>
    );
  }

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="serviceOrderId" value={serviceOrderId} />
      <input type="hidden" name="expectedVersion" value={version} />
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}

      {/*
        TEXTO VERDADEIRO (item 64). Nao ha WhatsApp nem e-mail integrado; dizer
        "mensagem enviada" faria o atendente parar de ligar para o cliente.
      */}
      <p className="text-small text-ink-600">
        Registra que o cliente foi avisado e leva a ordem para Aguardando Cliente Retirar. O envio
        automatico da mensagem ainda nao esta disponivel — avise o cliente pelo canal de sempre.
      </p>

      <SubmitButton>Informar Ordem Disponivel</SubmitButton>
    </form>
  );
}

/** Conclusao de uma tarefa do fluxo (itens 121 e 131). */
export function CompleteTaskButton({ taskId, action }: { taskId: string; action: ActionFn }) {
  const [state, formAction] = useActionState(action, EMPTY_SERVICE_ORDER_STATE);

  return (
    <form action={formAction} className="mt-2">
      <input type="hidden" name="taskId" value={taskId} />
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      <SubmitButton variant="secondary">Concluir tarefa</SubmitButton>
    </form>
  );
}
