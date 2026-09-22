'use client';

import { useActionState, useId, useState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  Alert,
  Button,
  Card,
  CardBody,
  FormField,
  Input,
  Select,
  Textarea,
  type ButtonVariant,
} from '@/design-system/components';
import {
  CANCEL_REASON_MAX,
  CANCEL_REASON_MIN,
  TASK_NOTES_MAX,
  TASK_PRIORITIES,
  TASK_PRIORITY_LABEL,
  TASK_TITLE_MAX,
} from '@/modules/agenda/domain/agenda';
import type { UnitMember } from '@/modules/users/application/user-queries';
import { EMPTY_AGENDA_STATE, type AgendaActionState } from './action-state';
import {
  assignTaskAction,
  cancelAppointmentAction,
  cancelTaskAction,
  completeAgendaItemAction,
  completeTaskAction,
  createAppointmentAction,
  createTaskAction,
  updateAppointmentAction,
  updateTaskAction,
} from './actions';

type ActionFn = (previous: AgendaActionState, formData: FormData) => Promise<AgendaActionState>;

function SubmitButton({
  children,
  variant = 'primary',
  size,
}: {
  children: React.ReactNode;
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
}) {
  const { pending } = useFormStatus();

  /*
    O BOTAO `sm` TEM 32px, e 32px nao e alvo de toque (item 122). Ele e `sm`
    porque mora dentro de uma linha de lista, onde um botao `md` empurraria o
    texto; entao a altura visual continua pequena e a AREA cresce para 44px.
  */
  return (
    <Button
      type="submit"
      variant={variant}
      size={size}
      className={size === 'sm' ? 'touch-target' : undefined}
      loading={pending}
      disabled={pending}
    >
      {children}
    </Button>
  );
}

/**
 * Chave de intencao gerada NO CLIENTE, uma por montagem do formulario.
 *
 * E o que transforma "cliquei duas vezes" em "uma coisa so aconteceu": o mesmo
 * formulario reenviado carrega a mesma chave, e o caso de uso reencontra o que
 * ja criou (itens 40 e 41). Recarregar a pagina gera chave nova de proposito —
 * ai a pessoa realmente quis criar outra.
 *
 * A chave NAO AUTORIZA nada: ela so identifica a intencao.
 */
function useCommandKey(): string {
  const [key] = useState(() => globalThis.crypto.randomUUID());
  return key;
}

