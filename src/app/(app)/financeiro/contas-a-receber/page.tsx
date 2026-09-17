import type { Metadata } from 'next';
import { requireAccessForPage } from '@/modules/access-control/application/guard';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { FEATURES } from '@/modules/features/domain/catalog';
import { TitleListPage } from '../title-list';

export const metadata: Metadata = { title: 'Contas a receber' };

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Contas a receber (Prompt 12, item 65).
 *
 * A rota existe separada da de contas a pagar mesmo compartilhando a tela: o
 * endereco e o que a pessoa guarda nos favoritos, manda no grupo e digita de
 * cabeca. `/financeiro?direcao=receivable` seria a mesma coisa para a maquina
 * e pior para quem usa.
 */
export default async function ReceivablesPage({ searchParams }: PageProps) {
  const { context } = await requireAccessForPage(FEATURES.FINANCE_CORE, PERMISSIONS.FINANCE_VIEW);
  return <TitleListPage context={context} direction="receivable" params={await searchParams} />;
}
