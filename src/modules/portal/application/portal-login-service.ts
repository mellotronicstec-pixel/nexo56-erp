import 'server-only';
import { and, eq, sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { affectedRows } from '@/core/db/affected-rows';
import { getDb } from '@/core/db/client';
import { getEnv } from '@/core/config/env';
import { AuthenticationError } from '@/core/errors';
import { newId } from '@/core/ids/id';
import { logger } from '@/core/logging/logger';
import { getRateLimitStore, RATE_LIMITS } from '@/core/rate-limit/rate-limiter';
import { AUDIT_ACTIONS, recordAudit } from '@/modules/audit/application/audit-service';
import { hashToken } from '@/modules/auth/application/session-service';
import type { CommunicationChannel } from '@/modules/communications/domain/communication';
import { getCommunicationProvider } from '@/modules/communications/infrastructure/provider-registry';
import { customerContacts, customers } from '@/modules/customers/infrastructure/schema';
import { checkFeatureEnabledForTenant } from '@/modules/features/application/effective-access';
import { FEATURES } from '@/modules/features/domain/catalog';
import { tenants } from '@/modules/tenancy/infrastructure/schema';
import {
  normalizeLoginContact,
  PORTAL_LOGIN_TOKEN_BYTES,
  PORTAL_LOGIN_TOKEN_TTL_MINUTES,
} from '@/modules/portal/domain/portal';
import { portalIdentities, portalLoginTokens } from '@/modules/portal/infrastructure/schema';
import { createPortalSession, type CreatedPortalSession } from './portal-session-service';

/**
 * AUTENTICACAO DO PORTAL — link magico (ADR-080).
 *
 * A REGRA MAIS IMPORTANTE DESTE ARQUIVO: `requestPortalLogin` devolve
 * SEMPRE a mesma coisa (nada), no mesmo formato, para contato que existe,
 * contato que nao existe, contato de cliente inativo e contato bloqueado
 * (Prompt 17, item 17). Quem chama nunca aprende, pela resposta, se um
 * e-mail ou telefone tem cadastro no Nexo56.
 */

function loginPath(token: string): string {
  return `/portal/entrar/${token}`;
}

/**
 * Pede o link. Um contato pode bater em VARIOS tenants (o mesmo telefone e
 * cliente de duas assistencias — item 23) — cada um recebe o SEU link, para
 * a SUA empresa, sem que o outro saiba da existencia do primeiro.
 */
export async function requestPortalLogin(rawContact: string): Promise<void> {
  const contact = normalizeLoginContact(rawContact);
  const rateLimitKey = `portal-login:${contact?.valueNormalized ?? rawContact.trim().toLowerCase()}`;

  const limit = await getRateLimitStore().hit(
    rateLimitKey,
    RATE_LIMITS.portalLoginRequest.limit,
    RATE_LIMITS.portalLoginRequest.windowMs,
  );

  // Contato mal formado ou limite estourado: mesmo silencio de sempre.
  if (!contact || !limit.allowed) {
    logger.info('Pedido de link do Portal nao prosseguiu', {
      module: 'portal',
      operation: 'requestPortalLogin',
      reason: !contact ? 'invalid_contact' : 'rate_limited',
    });
    return;
  }

  const db = getDb();
  const matches = await db
    .select({
      customerId: customers.id,
      customerStatus: customers.status,
      tenantId: customers.tenantId,
      tenantStatus: tenants.status,
      planId: tenants.planId,
      isWhatsapp: customerContacts.isWhatsapp,
    })
    .from(customerContacts)
    .innerJoin(customers, eq(customers.id, customerContacts.customerId))
    .innerJoin(tenants, eq(tenants.id, customers.tenantId))
    .where(
      and(
        eq(customerContacts.valueNormalized, contact.valueNormalized),
        eq(customerContacts.type, contact.kind),
      ),
    );

  for (const match of matches) {
    if (match.customerStatus !== 'active' || match.tenantStatus !== 'active') continue;

    const access = await checkFeatureEnabledForTenant(
      { tenantId: match.tenantId, planId: match.planId },
      FEATURES.CUSTOMER_PORTAL,
    );
    if (!access.allowed) continue;

    const [identity] = await db
      .select({ status: portalIdentities.status })
      .from(portalIdentities)
      .where(eq(portalIdentities.customerId, match.customerId))
      .limit(1);
    if (identity?.status === 'blocked') continue;

    const channel: CommunicationChannel =
      contact.kind === 'email' ? 'email' : match.isWhatsapp ? 'whatsapp' : 'sms';

    await issueAndSendLoginLink({
      tenantId: match.tenantId,
      customerId: match.customerId,
      channel,
      recipient: contact.valueNormalized,
    });
  }
}

async function issueAndSendLoginLink(input: {
  tenantId: string;
  customerId: string;
  channel: CommunicationChannel;
  recipient: string;
}): Promise<void> {
  const db = getDb();
  const token = randomBytes(PORTAL_LOGIN_TOKEN_BYTES).toString('base64url');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + PORTAL_LOGIN_TOKEN_TTL_MINUTES * 60 * 1000);
  const tokenId = newId();

  await db.insert(portalLoginTokens).values({
    id: tokenId,
    tenantId: input.tenantId,
    customerId: input.customerId,
    tokenHash: hashToken(token),
    requestedVia: input.channel,
    expiresAt,
    usedAt: null,
    createdAt: now,
  });

  const link = new URL(loginPath(token), getEnv().APP_URL).toString();
  const provider = getCommunicationProvider();

  /**
   * SEM PROVIDER (producao sem contrato — item 12): a mesma verdade de
   * `communications`. O token existe e continua valido ate expirar; a
   * pessoa pode pedir de novo depois que houver provider configurado.
   */
  if (!provider) {
    logger.warn('Link do Portal nao enviado: nenhum provider configurado', {
      module: 'portal',
      operation: 'issueAndSendLoginLink',
      tenantId: input.tenantId,
    });
    return;
  }

  const result = await provider.send({
    messageId: tokenId,
    channel: input.channel,
    recipient: input.recipient,
    subject: input.channel === 'email' ? 'Acesso ao Portal do Cliente' : null,
    body: `Use este link para entrar no Portal: ${link}\nValido por ${PORTAL_LOGIN_TOKEN_TTL_MINUTES} minutos. Se voce nao pediu, ignore.`,
    attachments: [],
    correlationId: tokenId,
  });

  logger.info('Link do Portal processado', {
    module: 'portal',
    operation: 'issueAndSendLoginLink',
    tenantId: input.tenantId,
    outcome: result.outcome,
  });
}

