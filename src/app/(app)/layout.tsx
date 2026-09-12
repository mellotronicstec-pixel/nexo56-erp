import { redirect } from 'next/navigation';
import { runWithContext } from '@/core/context/request-context';
import { getCurrentContext } from '@/modules/auth/application/current-context';
import { checkManyAccess } from '@/modules/features/application/effective-access';
import { findUnitById } from '@/modules/tenancy/application/tenancy-queries';
import { NAV_SECTIONS, type NavSection } from './navigation';
import { Shell } from './shell';

/**
 * Layout autenticado.
 *
 * Monta o menu a partir do Effective Access: um item so aparece se a feature
 * existe, o plano permite, o tenant ativou e o usuario tem permissao. Ainda
 * assim cada pagina revalida por conta propria — o menu e conveniencia de UX,
 * nao barreira de seguranca (Prompt 01, item 27).
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const context = await getCurrentContext();
  if (!context) redirect('/login');

  return runWithContext(
    { origin: 'web', tenantId: context.tenantId, userId: context.userId },
    async () => {
      const queries = NAV_SECTIONS.flatMap((section) =>
        section.items.map((item) => ({ featureKey: item.featureKey, permission: item.permission })),
      );
      const decisions = await checkManyAccess(context, queries);

      const sections: NavSection[] = NAV_SECTIONS.map((section) => ({
        title: section.title,
        items: section.items.filter((item) => decisions.get(item.featureKey)?.allowed ?? false),
      })).filter((section) => section.items.length > 0);

      const unit = context.unitId ? await findUnitById(context, context.unitId) : null;

      return (
        <Shell
          sections={sections}
          user={{
            name: context.userName,
            email: context.userEmail,
            tenantName: context.tenantName,
            unitName: unit?.name ?? null,
          }}
        >
          {children}
        </Shell>
      );
    },
  );
}
