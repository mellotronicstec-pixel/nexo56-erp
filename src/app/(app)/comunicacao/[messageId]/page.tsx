import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import {
  Alert,
  Badge,
  Card,
  CardBody,
  linkButtonClass,
  PageHeader,
  Section,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@/design-system/components';
import { isAppError, NotFoundError } from '@/core/errors';
import { requireAccessForPage } from '@/modules/access-control/application/guard';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { FEATURES } from '@/modules/features/domain/catalog';
import {
  canCancel,
  canRetry,
  CHANNEL_LABEL,
  DELIVERY_ERROR_LABEL,
  isDeliveryError,
  MESSAGE_ORIGIN_LABEL,
  MESSAGE_PURPOSE_LABEL,
  MESSAGE_STATUS_LABEL,
  MESSAGE_STATUS_TONE,
  isMessageOrigin,
  isMessagePurpose,
} from '@/modules/communications/domain/communication';
import { findMessage } from '@/modules/communications/application/message-queries';
import { CancelMessageForm, RetryMessageForm } from '../communication-forms';

export const metadata: Metadata = { title: 'Mensagem' };

/**
 * A FICHA DA MENSAGEM (itens 101 a 108).
 *
 * Aqui o destino aparece INTEIRO: quem abriu esta tela quis conferir para onde
 * a mensagem foi, e mascarar aqui tornaria o histórico inútil justamente para
 * o uso que ele tem — confirmar que o cliente certo foi avisado.
 *
 * A LISTA DE TENTATIVAS É O CORAÇÃO DA TELA. Ela responde "por que o cliente
 * não recebeu" com horário, provedor e motivo, em vez de um "falhou" que não
 * ajuda ninguém. Cada linha é um fato que aconteceu e que nada apaga.
 *
 * O QUE ESTA TELA NUNCA DIZ: "entregue", "lido", "recebido pelo cliente".
 * Ninguém confirmou nada disso, e escrever seria inventar (item 250).
 */

export default async function MessagePage({ params }: { params: Promise<{ messageId: string }> }) {
  const { context } = await requireAccessForPage(
    FEATURES.COMMUNICATIONS_CORE,
    PERMISSIONS.COMMUNICATIONS_VIEW,
  );

  const { messageId } = await params;

  const mensagem = await findMessage(context, messageId).catch((error: unknown) => {
    if (isAppError(error) && error instanceof NotFoundError) notFound();
    throw error;
  });

  const podeAgir = mensagem.status === 'failed' || mensagem.status === 'queued';

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title={`Mensagem para ${mensagem.customerName ?? 'o cliente'}`}
        description={`${CHANNEL_LABEL[mensagem.channel]} · ${mensagem.recipientDisplay}`}
        breadcrumbs={[{ label: 'Comunicacao', href: '/comunicacao' }, { label: 'Mensagem' }]}
        metadata={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Badge tone={MESSAGE_STATUS_TONE[mensagem.status]}>
              {MESSAGE_STATUS_LABEL[mensagem.status]}
            </Badge>
            <span>{mensagem.createdAt.toLocaleString('pt-BR')}</span>
          </span>
        }
        actions={
          mensagem.serviceOrderId ? (
            <Link
              href={`/ordens-de-servico/${mensagem.serviceOrderId}`}
              className={linkButtonClass('secondary')}
            >
              {mensagem.serviceOrderNumber ?? 'Abrir a Ordem de Servico'}
            </Link>
          ) : null
        }
      />

      {/*
        A frase mais importante da tela. `sent` significa que um provedor
        ACEITOU — e a diferenca entre isso e "o cliente recebeu" e exatamente o
        que separa um historico confiavel de um que mente.
      */}
      {mensagem.status === 'sent' ? (
        <Alert tone="info">
          O provedor <strong>{mensagem.sentProvider ?? 'configurado'}</strong> aceitou esta mensagem
          em {mensagem.sentAt?.toLocaleString('pt-BR')}. Isso nao confirma que o cliente recebeu ou
          leu: o Nexo56 nao tem como saber disso hoje.
        </Alert>
      ) : null}

      {mensagem.status === 'failed' && mensagem.lastErrorCode ? (
        <Alert tone="danger">
          <strong>
            {isDeliveryError(mensagem.lastErrorCode)
              ? DELIVERY_ERROR_LABEL[mensagem.lastErrorCode]
              : 'Falha na entrega'}
          </strong>
          {mensagem.lastErrorDetail ? (
            <span className="block">{mensagem.lastErrorDetail}</span>
          ) : null}
        </Alert>
      ) : null}

      {mensagem.status === 'cancelled' ? (
        <Alert tone="warning">
          Cancelada em {mensagem.cancelledAt?.toLocaleString('pt-BR')}.
          {mensagem.cancelReason ? ` Motivo: ${mensagem.cancelReason}` : ''}
        </Alert>
      ) : null}

      <Section id="conteudo" title="O que foi escrito">
        <Card>
          <CardBody className="space-y-3">
            {mensagem.subject ? (
              <p>
                <span className="text-sm text-muted">Assunto</span>
                <span className="block font-medium">{mensagem.subject}</span>
              </p>
            ) : null}
            {/* O texto e mostrado como foi gravado: sem reprocessar lacuna nenhuma. */}
            <p className="whitespace-pre-wrap">{mensagem.body}</p>

            <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted">Origem</dt>
                <dd>
                  {isMessageOrigin(mensagem.origin)
                    ? MESSAGE_ORIGIN_LABEL[mensagem.origin]
                    : mensagem.origin}
                </dd>
              </div>
              <div>
                <dt className="text-muted">Assunto do contato</dt>
                <dd>
                  {isMessagePurpose(mensagem.purpose)
                    ? MESSAGE_PURPOSE_LABEL[mensagem.purpose]
                    : mensagem.purpose}
                </dd>
              </div>
            </dl>
          </CardBody>
        </Card>
      </Section>

      {mensagem.attachments.length > 0 ? (
        <Section id="anexos" title="Anexos">
          <Card>
            <CardBody>
              <ul className="space-y-2 text-sm">
                {mensagem.attachments.map((anexo) => (
                  <li key={anexo.filename}>
                    {anexo.filename} · {Math.ceil(anexo.byteSize / 1024)} KB
                    {anexo.warrantyId ? (
                      <Link
                        href={`/garantias/${anexo.warrantyId}`}
                        className="ml-2 underline touch-target inline-flex items-center"
                      >
                        Ver a garantia
                      </Link>
                    ) : null}
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        </Section>
      ) : null}

      <Section
        id="tentativas"
        title="Tentativas de entrega"
        description="Cada linha e uma tentativa que aconteceu de verdade. Nenhuma e sobrescrita pela seguinte."
      >
        <Card>
          <CardBody>
            {mensagem.attempts.length === 0 ? (
              <p className="text-sm text-muted">
                Nenhuma tentativa registrada ainda. A mensagem esta na fila.
              </p>
            ) : (
              <Table caption="Tentativas de entrega desta mensagem">
                <THead>
                  <TR>
                    <TH>#</TH>
                    <TH>Quando</TH>
                    <TH>Provedor</TH>
                    <TH>Resultado</TH>
                  </TR>
                </THead>
                <TBody>
                  {mensagem.attempts.map((tentativa) => (
                    <TR key={tentativa.attemptNumber}>
                      <TD>{tentativa.attemptNumber}</TD>
                      <TD>{tentativa.startedAt.toLocaleString('pt-BR')}</TD>
                      <TD>{tentativa.provider}</TD>
                      <TD>
                        {tentativa.outcome === 'accepted' ? (
                          <Badge tone="success">Aceita pelo provedor</Badge>
                        ) : (
                          <span className="space-y-1">
                            <Badge tone="danger">
                              {tentativa.errorCode && isDeliveryError(tentativa.errorCode)
                                ? DELIVERY_ERROR_LABEL[tentativa.errorCode]
                                : 'Falhou'}
                            </Badge>
                            {tentativa.errorDetail ? (
                              <span className="block text-xs text-muted">
                                {tentativa.errorDetail}
                              </span>
                            ) : null}
                          </span>
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardBody>
        </Card>
      </Section>

      {podeAgir ? (
        <Section
          id="acoes"
          title="O que da para fazer agora"
          description="Reenviar usa a mesma mensagem e acrescenta uma tentativa. Cancelar so vale enquanto nada foi aceito."
        >
          <Card>
            <CardBody className="space-y-4">
              {canRetry(mensagem.status) ? (
                <RetryMessageForm
                  messageId={mensagem.id}
                  serviceOrderId={mensagem.serviceOrderId}
                />
              ) : null}
              {canCancel(mensagem.status) ? (
                <CancelMessageForm
                  messageId={mensagem.id}
                  serviceOrderId={mensagem.serviceOrderId}
                />
              ) : null}
            </CardBody>
          </Card>
        </Section>
      ) : null}
    </div>
  );
}
