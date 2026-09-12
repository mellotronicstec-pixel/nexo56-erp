import { redirect } from 'next/navigation';
import { runWithContext } from '@/core/context/request-context';
import { getCurrentContext } from '@/modules/auth/application/current-context';
import { checkManyAccess } from '@/modules/features/application/effective-access';
import { listUnits } from '@/modules/tenancy/application/tenancy-queries';
import { hasPermission } from '@/modules/tenancy/domain/tenant-context';
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
      /**
       * O menu reflete o acesso efetivo (item 64): a feature precisa estar
       * disponivel para a empresa E a permissao precisa valer no contexto atual.
       *
       * Um unico snapshot de features para todos os itens, sem N+1. Ainda assim
       * cada pagina revalida no servidor — o menu e UX, nao barreira.
       */
      const featureDecisions = await checkManyAccess(
        context,
        NAV_SECTIONS.flatMap((section) =>
          section.items.map((item) => ({ featureKey: item.featureKey })),
        ),
      );

      const sections: NavSection[] = NAV_SECTIONS.map((section) => ({
        title: section.title,
        items: section.items.filter((item) => {
          if (!(featureDecisions.get(item.featureKey)?.allowed ?? false)) return false;
          return item.permission === null || hasPermission(context, item.permission);
        }),
      })).filter((section) => section.items.length > 0);

      const units = await listUnits(context);
      const authorizedUnits = units.filter((unit) => context.authorizedUnitIds.includes(unit.id));
      const activeUnit = authorizedUnits.find((unit) => unit.id === context.activeUnitId) ?? null;

      return (
        <Shell
          sections={sections}
          user={{
            name: context.userName,
            email: context.userEmail,
            tenantName: context.tenantName,
            unitName: activeUnit?.name ?? null,
          }}
          units={authorizedUnits.map((unit) => ({ id: unit.id, name: unit.name }))}
          activeUnitId={context.activeUnitId}
        >
          {children}
        </Shell>
      );
    },
  );
}