/**
 * Consome o link (ADR-044: CAS no `UPDATE`). A primeira requisicao a
 * conseguir a trava vence a corrida do duplo clique; a segunda encontra
 * `usedAt` ja preenchido e recebe o MESMO erro generico de link invalido.
 */
export async function consumePortalLoginToken(
  rawToken: string,
): Promise<CreatedPortalSession & { tenantId: string }> {
  const token = rawToken.trim();
  if (!token) throw new AuthenticationError('Link invalido ou expirado.');

  const db = getDb();
  const tokenHash = hashToken(token);

  const [row] = await db
    .select({
      id: portalLoginTokens.id,
      tenantId: portalLoginTokens.tenantId,
      customerId: portalLoginTokens.customerId,
    })
    .from(portalLoginTokens)
    .where(eq(portalLoginTokens.tokenHash, tokenHash))
    .limit(1);
  if (!row) throw new AuthenticationError('Link invalido ou expirado.');

  const consumeResult = await db
    .update(portalLoginTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(portalLoginTokens.id, row.id),
        sql`${portalLoginTokens.usedAt} IS NULL`,
        sql`${portalLoginTokens.expiresAt} > NOW()`,
      ),
    );
  if (affectedRows(consumeResult) !== 1) {
    throw new AuthenticationError('Link invalido ou expirado.');
  }

  const now = new Date();
  const identityId = newId();
  await db
    .insert(portalIdentities)
    .values({
      id: identityId,
      tenantId: row.tenantId,
      customerId: row.customerId,
      status: 'active',
      firstAuthenticatedAt: now,
      lastAuthenticatedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onDuplicateKeyUpdate({
      set: {
        lastAuthenticatedAt: now,
        updatedAt: now,
        firstAuthenticatedAt: sql`COALESCE(${portalIdentities.firstAuthenticatedAt}, ${now})`,
      },
    });

  const [identity] = await db
    .select({ id: portalIdentities.id, status: portalIdentities.status })
    .from(portalIdentities)
    .where(eq(portalIdentities.customerId, row.customerId))
    .limit(1);

  if (!identity || identity.status === 'blocked') {
    throw new AuthenticationError('Link invalido ou expirado.');
  }

  const session = await createPortalSession({
    tenantId: row.tenantId,
    customerId: row.customerId,
    portalIdentityId: identity.id,
  });

  await recordAudit({
    action: AUDIT_ACTIONS.PORTAL_LOGIN_SUCCEEDED,
    entityType: 'portal_identity',
    entityId: identity.id,
    tenantId: row.tenantId,
    userId: null,
  });

  return { ...session, tenantId: row.tenantId };
}
