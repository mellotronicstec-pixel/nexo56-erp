'use client';

import { useActionState, useState } from 'react';
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
  BODY_MAX,
  CANCEL_REASON_MAX,
  CHANNEL_LABEL,
  COMMUNICATION_CHANNELS,
  MESSAGE_PURPOSE_LABEL,
  MESSAGE_PURPOSES,
  SUBJECT_MAX,
  TEMPLATE_NAME_MAX,
} from '@/modules/communications/domain/communication';
import { TEMPLATE_VARIABLES } from '@/modules/communications/domain/template';
import type { ComposerContext } from '@/modules/communications/application/message-queries';
import type { TemplateSummary } from '@/modules/communications/application/template-service';
import { EMPTY_COMMUNICATION_STATE, type CommunicationActionState } from './action-state';
import {
  archiveTemplateAction,
  cancelMessageAction,
  createTemplateAction,
  retryMessageAction,
  sendMessageAction,
  updateTemplateAction,
} from './actions';

type ActionFn = (
  previous: CommunicationActionState,
  formData: FormData,
) => Promise<CommunicationActionState>;

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
    O botao `sm` tem 32px de altura visual, e 32px nao e alvo de toque. A
    classe `touch-target` mantem a aparencia e leva a AREA clicavel a 44px,
    como no resto do sistema.
  */
  return (
    <Button
      type="submit"
      variant={variant}
      size={size}
      loading={pending}
      className={size === 'sm' ? 'touch-target' : undefined}
    >
      {children}
    </Button>
  );
}

/** Chave de intencao: um clique duplo reencontra a mensagem em vez de criar duas. */
function useCommandKey(): string {
  const [key] = useState(() => globalThis.crypto.randomUUID());
  return key;
}