function Feedback({ state }: { state: AgendaActionState }) {
  return (
    <div aria-live="polite">
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Nova tarefa
// ---------------------------------------------------------------------------

export interface NewTaskFormProps {
  unitId: string;
  members: UnitMember[];
  currentUserId: string;
  /** Preenchido quando a tarefa nasce a partir de uma Ordem de Servico. */
  serviceOrderId?: string;
  today: string;
}

/**
 * Criar tarefa (itens 108 e 110).
 *
 * O FORMULARIO NAO DECIDE NADA. Ele nao escolhe a unidade — manda a que esta
 * na tela e o backend confere contra as unidades autorizadas; nao valida se o
 * responsavel pode receber; nao verifica se a OS e desta empresa. Tudo isso o
 * caso de uso recalcula (itens 32, 43 e 44).
 */
export function NewTaskForm({
  unitId,
  members,
  currentUserId,
  serviceOrderId,
  today,
}: NewTaskFormProps) {
  const [state, action] = useActionState<AgendaActionState, FormData>(
    createTaskAction as ActionFn,
    EMPTY_AGENDA_STATE,
  );
  const commandKey = useCommandKey();
  const tituloId = useId();

  return (
    <Card>
      <CardBody>
        <form action={action} className="space-y-4">
          <input type="hidden" name="commandKey" value={commandKey} />
          <input type="hidden" name="unitId" value={unitId} />
          {serviceOrderId ? (
            <input type="hidden" name="serviceOrderId" value={serviceOrderId} />
          ) : null}

          <FormField id={tituloId} label="O que precisa ser feito" required>
            {(field) => (
              <Input
                {...field}
                name="title"
                maxLength={TASK_TITLE_MAX}
                required
                placeholder="Ligar para o cliente da OS 128"
              />
            )}
          </FormField>

          {/*
            Grade de uma coluna no celular. `min-w-0` em cada item porque item
            de grid tem `min-width: auto` por padrao e um campo largo empurra a
            pagina inteira na horizontal.
          */}
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="min-w-0">
              <FormField label="Prazo">
                {(field) => <Input {...field} type="date" name="dueDate" defaultValue={today} />}
              </FormField>
            </div>
            <div className="min-w-0">
              <FormField label="Prioridade">
                {(field) => (
                  <Select {...field} name="priority" defaultValue="normal">
                    {TASK_PRIORITIES.map((priority) => (
                      <option key={priority} value={priority}>
                        {TASK_PRIORITY_LABEL[priority]}
                      </option>
                    ))}
                  </Select>
                )}
              </FormField>
            </div>
            <div className="min-w-0">
              <FormField label="Responsavel">
                {(field) => (
                  <Select {...field} name="assigneeId" defaultValue={currentUserId}>
                    <option value="">Sem responsavel</option>
                    {members.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name}
                      </option>
                    ))}
                  </Select>
                )}
              </FormField>
            </div>
          </div>

          <FormField label="Observacoes">
            {(field) => <Textarea {...field} name="notes" rows={2} maxLength={TASK_NOTES_MAX} />}
          </FormField>

          <Feedback state={state} />

          <div className="flex justify-end">
            <SubmitButton>Criar tarefa</SubmitButton>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Novo compromisso
// ---------------------------------------------------------------------------

export interface NewAppointmentFormProps {
  unitId: string;
  members: UnitMember[];
  today: string;
}

/**
 * Criar compromisso (itens 45 a 49).
 *
 * HORARIO OU DIA INTEIRO, nunca os dois. O seletor troca os campos visiveis em
 * vez de oferecer os quatro ao mesmo tempo: quatro campos opcionais deixariam
 * "dia inteiro das 14h" representavel na tela, e o que e representavel acaba
 * enviado.
 */
export function NewAppointmentForm({ unitId, members, today }: NewAppointmentFormProps) {
  const [state, action] = useActionState<AgendaActionState, FormData>(
    createAppointmentAction as ActionFn,
    EMPTY_AGENDA_STATE,
  );
  const commandKey = useCommandKey();
  const [diaInteiro, setDiaInteiro] = useState(false);
  const [inicio, setInicio] = useState(`${today}T09:00`);
  const [fim, setFim] = useState(`${today}T10:00`);
  const tituloId = useId();

  return (
    <Card>
      <CardBody>
        <form action={action} className="space-y-4">
          <input type="hidden" name="commandKey" value={commandKey} />
          <input type="hidden" name="unitId" value={unitId} />
          <input type="hidden" name="allDay" value={diaInteiro ? 'true' : 'false'} />

          <FormField id={tituloId} label="Compromisso" required>
            {(field) => (
              <Input
                {...field}
                name="title"
                maxLength={160}
                required
                placeholder="Visita tecnica no cliente"
              />
            )}
          </FormField>

          <FormField label="Tipo">
            {(field) => (
              <Select
                {...field}
                name="kind"
                value={diaInteiro ? 'all-day' : 'timed'}
                onChange={(event) => setDiaInteiro(event.target.value === 'all-day')}
              >
                <option value="timed">Com horario</option>
                <option value="all-day">Dia inteiro</option>
              </Select>
            )}
          </FormField>

          {diaInteiro ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="min-w-0">
                <FormField label="Primeiro dia" required>
                  {(field) => (
                    <Input {...field} type="date" name="startDate" defaultValue={today} required />
                  )}
                </FormField>
              </div>
              <div className="min-w-0">
                <FormField label="Ultimo dia">
                  {(field) => <Input {...field} type="date" name="endDate" defaultValue={today} />}
                </FormField>
              </div>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {/*
                O QUE TRAFEGA E HORARIO CIVIL, nao instante. "14h" significa
                quatorze horas NA LOJA; quem sabe o fuso da unidade e o
                servidor, e e la que a conversao acontece (ADR-076). Converter
                aqui faria o navegador de quem digitou virar a autoridade
                temporal do dominio.
              */}
              <div className="min-w-0">
                <FormField label="Inicio" required>
                  {(field) => (
                    <Input
                      {...field}
                      type="datetime-local"
                      name="startAtLocal"
                      value={inicio}
                      onChange={(event) => setInicio(event.target.value)}
                      required
                    />
                  )}
                </FormField>
              </div>
              <div className="min-w-0">
                <FormField label="Fim" required>
                  {(field) => (
                    <Input
                      {...field}
                      type="datetime-local"
                      name="endAtLocal"
                      value={fim}
                      onChange={(event) => setFim(event.target.value)}
                      required
                    />
                  )}
                </FormField>
              </div>
            </div>
          )}

          <FormField label="Responsavel">
            {(field) => (
              <Select {...field} name="assigneeId" defaultValue="">
                <option value="">Sem responsavel</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </Select>
            )}
          </FormField>

          <FormField label="Observacoes">
            {(field) => <Textarea {...field} name="notes" rows={2} maxLength={2000} />}
          </FormField>

          <Feedback state={state} />

          <div className="flex justify-end">
            <SubmitButton>Criar compromisso</SubmitButton>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Acoes em linha
// ---------------------------------------------------------------------------

/**
 * Concluir um item da AGENDA, seja qual for a origem.
 *
 * A pessoa nao precisa saber de que tabela o item veio; o tipo viaja no
 * formulario e o despacho acontece no servidor. Para tarefa de fluxo da OS, o
 * servidor DELEGA ao Prompt 08 (ADR-073) — esta tela nao sabe nem precisa
 * saber como aquela conclusao funciona.
 */
export function CompleteAgendaItemButton({
  itemType,
  itemId,
  label = 'Concluir',
}: {
  itemType: string;
  itemId: string;
  label?: string;
}) {
  const [state, action] = useActionState<AgendaActionState, FormData>(
    completeAgendaItemAction as ActionFn,
    EMPTY_AGENDA_STATE,
  );

  return (
    <form action={action} className="inline-flex flex-col gap-1">
      <input type="hidden" name="itemType" value={itemType} />
      <input type="hidden" name="itemId" value={itemId} />
      <SubmitButton variant="secondary" size="sm">
        {label}
      </SubmitButton>
      {state.error ? (
        <span role="alert" className="text-small text-danger-700">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}

/**
 * Concluir, atribuir e cancelar uma tarefa da Agenda (itens 111 a 114).
 *
 * CANCELAR PEDE MOTIVO e vive atras de um clique a mais, de proposito.
 * Concluir registra trabalho feito; cancelar faz trabalho sumir da fila, e a
 * semana seguinte precisa poder perguntar por que. O campo so aparece quando a
 * pessoa escolhe cancelar — oferecer os dois botoes lado a lado convida ao
 * clique errado no celular.
 *
 * A VERSAO VIAJA no formulario: se outra pessoa mexeu na tarefa enquanto esta
 * tela estava aberta, a gravacao e recusada em vez de sobrescrever (ADR-044).
 */
export function TaskActions({
  taskId,
  version,
  status,
  assigneeId,
  members,
  canManage,
}: {
  taskId: string;
  version: number;
  status: string;
  assigneeId: string | null;
  members: UnitMember[];
  canManage: boolean;
}) {
  const [cancelando, setCancelando] = useState(false);

  const [conclusao, concluir] = useActionState<AgendaActionState, FormData>(
    completeTaskAction as ActionFn,
    EMPTY_AGENDA_STATE,
  );
  const [cancelamento, cancelar] = useActionState<AgendaActionState, FormData>(
    cancelTaskAction as ActionFn,
    EMPTY_AGENDA_STATE,
  );
  const [atribuicao, atribuir] = useActionState<AgendaActionState, FormData>(
    assignTaskAction as ActionFn,
    EMPTY_AGENDA_STATE,
  );

  if (status !== 'open') {
    return (
      <span className="text-small text-ink-500">
        {status === 'done' ? 'Concluida' : 'Cancelada'}
      </span>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <form action={concluir}>
          <input type="hidden" name="taskId" value={taskId} />
          <input type="hidden" name="expectedVersion" value={version} />
          <SubmitButton variant="secondary" size="sm">
            Concluir
          </SubmitButton>
        </form>

        <form action={atribuir} className="flex items-center gap-2">
          <input type="hidden" name="taskId" value={taskId} />
          <input type="hidden" name="expectedVersion" value={version} />
          <label className="sr-only" htmlFor={`assignee-${taskId}`}>
            Responsavel pela tarefa
          </label>
          <Select
            id={`assignee-${taskId}`}
            name="assigneeId"
            defaultValue={assigneeId ?? ''}
            className="min-w-0"
          >
            <option value="">Sem responsavel</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </Select>
          <SubmitButton variant="ghost" size="sm">
            Atribuir
          </SubmitButton>
        </form>

        {canManage && !cancelando ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="touch-target"
            onClick={() => setCancelando(true)}
          >
            Cancelar tarefa
          </Button>
        ) : null}
      </div>

      {canManage && cancelando ? (
        <form action={cancelar} className="space-y-2">
          <input type="hidden" name="taskId" value={taskId} />
          <input type="hidden" name="expectedVersion" value={version} />
          <FormField label="Por que esta tarefa foi cancelada" required>
            {(field) => (
              <Textarea
                {...field}
                name="reason"
                rows={2}
                required
                minLength={CANCEL_REASON_MIN}
                maxLength={CANCEL_REASON_MAX}
              />
            )}
          </FormField>
          <div className="flex flex-wrap gap-2">
            <SubmitButton variant="destructive" size="sm">
              Confirmar cancelamento
            </SubmitButton>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="touch-target"
              onClick={() => setCancelando(false)}
            >
              Voltar
            </Button>
          </div>
        </form>
      ) : null}

      <Feedback state={conclusao} />
      <Feedback state={cancelamento} />
      <Feedback state={atribuicao} />
    </div>
  );
}

/** Editar titulo, prazo e prioridade de uma tarefa aberta (item 38). */
export function EditTaskForm({
  taskId,
  version,
  title,
  notes,
  priority,
  dueDate,
}: {
  taskId: string;
  version: number;
  title: string;
  notes: string | null;
  priority: string;
  dueDate: string | null;
}) {
  const [state, action] = useActionState<AgendaActionState, FormData>(
    updateTaskAction as ActionFn,
    EMPTY_AGENDA_STATE,
  );

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="taskId" value={taskId} />
      <input type="hidden" name="expectedVersion" value={version} />

      <FormField label="O que precisa ser feito" required>
        {(field) => (
          <Input {...field} name="title" defaultValue={title} maxLength={TASK_TITLE_MAX} required />
        )}
      </FormField>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="min-w-0">
          <FormField label="Prazo">
            {(field) => (
              <Input {...field} type="date" name="dueDate" defaultValue={dueDate ?? ''} />
            )}
          </FormField>
        </div>
        <div className="min-w-0">
          <FormField label="Prioridade">
            {(field) => (
              <Select {...field} name="priority" defaultValue={priority}>
                {TASK_PRIORITIES.map((value) => (
                  <option key={value} value={value}>
                    {TASK_PRIORITY_LABEL[value]}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
        </div>
      </div>

      <FormField label="Observacoes">
        {(field) => (
          <Textarea
            {...field}
            name="notes"
            rows={3}
            defaultValue={notes ?? ''}
            maxLength={TASK_NOTES_MAX}
          />
        )}
      </FormField>

      <Feedback state={state} />

      <div className="flex justify-end">
        <SubmitButton>Salvar alteracoes</SubmitButton>
      </div>
    </form>
  );
}

/**
 * REAGENDAR E CANCELAR um compromisso, direto da linha da agenda.
 *
 * Sao as duas unicas saidas que ele tem. Nao ha "concluir": o tempo passar nao
 * prova que a visita aconteceu (ADR-073). Reagendar move o MESMO compromisso —
 * o historico precisa mostrar que a visita foi adiada, nao que uma sumiu e
 * outra apareceu.
 *
 * Cancelar exige motivo e fica atras de um clique a mais, como nas tarefas: um
 * compromisso que some da agenda sem explicacao vira, uma semana depois, uma
 * pergunta que ninguem responde.
 */
export function AppointmentActions({
  appointmentId,
  today,
}: {
  appointmentId: string;
  today: string;
}) {
  const [painel, setPainel] = useState<'nenhum' | 'reagendar' | 'cancelar'>('nenhum');
  const [inicio, setInicio] = useState(`${today}T09:00`);
  const [fim, setFim] = useState(`${today}T10:00`);

  const [reagendamento, reagendar] = useActionState<AgendaActionState, FormData>(
    updateAppointmentAction as ActionFn,
    EMPTY_AGENDA_STATE,
  );
  const [cancelamento, cancelar] = useActionState<AgendaActionState, FormData>(
    cancelAppointmentAction as ActionFn,
    EMPTY_AGENDA_STATE,
  );

  return (
    <div className="space-y-2">
      {painel === 'nenhum' ? (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="touch-target"
            onClick={() => setPainel('reagendar')}
          >
            Reagendar
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="touch-target"
            onClick={() => setPainel('cancelar')}
          >
            Cancelar
          </Button>
        </div>
      ) : null}

      {painel === 'reagendar' ? (
        <form action={reagendar} className="space-y-2">
          <input type="hidden" name="appointmentId" value={appointmentId} />
          <input type="hidden" name="reschedule" value="true" />
          <input type="hidden" name="allDay" value="false" />

          <div className="grid gap-2 sm:grid-cols-2">
            <div className="min-w-0">
              <FormField label="Novo inicio" required>
                {(field) => (
                  <Input
                    {...field}
                    type="datetime-local"
                    name="startAtLocal"
                    value={inicio}
                    onChange={(event) => setInicio(event.target.value)}
                    required
                  />
                )}
              </FormField>
            </div>
            <div className="min-w-0">
              <FormField label="Novo fim" required>
                {(field) => (
                  <Input
                    {...field}
                    type="datetime-local"
                    name="endAtLocal"
                    value={fim}
                    onChange={(event) => setFim(event.target.value)}
                    required
                  />
                )}
              </FormField>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <SubmitButton size="sm">Confirmar novo horario</SubmitButton>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="touch-target"
              onClick={() => setPainel('nenhum')}
            >
              Voltar
            </Button>
          </div>
          <Feedback state={reagendamento} />
        </form>
      ) : null}

      {painel === 'cancelar' ? (
        <form action={cancelar} className="space-y-2">
          <input type="hidden" name="appointmentId" value={appointmentId} />
          <FormField label="Por que o compromisso foi cancelado" required>
            {(field) => (
              <Textarea
                {...field}
                name="reason"
                rows={2}
                required
                minLength={CANCEL_REASON_MIN}
                maxLength={CANCEL_REASON_MAX}
              />
            )}
          </FormField>
          <div className="flex flex-wrap gap-2">
            <SubmitButton variant="destructive" size="sm">
              Confirmar cancelamento
            </SubmitButton>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="touch-target"
              onClick={() => setPainel('nenhum')}
            >
              Voltar
            </Button>
          </div>
          <Feedback state={cancelamento} />
        </form>
      ) : null}
    </div>
  );
}
