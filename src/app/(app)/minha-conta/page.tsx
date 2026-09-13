import type { Metadata } from 'next';
import { Badge, Card, CardBody, CardHeader, PageHeader } from '@/design-system/components';
import { requireContextForPage } from '@/modules/auth/application/current-context';
import { MIN_PASSWORD_LENGTH } from '@/modules/auth/application/password-service';
import { listOwnSessions } from '@/modules/auth/application/session-management';
import { listUnits } from '@/modules/tenancy/application/tenancy-queries';
import { effectivePermissions } from '@/modules/tenancy/domain/tenant-context';
import { ChangePasswordForm, SessionActions } from './account-forms';
import { changePasswordAction, revokeOtherSessionsAction, revokeSessionAction } from './actions';

export const metadata: Metadata = { title: 'Minha conta' };

/**
 * Conta do proprio usuario (Prompt 03, itens 35, 38 e 71).
 *
 * Nao exige permissao administrativa: qualquer pessoa autenticada gerencia a
 * propria senha e as proprias sessoes.
 */
export default async function MyAccountPage() {
  const context = await requireContextForPage();
  const [sessions, units] = await Promise.all([listOwnSessions(context), listUnits(context)]);

  const formatter = new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: context.tenantTimezone,
  });

  const unitName = (id: string) => units.find((unit) => unit.id === id)?.name ?? id;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Minha conta"
        description="Seu acesso, sua senha e seus dispositivos conectados."
        metadata={<span>{context.userEmail}</span>}
      />

      {/* Resumo do acesso efetivo (item 71) */}
      <Card>
        <CardHeader title="Meu acesso" description="Resumo do que vale para voce agora" />
        <CardBody className="space-y-4 text-ui">
          <div>
            <p className="text-ink-500">Unidades autorizadas</p>
            <ul className="mt-1 flex flex-wrap gap-2">
              {context.authorizedUnitIds.length === 0 ? (
                <li className="text-ink-500">Nenhuma</li>
              ) : (
                context.authorizedUnitIds.map((id) => (
                  <li key={id}>
                    <Badge tone={id === context.activeUnitId ? 'brand' : 'neutral'}>
                      {unitName(id)}
                      {id === context.activeUnitId ? ' · ativa' : ''}
                    </Badge>
                  </li>
                ))
              )}
            </ul>
          </div>

          <div>
            <p className="text-ink-500">Perfis em todas as unidades autorizadas</p>
            <ul className="mt-1 flex flex-wrap gap-2">
              {context.tenantRoles.length === 0 ? (
                <li className="text-ink-500">Nenhum</li>
              ) : (
                context.tenantRoles.map((role) => (
                  <li key={role.roleId}>
                    <Badge tone="brand">{role.roleName}</Badge>
                  </li>
                ))
              )}
            </ul>
          </div>

          <div>
            <p className="text-ink-500">Perfis em unidade especifica</p>
            <ul className="mt-1 flex flex-wrap gap-2">
              {context.unitRoles.length === 0 ? (
                <li className="text-ink-500">Nenhum</li>
              ) : (
                context.unitRoles.map((role) => (
                  <li key={`${role.roleId}-${role.unitId}`}>
                    <Badge>
                      {role.roleName} · {unitName(role.unitId)}
                    </Badge>
                  </li>
                ))
              )}
            </ul>
          </div>

          <div>
            <p className="text-ink-500">
              Permissoes efetivas na unidade ativa: {effectivePermissions(context).size}
            </p>
          </div>
        </CardBody>
      </Card>

      {/* Ancora usada pelo menu da conta na topbar (Prompt 04, item 38). */}
      <Card id="seguranca" className="scroll-mt-20">
        <CardHeader title="Alterar senha" />
        <CardBody>
          <ChangePasswordForm action={changePasswordAction} minLength={MIN_PASSWORD_LENGTH} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Sessoes ativas"
          description={`${sessions.length} sessao(oes). Encerrar uma sessao vale imediatamente no servidor.`}
        />
        <CardBody>
          <SessionActions
            revokeOne={revokeSessionAction}
            revokeOthers={revokeOtherSessionsAction}
            sessions={sessions.map((session) => ({
              id: session.id,
              isCurrent: session.isCurrent,
              userAgentSummary: session.userAgentSummary,
              lastUsed: formatter.format(session.lastUsedAt),
              expires: formatter.format(session.expiresAt),
            }))}
          />
        </CardBody>
      </Card>
    </div>
  );
}
