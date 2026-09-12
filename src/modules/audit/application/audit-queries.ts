import 'server-only';
import { desc } from 'drizzle-orm';
import { getDb } from '@/core/db/client';
import { scopedWhere } from '@/core/db/tenant-scoped';
import { auditLogs } from '@/modules/audit/infrastructure/schema';
import type { TenantContext } from '@/modules/tenancy/domain/tenant-context';

export interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  userId: string | null;
  correlationId: string | null;
  origin: string;
  createdAt: Date;
}

/** Ultimas acoes auditadas do tenant da sessao. */
export async function listRecentAudit(context: TenantContext, limit = 50): Promise<AuditEntry[]> {
  return getDb()
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      userId: auditLogs.userId,
      correlationId: auditLogs.correlationId,
      origin: auditLogs.origin,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .where(scopedWhere(context, auditLogs.tenantId))
    .orderBy(desc(auditLogs.createdAt))
    .limit(Math.min(limit, 200));
}