function Feedback({ state }: { state: CommunicationActionState }) {
  return (
    <div aria-live="polite">
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compositor
// ---------------------------------------------------------------------------

/**
 * A TELA DE ESCREVER (itens 92 a 100).
 *
 * O DESTINO É UM `<select>` DOS CONTATOS DO CLIENTE, e não um campo de texto.
 * Isso não é comodidade: é a mesma regra que o servidor aplica de novo no
 * envio. Digitar um número solto aqui não seria aceito lá, então a tela
 * simplesmente não oferece o caminho que terminaria em recusa.
 *
 * O TEXTO NÃO É SALVO ENQUANTO NÃO É ENVIADO (item 39). Não existe rascunho:
 * o que está na caixa está no navegador, e a linha só nasce quando alguém
 * confirma. Quem fecha a aba perde o texto — e ganha a garantia de que toda
 * mensagem registrada é uma mensagem que alguém mandou enviar.
 */
export function MessageComposer({
  composer,
  templates,
  purpose,
}: {
  composer: ComposerContext;
  templates: TemplateSummary[];
  purpose?: string;
}) {
  const [state, formAction] = useActionState<CommunicationActionState, FormData>(
    sendMessageAction as ActionFn,
    EMPTY_COMMUNICATION_STATE,
  );
  const commandKey = useCommandKey();
  const [channel, setChannel] = useState<string>('whatsapp');
  const [templateId, setTemplateId] = useState<string>('');

  const contatosDoCanal = composer.contacts.filter((contato) => {
    if (channel === 'email') return contato.type === 'email';
    if (channel === 'whatsapp') return contato.type === 'phone' && contato.isWhatsapp;
    return contato.type === 'phone';
  });

  const modelosDoCanal = templates.filter((modelo) => modelo.channel === channel);
  const modelo = modelosDoCanal.find((item) => item.id === templateId);
  const usaAssunto = channel === 'email';

  return (
    <Card>
      <CardBody>
        <form action={formAction} className="space-y-4" noValidate>
          <input type="hidden" name="commandKey" value={commandKey} />
          <input type="hidden" name="customerId" value={composer.customerId} />
          {composer.serviceOrderId ? (
            <input type="hidden" name="serviceOrderId" value={composer.serviceOrderId} />
          ) : null}

          <Feedback state={state} />

          <p className="text-sm text-muted">
            Para <strong>{composer.customerName}</strong>
            {composer.serviceOrderNumber ? ` · ${composer.serviceOrderNumber}` : ''}
          </p>

          <FormField id="channel" label="Canal" required>
            {(props) => (
              <Select
                {...props}
                name="channel"
                required
                value={channel}
                onChange={(event) => {
                  setChannel(event.target.value);
                  setTemplateId('');
                }}
              >
                {COMMUNICATION_CHANNELS.map((valor) => (
                  <option key={valor} value={valor}>
                    {CHANNEL_LABEL[valor]}
                  </option>
                ))}
              </Select>
            )}
          </FormField>

          {contatosDoCanal.length === 0 ? (
            <Alert tone="warning">
              {channel === 'whatsapp'
                ? 'Este cliente nao tem telefone marcado como WhatsApp no cadastro. Ajuste o cadastro para enviar por este canal.'
                : 'Este cliente nao tem contato cadastrado para este canal.'}
            </Alert>
          ) : (
            <FormField id="contactValue" label="Enviar para" required>
              {(props) => (
                <Select {...props} name="contactValue" required>
                  {contatosDoCanal.map((contato) => (
                    <option key={contato.value} value={contato.value}>
                      {contato.label ? `${contato.label} — ${contato.display}` : contato.display}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
          )}

          <FormField id="purpose" label="Assunto do contato">
            {(props) => (
              <Select {...props} name="purpose" defaultValue={purpose ?? 'generic'}>
                {MESSAGE_PURPOSES.map((valor) => (
                  <option key={valor} value={valor}>
                    {MESSAGE_PURPOSE_LABEL[valor]}
                  </option>
                ))}
              </Select>
            )}
          </FormField>

          {modelosDoCanal.length > 0 ? (
            <FormField
              id="templateId"
              label="Modelo"
              hint="Ao escolher um modelo, o texto dele e copiado para a mensagem com as lacunas preenchidas."
            >
              {(props) => (
                <Select
                  {...props}
                  name="templateId"
                  value={templateId}
                  onChange={(event) => setTemplateId(event.target.value)}
                >
                  <option value="">Escrever do zero</option>
                  {modelosDoCanal.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
          ) : null}

          {templateId ? (
            <Alert tone="info">
              O texto do modelo <strong>{modelo?.name}</strong> sera usado. As lacunas sao
              preenchidas no envio; se alguma nao puder ser preenchida, a mensagem e recusada em vez
              de sair incompleta.
            </Alert>
          ) : (
            <>
              {usaAssunto ? (
                <FormField id="subject" label="Assunto" required>
                  {(props) => <Input {...props} name="subject" required maxLength={SUBJECT_MAX} />}
                </FormField>
              ) : null}

              <FormField
                id="body"
                label="Mensagem"
                hint={`Ate ${BODY_MAX} caracteres. Lacunas como {{cliente.primeiro_nome}} sao preenchidas no envio.`}
                required
              >
                {(props) => (
                  <Textarea {...props} name="body" rows={6} required maxLength={BODY_MAX} />
                )}
              </FormField>

              <details className="text-sm">
                <summary className="cursor-pointer touch-target py-2">Lacunas disponiveis</summary>
                <ul className="mt-2 space-y-1 text-muted">
                  {TEMPLATE_VARIABLES.map((variavel) => (
                    <li key={variavel.key}>
                      <code>{`{{${variavel.key}}}`}</code> — {variavel.label}
                      {variavel.scope === 'service_order' ? ' (exige Ordem de Servico)' : ''}
                    </li>
                  ))}
                </ul>
              </details>
            </>
          )}

          <SubmitButton>Enviar mensagem</SubmitButton>
        </form>
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Reenviar e cancelar
// ---------------------------------------------------------------------------

export function RetryMessageForm({
  messageId,
  serviceOrderId,
}: {
  messageId: string;
  serviceOrderId?: string | null;
}) {
  const [state, formAction] = useActionState<CommunicationActionState, FormData>(
    retryMessageAction as ActionFn,
    EMPTY_COMMUNICATION_STATE,
  );

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="messageId" value={messageId} />
      {serviceOrderId ? <input type="hidden" name="serviceOrderId" value={serviceOrderId} /> : null}
      <Feedback state={state} />
      <SubmitButton variant="secondary" size="sm">
        Tentar de novo
      </SubmitButton>
    </form>
  );
}

export function CancelMessageForm({
  messageId,
  serviceOrderId,
}: {
  messageId: string;
  serviceOrderId?: string | null;
}) {
  const [state, formAction] = useActionState<CommunicationActionState, FormData>(
    cancelMessageAction as ActionFn,
    EMPTY_COMMUNICATION_STATE,
  );

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="messageId" value={messageId} />
      {serviceOrderId ? <input type="hidden" name="serviceOrderId" value={serviceOrderId} /> : null}
      <Feedback state={state} />
      <FormField id={`reason-${messageId}`} label="Motivo do cancelamento">
        {(props) => <Input {...props} name="reason" maxLength={CANCEL_REASON_MAX} />}
      </FormField>
      <SubmitButton variant="destructive" size="sm">
        Cancelar mensagem
      </SubmitButton>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Modelos
// ---------------------------------------------------------------------------

function TemplateFields({ template }: { template?: TemplateSummary }) {
  const [channel, setChannel] = useState<string>(template?.channel ?? 'whatsapp');

  return (
    <>
      <FormField id={`name-${template?.id ?? 'novo'}`} label="Nome do modelo" required>
        {(props) => (
          <Input
            {...props}
            name="name"
            required
            maxLength={TEMPLATE_NAME_MAX}
            defaultValue={template?.name}
          />
        )}
      </FormField>

      <FormField id={`channel-${template?.id ?? 'novo'}`} label="Canal" required>
        {(props) => (
          <Select
            {...props}
            name="channel"
            required
            value={channel}
            onChange={(event) => setChannel(event.target.value)}
          >
            {COMMUNICATION_CHANNELS.map((valor) => (
              <option key={valor} value={valor}>
                {CHANNEL_LABEL[valor]}
              </option>
            ))}
          </Select>
        )}
      </FormField>

      <FormField id={`purpose-${template?.id ?? 'novo'}`} label="Assunto do contato">
        {(props) => (
          <Select {...props} name="purpose" defaultValue={template?.purpose ?? 'generic'}>
            {MESSAGE_PURPOSES.map((valor) => (
              <option key={valor} value={valor}>
                {MESSAGE_PURPOSE_LABEL[valor]}
              </option>
            ))}
          </Select>
        )}
      </FormField>

      {channel === 'email' ? (
        <FormField id={`subject-${template?.id ?? 'novo'}`} label="Assunto do e-mail" required>
          {(props) => (
            <Input
              {...props}
              name="subject"
              required
              maxLength={SUBJECT_MAX}
              defaultValue={template?.subject ?? ''}
            />
          )}
        </FormField>
      ) : null}

      <FormField
        id={`body-${template?.id ?? 'novo'}`}
        label="Texto"
        hint="Use lacunas como {{cliente.primeiro_nome}}. Uma lacuna que nao existe impede salvar."
        required
      >
        {(props) => (
          <Textarea
            {...props}
            name="body"
            rows={6}
            required
            maxLength={BODY_MAX}
            defaultValue={template?.body}
          />
        )}
      </FormField>
    </>
  );
}

export function CreateTemplateForm() {
  const [state, formAction] = useActionState<CommunicationActionState, FormData>(
    createTemplateAction as ActionFn,
    EMPTY_COMMUNICATION_STATE,
  );

  return (
    <Card>
      <CardBody>
        <form action={formAction} className="space-y-4" noValidate>
          <Feedback state={state} />
          <TemplateFields />
          <SubmitButton>Criar modelo</SubmitButton>
        </form>
      </CardBody>
    </Card>
  );
}

export function EditTemplateForm({ template }: { template: TemplateSummary }) {
  const [state, formAction] = useActionState<CommunicationActionState, FormData>(
    updateTemplateAction as ActionFn,
    EMPTY_COMMUNICATION_STATE,
  );

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <input type="hidden" name="templateId" value={template.id} />
      <input type="hidden" name="expectedVersion" value={template.version} />
      <Feedback state={state} />
      <TemplateFields template={template} />
      <SubmitButton size="sm">Salvar modelo</SubmitButton>
    </form>
  );
}

export function ArchiveTemplateForm({ templateId }: { templateId: string }) {
  const [state, formAction] = useActionState<CommunicationActionState, FormData>(
    archiveTemplateAction as ActionFn,
    EMPTY_COMMUNICATION_STATE,
  );

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="templateId" value={templateId} />
      <Feedback state={state} />
      <SubmitButton variant="ghost" size="sm">
        Arquivar
      </SubmitButton>
    </form>
  );
}
