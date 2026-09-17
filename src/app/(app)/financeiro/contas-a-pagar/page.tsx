import type { Metadata } from 'next';
import { requireAccessForPage } from '@/modules/access-control/application/guard';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { FEATURES } from '@/modules/features/domain/catalog';
import { TitleListPage } from '../title-list';

export const metadata: Metadata = { title: 'Contas a pagar' };

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Contas a pagar (Prompt 12, item 66). Mesma tela, direcao oposta. */
export default async function PayablesPage({ searchParams }: PageProps) {
  const { context } = await requireAccessForPage(FEATURES.FINANCE_CORE, PERMISSIONS.FINANCE_VIEW);
  return <TitleListPage context={context} direction="payable" params={await searchParams} />;
}
