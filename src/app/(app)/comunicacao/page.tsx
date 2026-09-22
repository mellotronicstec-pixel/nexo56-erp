import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardList,
  CardListItem,
  EmptyState,
  linkButtonClass,
  PageHeader,
  Pagination,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@/design-system/components';
import { requireAccessForPage } from '@/modules/access-control/application/guard';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { FEATURES } from '@/modules/features/domain/catalog';
import {
  CHANNEL_LABEL,
  DELIVERY_ERROR_LABEL,
  isCommunicationChannel,
  isDeliveryError,
  isMessageStatus,
  MESSAGE_STATUS_LABEL,
  MESSAGE_STATUS_TONE,
} from '@/modules/communications/domain/communication';
import {
  listMessages,
  loadComposerContext,
  type MessageListItem,
} from '@/modules/communications/application/message-queries';
import { listTemplates } from '@/modules/communications/application/template-service';
import { MessageComposer } from './communication-forms';

export const metadata: Metadata = { title: 'Comunicacao' };

/**
 * A CAIXA DE COMUNICAÇÃO DA UNIDADE (itens 89 a 91).
 *
 * O que esta tela responde: o que a gente falou com os clientes desta loja, e
 * o que não conseguiu sair.
 *
 * O DESTINO APARECE MASCARADO (item 81). Esta é uma tela de lista, que fica
 * aberta no balcão; o telefone inteiro está na ficha da mensagem, que alguém
 * precisa escolher abrir.
 *
 * A MENSAGEM NASCE DE UM ATENDIMENTO, então não há "nova mensagem" solta: o
 * compositor aparece quando a URL traz uma Ordem de Serviço ou um cliente, e
 * os dois caminhos vêm de telas onde o contexto já existe. Um botão de
 * redação livre transformaria a caixa em disparador.
 */

function single(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

/** A tela perdoa filtro desconhecido; o serviço continua estrito. */
function conhecido(value: string | undefined, valido: (v: string) => boolean): string | undefined {
  return value && valido(value) ? value : undefined;
}

function hrefCom(atual: Record<string, string | undefined>, mudanca: Record<string, unknown>) {
  const params = new URLSearchParams();
  const combinado = { ...atual, ...mudanca };
  for (const [chave, valor] of Object.entries(combinado)) {
    if (valor !== undefined && valor !== null && valor !== '' && valor !== 1) {
      params.set(chave, String(valor));
    }
  }
  const query = params.toString();
  return query ? `/comunicacao?${query}` : '/comunicacao';
}

function Situacao({ item }: { item: MessageListItem }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Badge tone={MESSAGE_STATUS_TONE[item.status]}>{MESSAGE_STATUS_LABEL[item.status]}</Badge>
      {item.lastErrorCode && isDeliveryError(item.lastErrorCode) ? (
        <span className="text-xs text-muted">{DELIVERY_ERROR_LABEL[item.lastErrorCode]}</span>
      ) : null}
    </span>
  );
}

