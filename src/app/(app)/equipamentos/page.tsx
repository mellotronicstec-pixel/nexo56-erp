import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Badge,
  Card,
  CardBody,
  CardList,
  CardListItem,
  EmptyState,
  FilterBar,
  linkButtonClass,
  PageHeader,
  Pagination,
  SearchField,
  Select,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@/design-system/components';
import { IconEquipment, IconPlus, IconSearch } from '@/design-system/icons';
import { requireAccessForPage } from '@/modules/access-control/application/guard';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { listEquipment } from '@/modules/equipment/application/equipment-queries';
import {
  EQUIPMENT_STATUS_LABEL,
  VOLTAGE_LABEL,
  equipmentTitle,
} from '@/modules/equipment/domain/equipment';
import { FEATURES } from '@/modules/features/domain/catalog';
import { hasPermission } from '@/modules/tenancy/domain/tenant-context';

export const metadata: Metadata = { title: 'Equipamentos' };

/**
 * Listagem de equipamentos (Prompt 06, itens 53, 97 e 99).
 *
 * TENANT-SCOPED, nunca por unidade: o aparelho pertence a empresa e ao cliente,
 * e precisa aparecer em qualquer loja onde o cliente volte a ser atendido.
 */
export default async function EquipmentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { context } = await requireAccessForPage(
    FEATURES.CORE_EQUIPMENT,
    PERMISSIONS.EQUIPMENT_VIEW,
  );

  const params = await searchParams;
  const single = (value: string | string[] | undefined) => {
    const raw = Array.isArray(value) ? value[0] : value;
    return raw?.trim() || undefined;
  };

  const query = single(params.q);
  const status = single(params.situacao);
  const pageParam = Number(single(params.pagina) ?? '1');

  const result = await listEquipment(context, {
    query,
    status: status === 'active' || status === 'inactive' ? status : undefined,
    page: Number.isInteger(pageParam) && pageParam > 0 ? pageParam : 1,
  });

  const canManage = hasPermission(context, PERMISSIONS.EQUIPMENT_MANAGE);
  const isFiltered = Boolean(query || status);

  const hrefForPage = (page: number) => {
    const next = new URLSearchParams();
    if (query) next.set('q', query);
    if (status) next.set('situacao', status);
    next.set('pagina', String(page));
    return `/equipamentos?${next.toString()}`;
  };

  const applied = [
    query ? `busca: ${query}` : null,
    status ? `situacao: ${status === 'active' ? 'ativo' : 'inativo'}` : null,
  ].filter((value): value is string => value !== null);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Equipamentos"
        description="Aparelhos dos clientes desta empresa. O cadastro vale para todas as unidades."
        breadcrumbs={[{ label: 'Equipamentos' }]}
        metadata={<span>{result.total} equipamento(s)</span>}
        actions={
          canManage ? (
            <Link href="/equipamentos/novo" className={linkButtonClass('primary')}>
              <IconPlus size={18} />
              Novo equipamento
            </Link>
          ) : null
        }
      />

      <Card>
        <FilterBar
          action="/equipamentos"
          applied={applied}
          onClearHref={isFiltered ? '/equipamentos' : undefined}
        >
          <div className="sm:w-80">
            <SearchField
              id="busca-equipamento"
              name="q"
              label="Buscar equipamento"
              labelHidden={false}
              defaultValue={query ?? ''}
              placeholder="Tipo, marca, modelo ou numero de serie"
            />
          </div>

          <div className="sm:w-44">
            <label
              htmlFor="filtro-situacao"
              className="mb-1.5 block text-ui font-medium text-ink-700"
            >
              Situacao
            </label>
            <Select id="filtro-situacao" name="situacao" defaultValue={status ?? ''}>
              <option value="">Todas</option>
              <option value="active">Ativo</option>
              <option value="inactive">Inativo</option>
            </Select>
          </div>

          <button type="submit" className={linkButtonClass('secondary', 'md', 'h-10')}>
            <IconSearch size={18} />
            Buscar
          </button>
        </FilterBar>

        {result.items.length === 0 ? (
          <EmptyState
            icon={isFiltered ? <IconSearch /> : <IconEquipment />}
            title={isFiltered ? 'Nenhum equipamento encontrado' : 'Nenhum equipamento cadastrado'}
            description={
              isFiltered
                ? 'Nenhum equipamento corresponde aos filtros. Limpe os filtros para ver todos.'
                : 'Cadastre o primeiro equipamento a partir da ficha de um cliente.'
            }
          />
        ) : (
          <CardBody className="p-0">
            <div className="hidden md:block">
              <Table caption="Equipamentos desta empresa">
                <THead>
                  <TR>
                    <TH>Equipamento</TH>
                    <TH>Cliente</TH>
                    <TH>Numero de serie</TH>
                    <TH>Tensao</TH>
                    <TH>Situacao</TH>
                    <TH align="right" srOnly>
                      Acoes
                    </TH>
                  </TR>
                </THead>
                <TBody>
                  {result.items.map((item) => (
                    <TR key={item.id}>
                      <TD className="font-medium text-ink-900">
                        {equipmentTitle(item)}
                        <span className="block text-small font-normal text-ink-500">
                          {item.kind}
                        </span>
                      </TD>
                      <TD>{item.customerName}</TD>
                      <TD className="whitespace-nowrap">
                        {item.serial ?? <span className="text-ink-400">—</span>}
                      </TD>
                      <TD className="whitespace-nowrap">{VOLTAGE_LABEL[item.voltage]}</TD>
                      <TD>
                        <Badge tone={item.status === 'active' ? 'success' : 'neutral'}>
                          {EQUIPMENT_STATUS_LABEL[item.status]}
                        </Badge>
                      </TD>
                      <TD align="right">
                        <Link
                          href={`/equipamentos/${item.id}`}
                          className="text-ui font-semibold text-brand-600 hover:text-brand-700 hover:underline"
                        >
                          Abrir
                          <span className="sr-only"> a ficha de {equipmentTitle(item)}</span>
                        </Link>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>

            <CardList label="Equipamentos desta empresa" className="md:hidden">
              {result.items.map((item) => (
                <CardListItem key={item.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-ink-900">{equipmentTitle(item)}</p>
                      <p className="truncate text-small text-ink-500">
                        {item.kind} · {item.customerName}
                      </p>
                      {item.serial ? (
                        <p className="truncate text-small text-ink-500">Serie {item.serial}</p>
                      ) : null}
                    </div>
                    <Badge tone={item.status === 'active' ? 'success' : 'neutral'}>
                      {EQUIPMENT_STATUS_LABEL[item.status]}
                    </Badge>
                  </div>
                  <Link
                    href={`/equipamentos/${item.id}`}
                    className="touch-target mt-2 inline-flex items-center text-ui font-semibold text-brand-600"
                  >
                    Abrir ficha
                    <span className="sr-only"> de {equipmentTitle(item)}</span>
                  </Link>
                </CardListItem>
              ))}
            </CardList>

            <Pagination page={result.page} pageCount={result.totalPages} hrefFor={hrefForPage} />
          </CardBody>
        )}
      </Card>
    </div>
  );
}
