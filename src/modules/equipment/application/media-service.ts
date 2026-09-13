import 'server-only';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/core/db/client';
import { runInTransaction } from '@/core/db/unit-of-work';
import { getFileStorage } from '@/core/storage/file-storage';
import { detectImage } from '@/core/storage/image-validation';
import { NotFoundError, ValidationError } from '@/core/errors';
import { newId } from '@/core/ids/id';
import { logger } from '@/core/logging/logger';
import { AUDIT_ACTIONS, recordAudit } from '@/modules/audit/application/audit-service';
import { MEDIA_KINDS, type MediaKind } from '@/modules/equipment/domain/equipment';
import {
  equipment,
  equipmentIntakes,
  equipmentMedia,
} from '@/modules/equipment/infrastructure/schema';
import { EVENT_TYPES } from '@/modules/events/domain/event';
import type { TenantContext } from '@/modules/tenancy/domain/tenant-context';

/**
 * Fotos de equipamento (Prompt 06, itens 21 a 32).
 *
 * O CAMINHO SEGURO E O UNICO CAMINHO:
 *
 *   1. o tipo real sai dos BYTES, nao do cabecalho nem da extensao;
 *   2. o tamanho e conferido no servidor;
 *   3. a chave do arquivo e gerada aqui — o nome enviado nunca vira caminho;
 *   4. o arquivo vai para fora de `public/`;
 *   5. a leitura passa por rota autenticada, que confere tenant e permissao.
 */

export async function attachMedia(
  context: TenantContext,
  input: {
    equipmentId: string;
    intakeId?: string | null;
    kind: string;
    caption?: string | null;
    data: Buffer;
    /** Nome enviado pelo navegador. Usado SO para mensagem — nunca como caminho. */
    originalName?: string;
  },
): Promise<{ mediaId: string }> {
  const db = getDb();

  const [target] = await db
    .select({ id: equipment.id })
    .from(equipment)
    .where(and(eq(equipment.tenantId, context.tenantId), eq(equipment.id, input.equipmentId)))
    .limit(1);

  if (!target) throw new NotFoundError('Equipamento nao encontrado.');

  // O recebimento, quando informado, precisa ser do MESMO tenant (item 107).
  if (input.intakeId) {
    const [intake] = await db
      .select({ id: equipmentIntakes.id })
      .from(equipmentIntakes)
      .where(
        and(
          eq(equipmentIntakes.tenantId, context.tenantId),
          eq(equipmentIntakes.id, input.intakeId),
        ),
      )
      .limit(1);

    if (!intake) throw new NotFoundError('Recebimento nao encontrado.');
  }

  // Assinatura dos bytes: e aqui que `virus.php` renomeado para `foto.jpg` cai.
  const detected = detectImage(input.data);

  const kind: MediaKind = (MEDIA_KINDS as readonly string[]).includes(input.kind)
    ? (input.kind as MediaKind)
    : 'general';

  const stored = await getFileStorage().save({
    data: input.data,
    extension: detected.extension,
    // O escopo inclui o tenant: os arquivos de empresas diferentes nem
    // compartilham diretorio.
    scope: `equipment/${context.tenantId}`,
  });

  const mediaId = newId();
  const now = new Date();

  await runInTransaction(async (tx, emit) => {
    await tx.insert(equipmentMedia).values({
      id: mediaId,
      tenantId: context.tenantId,
      equipmentId: input.equipmentId,
      intakeId: input.intakeId ?? null,
      kind,
      storageKey: stored.key,
      mimeType: detected.mime,
      byteSize: stored.byteSize,
      width: detected.width,
      height: detected.height,
      checksum: stored.checksum,
      caption: input.caption?.trim() || null,
      createdBy: context.userId,
      createdAt: now,
    });

    /**
     * A auditoria guarda METADADO, nunca a imagem (item 76): referencia, tipo,
     * tamanho e ator. Copiar bytes para a trilha inflaria a tabela e duplicaria
     * a exposicao do que a foto contem.
     */
    await recordAudit(
      {
        action: AUDIT_ACTIONS.EQUIPMENT_MEDIA_ADDED,
        entityType: 'equipment_media',
        entityId: mediaId,
        tenantId: context.tenantId,
        unitId: context.activeUnitId,
        userId: context.userId,
        after: {
          equipmentId: input.equipmentId,
          intakeId: input.intakeId ?? null,
          kind,
          mimeType: detected.mime,
          byteSize: stored.byteSize,
        },
      },
      tx,
    );

    await emit({
      type: EVENT_TYPES.EQUIPMENT_MEDIA_ADDED,
      tenantId: context.tenantId,
      payload: { mediaId, equipmentId: input.equipmentId, kind },
    });
  });

  logger.info('Foto de equipamento anexada', {
    module: 'equipment',
    operation: 'attachMedia',
    mediaId,
    mimeType: detected.mime,
    byteSize: stored.byteSize,
    storageProvider: getFileStorage().name,
  });

  return { mediaId };
}

/**
 * Le os bytes de uma midia, SEMPRE dentro do tenant.
 *
 * Usada pela rota autenticada de imagem. Um ID valido de outra empresa nao
 * encontra nada — a mesma resposta de um ID inexistente.
 */
export async function readMedia(
  context: TenantContext,
  mediaId: string,
): Promise<{ data: Buffer; mimeType: string; byteSize: number } | null> {
  const [media] = await getDb()
    .select()
    .from(equipmentMedia)
    .where(and(eq(equipmentMedia.tenantId, context.tenantId), eq(equipmentMedia.id, mediaId)))
    .limit(1);

  if (!media) return null;

  const data = await getFileStorage().read(media.storageKey);
  return { data, mimeType: media.mimeType, byteSize: media.byteSize };
}

export async function removeMedia(context: TenantContext, mediaId: string): Promise<void> {
  const db = getDb();

  const [media] = await db
    .select()
    .from(equipmentMedia)
    .where(and(eq(equipmentMedia.tenantId, context.tenantId), eq(equipmentMedia.id, mediaId)))
    .limit(1);

  if (!media) throw new NotFoundError('Foto nao encontrada.');

  await runInTransaction(async (tx) => {
    await tx
      .delete(equipmentMedia)
      .where(and(eq(equipmentMedia.tenantId, context.tenantId), eq(equipmentMedia.id, mediaId)));

    await recordAudit(
      {
        action: AUDIT_ACTIONS.EQUIPMENT_MEDIA_REMOVED,
        entityType: 'equipment_media',
        entityId: mediaId,
        tenantId: context.tenantId,
        userId: context.userId,
        before: { equipmentId: media.equipmentId, kind: media.kind, byteSize: media.byteSize },
      },
      tx,
    );
  });

  /**
   * O arquivo sai DEPOIS do commit: se a transacao falhasse, apagar antes
   * deixaria uma linha apontando para um arquivo que nao existe mais. A ordem
   * inversa, no pior caso, deixa um arquivo orfao — que e recuperavel.
   */
  await getFileStorage()
    .remove(media.storageKey)
    .catch((error: unknown) => {
      logger.warn('Arquivo de midia nao pode ser removido do storage', {
        module: 'equipment',
        operation: 'removeMedia',
        mediaId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
}

/** Valida o tipo de midia informado pela interface. */
export function parseMediaKind(value: string): MediaKind {
  return (MEDIA_KINDS as readonly string[]).includes(value) ? (value as MediaKind) : 'general';
}

export { ValidationError };
