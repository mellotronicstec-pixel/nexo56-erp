import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  linkButtonClass,
  PageHeader,
} from '@/design-system/components';
import { IconWarranty } from '@/design-system/icons';
import { requireAccessForPage } from '@/modules/access-control/application/guard';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { FEATURES } from '@/modules/features/domain/catalog';
import { findApplicableWarranties } from '@/modules/warranties/application/warranty-return-service';
import {
  formatWarrantyNumber,
  warrantyTypeLabel,
  WARRANTY_STATUS_LABEL,
  WARRANTY_STATUS_TONE,
  type WarrantyStatus,
} from '@/modules/warranties/domain/warranty';
import { dataCivil, single } from '../format';

export const metadata: Metadata = { title: 'Registrar retorno' };

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Primeiro passo do retorno em garantia (Prompt 13, itens 22 a 24 e 88).
 *
 * A PERGUNTA CERTA E "QUAL GARANTIA", NAO "QUAL CLIENTE". O mesmo aparelho
 * pode carregar tres garantias ao mesmo tempo — a interna do reparo, a da peca
 * trocada e a de fabrica —, e cada uma cobre coisa diferente. Escolher pelo
 * cliente esconderia justamente a escolha que decide se o conserto e gratuito.
 *
 * TODAS APARECEM, AS VENCIDAS INCLUSIVE. Esconder as expiradas pareceria limpo
 * e seria pior: o atendente precisa poder dizer "existiu uma garantia e ela
 * terminou semana passada" em vez de "nao encontrei nada".
 *
 * O REGISTRO EM SI acontece na ficha da garantia, onde a cobertura esta
 * escrita — ninguem deveria prometer conserto gratuito sem ler o que a loja
 * garantiu.
 */
export default async function NewWarrantyReturnPage({ searchParams }: PageProps) {
  const { context } = await requireAccessForPage(
    FEATURES.OPERATIONS_WARRANTIES,
    PERMISSIONS.WARRANTIES_RETURN_CREATE,
  );

  const params = await searchParams;
  const equipmentId = single(params.aparelho);

  const garantias = equipmentId ? await findApplicableWarranties(context, equipmentId) : [];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="Registrar retorno em garantia"
        description="Escolha a garantia que o cliente esta acionando. Cada uma cobre uma coisa diferente."
        breadcrumbs={[{ label: 'Garantias', href: '/garantias' }, { label: 'Registrar retorno' }]}
        actions={
          <Link href="/garantias/lista" className={linkButtonClass('secondary')}>
            Ver garantias
          </Link>
        }
      />

      {!equipmentId ? (
        <Alert tone="info">
          Abra o aparelho em Equipamentos e use &quot;Registrar retorno em garantia&quot;, ou abra a
          garantia diretamente pela lista. O retorno precisa saber de qual garantia se trata — o
          mesmo aparelho pode ter mais de uma, cobrindo coisas diferentes.
        </Alert>
      ) : null}

      <Card>
        <CardHeader
          title="Garantias deste aparelho"
          description="Inclui as ja vencidas, marcadas como tal — poder explicar que terminou tambem e informacao."
          headingLevel={2}
        />
        <CardBody className="p-0">
          {garantias.length === 0 ? (
            <EmptyState
              icon={<IconWarranty />}
              title={
                equipmentId ? 'Nenhuma garantia para este aparelho' : 'Nenhum aparelho escolhido'
              }
              description={
                equipmentId
                  ? 'Este aparelho nao tem garantia registrada nestas unidades. O atendimento segue pelo caminho normal, com orcamento.'
                  : 'Escolha o aparelho pela ficha dele em Equipamentos.'
              }
              action={
                <Link
                  href="/equipamentos"
                  className={linkButtonClass('secondary', 'sm', 'touch-target')}
                >
                  Ir para Equipamentos
                </Link>
              }
            />
          ) : (
            <ul className="divide-y divide-ink-100">
              {garantias.map((garantia) => (
                <li
                  key={garantia.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-ink-900">
                      {formatWarrantyNumber(garantia.number)}
                    </p>
                    <p className="text-small text-ink-500">
                      {warrantyTypeLabel(garantia.type)} · {dataCivil(garantia.startsOn)} a{' '}
                      {dataCivil(garantia.endsOn)}
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <Badge
                      tone={WARRANTY_STATUS_TONE[garantia.status as WarrantyStatus] ?? 'neutral'}
                    >
                      {WARRANTY_STATUS_LABEL[garantia.status as WarrantyStatus] ?? garantia.status}
                    </Badge>
                    <Badge tone={garantia.enforceable ? 'success' : 'neutral'}>
                      {garantia.enforceable ? 'Acionavel hoje' : 'Nao acionavel hoje'}
                    </Badge>
                    <Link
                      href={`/garantias/${garantia.id}`}
                      className="touch-target inline-flex items-center text-ui font-semibold text-brand-600"
                    >
                      Abrir e registrar
                      <span className="sr-only">
                        {' '}
                        o retorno na garantia {formatWarrantyNumber(garantia.number)}
                      </span>
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <p className="text-small text-ink-500">
        O retorno registrado sob garantia valida e com defeito coberto cria uma Ordem de Servico
        NOVA, em Aguardando Conserto, vinculada a garantia. A OS original nao reabre e o numero dela
        nao e reaproveitado.
      </p>
    </div>
  );
}
