import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Alert, Badge, Card, CardBody, CardHeader, PageHeader } from '@/design-system/components';
import { isAppError } from '@/core/errors';
import { requireAccessForPage } from '@/modules/access-control/application/guard';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { FEATURES } from '@/modules/features/domain/catalog';
import { findCertificateByToken } from '@/modules/warranties/application/warranty-certificate-service';
import { warrantyTypeLabel } from '@/modules/warranties/domain/warranty';
import { dataCivil, instante } from '../../format';

export const metadata: Metadata = { title: 'Certificado de garantia' };

interface PageProps {
  params: Promise<{ token: string }>;
}

/**
 * Certificado de garantia resolvido pelo token do QR (Prompt 13, itens 18 a 21).
 *
 * O TOKEN IDENTIFICA, NAO AUTORIZA. Esta pagina esta atras do mesmo guarda de
 * qualquer outra: quem fotografou o QR na fila do balcao nao ganha acesso a
 * nada sem sessao valida na empresa certa. Um token que abrisse o documento
 * sozinho seria um link publico com o nome do cliente dentro.
 *
 * O QUE APARECE AQUI E O SNAPSHOT, nao o estado de hoje. Se a politica mudou,
 * se a garantia foi revogada ontem ou se o cliente trocou de telefone, este
 * documento continua dizendo o que foi prometido no dia da emissao — e e
 * exatamente para isso que ele existe.
 *
 * NAO E PDF. E HTML com snapshot e soma de verificacao; o navegador imprime.
 * Chamar isto de PDF seria prometer um arquivo que o sistema nao gera.
 */
export default async function WarrantyCertificatePage({ params }: PageProps) {
  const { context } = await requireAccessForPage(
    FEATURES.OPERATIONS_WARRANTIES,
    PERMISSIONS.WARRANTIES_VIEW,
  );

  const { token } = await params;

  const certificado = await findCertificateByToken(context, token).catch((error: unknown) => {
    /** Token de outra empresa e token inexistente terminam no mesmo lugar. */
    if (isAppError(error)) return null;
    throw error;
  });

  if (!certificado) notFound();

  const { snapshot } = certificado;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title={`Certificado ${snapshot.garantia.numero}`}
        description="Os termos exatamente como foram prometidos no dia da emissao."
        breadcrumbs={[{ label: 'Garantias', href: '/garantias' }, { label: 'Certificado' }]}
        metadata={<span>Emitido em {instante(certificado.issuedAt)}</span>}
      />

      <Alert tone="info">
        Este documento e um retrato do momento da emissao. Para a situacao atual da garantia —
        cancelada, revogada, retornos registrados —{' '}
        <Link
          href={`/garantias/${certificado.warrantyId}`}
          className="font-semibold text-brand-700 underline"
        >
          abra a ficha da garantia
        </Link>
        .
      </Alert>

      <Card className="min-w-0">
        <CardHeader
          title={snapshot.empresa.nome}
          description={`Unidade ${snapshot.empresa.unidade}`}
          headingLevel={2}
        />
        <CardBody className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="brand">{warrantyTypeLabel(snapshot.garantia.tipo)}</Badge>
            <Badge tone={snapshot.garantia.cobreServicoInteiro ? 'neutral' : 'warning'}>
              {snapshot.garantia.cobreServicoInteiro
                ? 'Cobertura do servico inteiro'
                : 'Cobertura parcial'}
            </Badge>
          </div>

          <dl className="grid gap-4 sm:grid-cols-2">
            <div className="min-w-0">
              <dt className="text-small text-ink-500">Cliente</dt>
              <dd className="font-medium text-ink-900">{snapshot.cliente.nome}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-small text-ink-500">Aparelho</dt>
              <dd className="font-medium text-ink-900">
                {[
                  snapshot.equipamento.descricao,
                  snapshot.equipamento.marca,
                  snapshot.equipamento.modelo,
                ]
                  .filter(Boolean)
                  .join(' ')}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-small text-ink-500">Vigencia</dt>
              <dd className="font-medium text-ink-900">
                {dataCivil(snapshot.garantia.vigencia.inicio)} a{' '}
                {dataCivil(snapshot.garantia.vigencia.fim)}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-small text-ink-500">Prazo</dt>
              <dd className="font-medium text-ink-900">{snapshot.garantia.duracao}</dd>
            </div>
            {snapshot.ordemDeServico ? (
              <div className="min-w-0">
                <dt className="text-small text-ink-500">Ordem de Servico</dt>
                <dd className="font-medium text-ink-900">OS {snapshot.ordemDeServico.numero}</dd>
              </div>
            ) : null}
          </dl>

          <section>
            <h3 className="text-ui font-semibold text-ink-900">O que esta coberto</h3>
            {snapshot.cobertura.length === 0 ? (
              <p className="text-ui text-ink-700">
                {snapshot.garantia.cobreServicoInteiro
                  ? 'O servico realizado como um todo, exceto o que consta nas exclusoes.'
                  : 'Nenhum item detalhado.'}
              </p>
            ) : (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-ui text-ink-700">
                {snapshot.cobertura.map((item, index) => (
                  <li key={`${item.tipo}-${index}`}>
                    <span className="font-medium text-ink-900">{item.tipo}:</span> {item.descricao}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {snapshot.exclusoes ? (
            <section>
              <h3 className="text-ui font-semibold text-ink-900">Exclusoes</h3>
              <p className="whitespace-pre-line text-ui text-ink-700">{snapshot.exclusoes}</p>
            </section>
          ) : null}

          {snapshot.termos ? (
            <section>
              <h3 className="text-ui font-semibold text-ink-900">Termos</h3>
              <p className="whitespace-pre-line text-ui text-ink-700">{snapshot.termos}</p>
            </section>
          ) : null}

          <div className="border-t border-ink-200 pt-4">
            <p className="text-small text-ink-500">Soma de verificacao do documento</p>
            <p className="break-all font-mono text-small text-ink-700">{certificado.checksum}</p>
            <p className="mt-2 text-small text-ink-500">
              A soma cobre o conteudo acima. Duas impressoes do mesmo certificado tem a mesma soma;
              um texto alterado teria outra.
            </p>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