export default async function CommunicationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { context } = await requireAccessForPage(
    FEATURES.COMMUNICATIONS_CORE,
    PERMISSIONS.COMMUNICATIONS_VIEW,
  );

  const params = await searchParams;
  const pagina = Number(single(params.pagina) ?? '1');
  const situacao = conhecido(single(params.situacao), isMessageStatus);
  const canal = conhecido(single(params.canal), isCommunicationChannel);

  const lista = await listMessages(context, {
    status: situacao,
    channel: canal,
    page: Number.isFinite(pagina) && pagina > 0 ? pagina : 1,
  });

  const osParaResponder = single(params.os);
  const clienteParaResponder = single(params.cliente);

  /**
   * O compositor só é montado quando há contexto, e a montagem PASSA PELA
   * AUTORIZAÇÃO de envio — que é diferente da de ver. Quem só pode ver a
   * caixa não recebe o formulário, em vez de recebê-lo e descobrir a recusa
   * depois de escrever.
   */
  let composer = null;
  let templates: Awaited<ReturnType<typeof listTemplates>> = [];
  let erroDoCompositor: string | null = null;

  if (osParaResponder || clienteParaResponder) {
    try {
      composer = await loadComposerContext(context, {
        serviceOrderId: osParaResponder,
        customerId: clienteParaResponder,
      });
      templates = await listTemplates(context);
    } catch {
      erroDoCompositor =
        'Nao foi possivel abrir a redacao para este contexto. Confira se voce tem permissao de envio nesta unidade.';
    }
  }

  const atual = { situacao, canal };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Comunicacao"
        description="O que foi dito ao cliente, por onde foi e o que aconteceu em cada tentativa."
        breadcrumbs={[{ label: 'Comunicacao' }]}
        metadata={<span>{lista.total === 1 ? '1 mensagem' : `${lista.total} mensagens`}</span>}
        actions={
          <Link href="/comunicacao/modelos" className={linkButtonClass('secondary')}>
            Modelos de texto
          </Link>
        }
      />

      {/*
        O AVISO QUE ESTA TELA NAO PODE ESCONDER (item 250).
        Sem provedor, nada sai. Dizer isso em cima e mais honesto do que deixar
        a pessoa descobrir mensagem por mensagem, depois de escrever.
      */}
      <Alert tone="info">
        O Nexo56 ainda nao tem provedor de envio contratado. As mensagens sao registradas e ficam
        prontas para reenvio, mas <strong>nenhuma entrega real acontece</strong> ate que um provedor
        exista.
      </Alert>

      {erroDoCompositor ? <Alert tone="warning">{erroDoCompositor}</Alert> : null}

      {composer ? (
        <section aria-labelledby="nova-mensagem" className="space-y-3">
          <h2 id="nova-mensagem" className="text-lg font-semibold">
            Nova mensagem
          </h2>
          <MessageComposer
            composer={composer}
            templates={templates}
            purpose={single(params.motivo)}
          />
        </section>
      ) : null}

      <nav aria-label="Filtro por situacao" className="flex flex-wrap gap-2">
        <Link
          href={hrefCom(atual, { situacao: undefined, pagina: 1 })}
          aria-current={situacao ? undefined : 'page'}
          className={linkButtonClass(situacao ? 'secondary' : 'primary')}
        >
          Todas
        </Link>
        {(['queued', 'sent', 'failed', 'cancelled'] as const).map((valor) => (
          <Link
            key={valor}
            href={hrefCom(atual, { situacao: valor, pagina: 1 })}
            aria-current={situacao === valor ? 'page' : undefined}
            className={linkButtonClass(situacao === valor ? 'primary' : 'secondary')}
          >
            {MESSAGE_STATUS_LABEL[valor]}
          </Link>
        ))}
      </nav>

      {lista.items.length === 0 ? (
        <EmptyState
          title="Nenhuma mensagem por aqui"
          description="As mensagens aparecem aqui assim que alguem avisar um cliente a partir de uma Ordem de Servico."
        />
      ) : (
        <Card>
          <CardBody>
            {/* Tabela no desktop, lista de cartoes no celular: o mesmo dado, lido de dois jeitos. */}
            <Table
              caption="Mensagens enviadas ao cliente nesta unidade"
              className="hidden md:table"
            >
              <THead>
                <TR>
                  <TH>Cliente</TH>
                  <TH>Canal</TH>
                  <TH>Destino</TH>
                  <TH>Situacao</TH>
                  <TH>Quando</TH>
                  <TH>
                    <span className="sr-only">Acoes</span>
                  </TH>
                </TR>
              </THead>
              <TBody>
                {lista.items.map((item) => (
                  <TR key={item.id}>
                    <TD>
                      <span className="block font-medium">{item.customerName ?? 'Cliente'}</span>
                      <span className="block text-xs text-muted">{item.preview}</span>
                    </TD>
                    <TD>
                      {isCommunicationChannel(item.channel) ? CHANNEL_LABEL[item.channel] : '—'}
                    </TD>
                    <TD>{item.recipientMasked}</TD>
                    <TD>
                      <Situacao item={item} />
                    </TD>
                    <TD>{item.createdAt.toLocaleString('pt-BR')}</TD>
                    <TD>
                      <Link
                        href={`/comunicacao/${item.id}`}
                        className={linkButtonClass('ghost', 'sm')}
                      >
                        Abrir
                      </Link>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>

            <CardList label="Mensagens enviadas ao cliente nesta unidade" className="md:hidden">
              {lista.items.map((item) => (
                <CardListItem key={item.id}>
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <span className="font-medium">{item.customerName ?? 'Cliente'}</span>
                      <Situacao item={item} />
                    </div>
                    <p className="text-sm text-muted">{item.preview}</p>
                    <p className="text-xs text-muted">
                      {isCommunicationChannel(item.channel) ? CHANNEL_LABEL[item.channel] : '—'} ·{' '}
                      {item.recipientMasked} · {item.createdAt.toLocaleString('pt-BR')}
                    </p>
                    <Link
                      href={`/comunicacao/${item.id}`}
                      className={linkButtonClass('secondary', 'sm')}
                    >
                      Abrir mensagem
                    </Link>
                  </div>
                </CardListItem>
              ))}
            </CardList>
          </CardBody>
        </Card>
      )}

      <Pagination
        page={lista.page}
        pageCount={Math.max(1, Math.ceil(lista.total / lista.pageSize))}
        hrefFor={(destino: number) => hrefCom(atual, { pagina: destino })}
      />
    </div>
  );
}
