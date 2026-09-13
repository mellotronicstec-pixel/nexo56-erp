import { NextResponse } from 'next/server';
import { runWithContext } from '@/core/context/request-context';
import { logger } from '@/core/logging/logger';
import { can } from '@/modules/access-control/application/authorization-service';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { getCurrentContext } from '@/modules/auth/application/current-context';
import { readMedia } from '@/modules/equipment/application/media-service';
import { FEATURES } from '@/modules/features/domain/catalog';

/**
 * Entrega de imagem de equipamento (Prompt 06, item 32).
 *
 * POR QUE ESTA ROTA EXISTE
 *
 * Arquivo em `public/` fica acessivel a quem descobrir a URL — e foto de
 * equipamento pode conter a etiqueta com dados do cliente, uma nota fiscal
 * sobre a bancada ou o interior da casa de alguem. Aqui cada byte servido
 * passa por tres perguntas: ha sessao valida? a pessoa pode ver equipamentos?
 * a imagem e do tenant dela?
 *
 * A resposta a um ID de outra empresa e 404 — igual a de um ID inexistente.
 * Devolver 403 confirmaria que aquela imagem existe.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ mediaId: string }> }) {
  const { mediaId } = await params;

  return runWithContext({ origin: 'web' }, async () => {
    const context = await getCurrentContext();
    if (!context) return new NextResponse(null, { status: 401 });

    const decision = await can(context, {
      permission: PERMISSIONS.EQUIPMENT_VIEW,
      featureKey: FEATURES.CORE_EQUIPMENT,
    });
    if (!decision.allowed) return new NextResponse(null, { status: 403 });

    try {
      const media = await readMedia(context, mediaId);
      if (!media) return new NextResponse(null, { status: 404 });

      return new NextResponse(new Uint8Array(media.data), {
        status: 200,
        headers: {
          'Content-Type': media.mimeType,
          'Content-Length': String(media.byteSize),
          /**
           * `private`: a imagem pertence a uma sessao autenticada e nao pode
           * ser guardada por proxy compartilhado. `no-store` seria pesado
           * demais para foto que nao muda; `private` com validacao curta
           * equilibra sem vazar.
           */
          'Cache-Control': 'private, max-age=300, must-revalidate',
          'Content-Disposition': 'inline',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    } catch (error) {
      logger.error('Falha ao servir midia de equipamento', {
        module: 'equipment',
        operation: 'serveMedia',
        mediaId,
        error: error instanceof Error ? error.message : String(error),
      });
      return new NextResponse(null, { status: 404 });
    }
  });
}
