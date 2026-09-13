import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Alert,
  Card,
  CardBody,
  CardList,
  CardListItem,
  EmptyState,
  PageHeader,
  Pagination,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@/design-system/components';
import { IconIntake } from '@/design-system/icons';
import { requireAccessForPage } from '@/modules/access-control/application/guard';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { listIntakes } from '@/modules/equipment/application/equipment-queries';
import { equipmentTitle } from '@/modules/equipment/domain/equipment';
import { FEATURES } from '@/modules/features/domain/catalog';
import { checkAccess } from '@/modules/features/application/effective-access';
import { mapServiceOrdersByIntake } from '@/modules/service-orders/application/service-order-queries';
import { formatServiceOrderNumber } from '@/modules/service-orders/domain/service-order';

export const metadata: Metadata = { title: 'Recebimentos' };

/**
 * Recebimentos da UNIDADE ATIVA (itens 67 e 108).
 *
 * A lista muda quando a pessoa troca de unidade — e esse e o comportamento
 * correto: quem opera no balcao da loja Centro nao precisa (nem deve) ver as
 * entradas registradas na Norte.
 */
export default async function IntakesPage({
  searchParams,
}: {
  searchParams: Promise<{ pagina?: string }>;
}) {
  const { context } = await requireAccessForPage(
    FEATURES.CORE_EQUIPMENT_INTAKE,
    PERMISSIONS.EQUIPMENT_INTAKE_VIEW,
  );

  const { pagina } = await searchParams;
  const pageParam = Number(pagina ?? '1');
  const result = await listIntakes(context, {
    page: Number.isInteger(pageParam) && pageParam > 0 ? pageParam : 1,
  });

  /**
   * Atalho para a Ordem de Servico (Prompt 07, item 31).
   *
   * UMA consulta cobre a pagina inteira: cada linha ja sabe se a ordem existe,
   * sem consultar o banco por recebimento.
   */
  const [serviceOrderAccess, ordersByIntake] = await Promise.all([
    checkAccess(context, {
      featureKey: FEATURES.CORE_SERVICE_ORDERS,
      permission: PERMISSIONS.SERVICE_ORDERS_CREATE,
    }),
    mapServiceOrdersByIntake(
      context,
      result.items.map((item) => item.id),
    ),
  ]);

  const formatter = new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: context.tenantTimezone,
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Recebimentos"
        description="Entradas de equipamentos registradas nesta unidade."
        breadcrumbs={[{ label: 'Recebimentos' }]}
        metadata={<span>{result.total} recebimento(s)</span>}
      />

      {!context.activeUnitId ? (
        <Alert tone="warning" title="Nenhuma unidade selecionada">
          Escolha uma unidade no seletor da barra superior para ver os recebimentos dela.
        </Alert>
      ) : null}

      <Card>
        {result.items.length === 0 ? (
          <EmptyState
            icon={<IconIntake />}
            title="Nenhum recebimento"
            description="Nenhum equipamento foi recebido nesta unidade ainda."
          />
        ) : (
          <CardBody className="p-0">
            <div className="hidden md:block">
              <Table caption="Recebimentos desta unidade">
                <THead>
                  <TR>
                    <TH>Quando</TH>
                    <TH>Equipamento</TH>
                    <TH>Cliente</TH>
                    <TH>Unidade</TH>
                    <TH align="right" srOnly>
                      Acoes
                    </TH>
                  </TR>
                </THead>
                <TBody>
                  {result.items.map((item) => (
                    <TR key={item.id}>
                      <TD className="whitespace-nowrap">{formatter.format(item.receivedAt)}</TD>
                      <TD className="font-medium text-ink-900">
                        {equipmentTitle({
                          kind: item.equipmentKind,
                          brand: item.equipmentBrand,
                          model: item.equipmentModel,
                        })}
                      </TD>
                      <TD>{item.customerName}</TD>
                      <TD>{item.unitName ?? '—'}</TD>
                      <TD align="right" className="whitespace-nowrap">
                        {ordersByIntake.has(item.id) ? (
                          <Link
                            href={`/ordens-de-servico/${ordersByIntake.get(item.id)!.id}`}
                            className="text-ui font-semibold text-brand-600 hover:text-brand-700 hover:underline"
                          >
                            {formatServiceOrderNumber(ordersByIntake.get(item.id)!.number)}
                          </Link>
                        ) : serviceOrderAccess.allowed ? (
                          <Link
                            href={`/ordens-de-servico/nova?equipamento=${item.equipmentId}&recebimento=${item.id}`}
                            className="text-ui font-semibold text-brand-600 hover:text-brand-700 hover:underline"
                          >
                            Criar Ordem de Servico
                          </Link>
                        ) : (
                          <Link
                            href={`/equipamentos/${item.equipmentId}`}
                            className="text-ui font-semibold text-brand-600 hover:text-brand-700 hover:underline"
                          >
                            Ver equipamento
                          </Link>
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>

            <CardList label="Recebimentos desta unidade" className="md:hidden">
              {result.items.map((item) => (
                <CardListItem key={item.id}>
                  <p className="font-medium text-ink-900">
                    {equipmentTitle({
                      kind: item.equipmentKind,
                      brand: item.equipmentBrand,
                      model: item.equipmentModel,
                    })}
                  </p>
                  <p className="text-small text-ink-500">
                    {item.customerName} · {formatter.format(item.receivedAt)}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4">
                    <Link
                      href={`/equipamentos/${item.equipmentId}`}
                      className="touch-target inline-flex items-center text-ui font-semibold text-brand-600"
                    >
                      Ver equipamento
                    </Link>
                    {ordersByIntake.has(item.id) ? (
                      <Link
                        href={`/ordens-de-servico/${ordersByIntake.get(item.id)!.id}`}
                        className="touch-target inline-flex items-center text-ui font-semibold text-brand-600"
                      >
                        {formatServiceOrderNumber(ordersByIntake.get(item.id)!.number)}
                      </Link>
                    ) : serviceOrderAccess.allowed ? (
                      <Link
                        href={`/ordens-de-servico/nova?equipamento=${item.equipmentId}&recebimento=${item.id}`}
                        className="touch-target inline-flex items-center text-ui font-semibold text-brand-600"
                      >
                        Criar Ordem de Servico
                      </Link>
                    ) : null}
                  </div>
                </CardListItem>
              ))}
            </CardList>

            <Pagination
              page={result.page}
              pageCount={result.totalPages}
              hrefFor={(page) => `/recebimentos?pagina=${page}`}
            />
          </CardBody>
        )}
      </Card>
    </div>
  );
}
