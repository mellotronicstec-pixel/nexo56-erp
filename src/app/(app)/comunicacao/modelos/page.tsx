import type { Metadata } from 'next';
import {
  Alert,
  Badge,
  Card,
  CardBody,
  EmptyState,
  PageHeader,
  Section,
} from '@/design-system/components';
import { requireAccessForPage } from '@/modules/access-control/application/guard';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { can } from '@/modules/access-control/application/authorization-service';
import { FEATURES } from '@/modules/features/domain/catalog';
import {
  CHANNEL_LABEL,
  isCommunicationChannel,
  isMessagePurpose,
  MESSAGE_PURPOSE_LABEL,
} from '@/modules/communications/domain/communication';
import { previewTemplate } from '@/modules/communications/domain/template';
import { listTemplates } from '@/modules/communications/application/template-service';
import { ArchiveTemplateForm, CreateTemplateForm, EditTemplateForm } from '../communication-forms';

export const metadata: Metadata = { title: 'Modelos de mensagem' };

/**
 * MODELOS DE TEXTO (itens 109 a 114).
 *
 * VER MODELO EXIGE VER COMUNICAÇÃO; MEXER NO MODELO EXIGE CHAVE PRÓPRIA. Quem
 * atende no balcão precisa saber o que os modelos dizem — ele vai mandá-los —
 * mas mudar o texto que todas as unidades usarão amanhã é outra autoridade.
 *
 * A PRÉ-VISUALIZAÇÃO USA VALORES DE EXEMPLO, e a tela diz isso em voz alta. Um
 * preview com dados de um cliente real daria a impressão de que aquela
 * mensagem específica já existe.
 */

/** O preview pode falhar se o texto tiver lacuna inválida — e aí ele explica. */
function previewSeguro(body: string): { texto: string; erro: string | null } {
  try {
    return { texto: previewTemplate(body), erro: null };
  } catch (error) {
    return {
      texto: body,
      erro: error instanceof Error ? error.message : 'Nao foi possivel pre-visualizar.',
    };
  }
}

export default async function TemplatesPage() {
  const { context } = await requireAccessForPage(
    FEATURES.COMMUNICATIONS_CORE,
    PERMISSIONS.COMMUNICATIONS_VIEW,
  );

  const modelos = await listTemplates(context, { includeArchived: true });

  const decisao = await can(context, {
    permission: PERMISSIONS.COMMUNICATIONS_TEMPLATES_MANAGE,
    featureKey: FEATURES.COMMUNICATIONS_CORE,
  });
  const podeGerenciar = decisao.allowed;

  const ativos = modelos.filter((modelo) => modelo.status === 'active');
  const arquivados = modelos.filter((modelo) => modelo.status !== 'active');

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Modelos de mensagem"
        description="O texto padrao que a empresa usa para falar com o cliente."
        breadcrumbs={[{ label: 'Comunicacao', href: '/comunicacao' }, { label: 'Modelos' }]}
        metadata={
          <span>{ativos.length === 1 ? '1 modelo ativo' : `${ativos.length} modelos ativos`}</span>
        }
      />

      <Alert tone="info">
        Editar um modelo muda apenas as mensagens <strong>futuras</strong>. O texto ja enviado fica
        como foi enviado: o historico nao se reescreve.
      </Alert>

      {podeGerenciar ? (
        <Section id="novo-modelo" title="Novo modelo">
          <CreateTemplateForm />
        </Section>
      ) : null}

      <Section id="modelos-ativos" title="Modelos ativos">
        {ativos.length === 0 ? (
          <EmptyState
            title="Nenhum modelo ainda"
            description="Sem modelo, cada mensagem e escrita do zero — o que funciona, mas faz cada pessoa falar de um jeito."
          />
        ) : (
          <div className="space-y-4">
            {ativos.map((modelo) => {
              const preview = previewSeguro(modelo.body);
              return (
                <Card key={modelo.id}>
                  <CardBody className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="font-semibold">{modelo.name}</h3>
                      <span className="flex flex-wrap items-center gap-2">
                        <Badge tone="neutral">
                          {isCommunicationChannel(modelo.channel)
                            ? CHANNEL_LABEL[modelo.channel]
                            : modelo.channel}
                        </Badge>
                        <Badge tone="brand">
                          {isMessagePurpose(modelo.purpose)
                            ? MESSAGE_PURPOSE_LABEL[modelo.purpose]
                            : modelo.purpose}
                        </Badge>
                      </span>
                    </div>

                    <div>
                      <p className="text-sm text-muted">
                        Pre-visualizacao com valores de exemplo — nada disso e um cliente real.
                      </p>
                      {preview.erro ? (
                        <Alert tone="warning">{preview.erro}</Alert>
                      ) : (
                        <p className="mt-1 whitespace-pre-wrap rounded bg-surface-muted p-3 text-sm">
                          {preview.texto}
                        </p>
                      )}
                    </div>

                    {podeGerenciar ? (
                      <details>
                        <summary className="cursor-pointer touch-target py-2 text-sm">
                          Editar este modelo
                        </summary>
                        <div className="mt-3 space-y-4">
                          <EditTemplateForm template={modelo} />
                          <ArchiveTemplateForm templateId={modelo.id} />
                        </div>
                      </details>
                    ) : null}
                  </CardBody>
                </Card>
              );
            })}
          </div>
        )}
      </Section>

      {arquivados.length > 0 ? (
        <Section
          id="modelos-arquivados"
          title="Modelos arquivados"
          description="Continuam aqui porque mensagens antigas apontam para eles. Nao podem mais ser usados."
        >
          <Card>
            <CardBody>
              <ul className="space-y-2 text-sm text-muted">
                {arquivados.map((modelo) => (
                  <li key={modelo.id}>
                    {modelo.name} ·{' '}
                    {isCommunicationChannel(modelo.channel)
                      ? CHANNEL_LABEL[modelo.channel]
                      : modelo.channel}
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        </Section>
      ) : null}
    </div>
  );
}
