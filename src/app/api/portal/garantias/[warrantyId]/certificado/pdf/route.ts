import { NextResponse } from 'next/server';
import { runWithContext } from '@/core/context/request-context';
import { isAppError } from '@/core/errors';
import { logger } from '@/core/logging/logger';
import { getPortalContext } from '@/modules/portal/application/portal-context';
import { readPortalWarrantyCertificate } from '@/modules/portal/application/portal-warranty-certificate-service';

/**
 * DOWNLOAD DO CERTIFICADO PELO PORTAL — espelha
 * `api/garantias/[warrantyId]/certificado/pdf/route.ts`, trocando sessao
 * interna por sessao do Portal e `authorize()` por ownership.
 *
 * TUDO responde 404, nunca 403 (Prompt 17, item 46): nao ha diferenca
 * observavel entre "nao existe", "e de outro cliente" e "o modulo de
 * Garantias esta desligado para esta empresa".
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ warrantyId: string }> },
) {
  const { warrantyId } = await params;

  return runWithContext({ origin: 'web' }, async () => {
    const context = await getPortalContext();
    if (!context) return new NextResponse(null, { status: 401 });

    try {
      const pdf = await readPortalWarrantyCertificate(context, warrantyId);

      return new NextResponse(new Uint8Array(pdf.bytes), {
        status: 200,
        headers: {
          'Content-Type': pdf.mimeType,
          'Content-Length': String(pdf.byteSize),
          'Content-Disposition': `attachment; filename="${pdf.filename}"`,
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    } catch (error) {
      if (isAppError(error)) return new NextResponse(null, { status: 404 });

      logger.error('Falha ao servir certificado em PDF pelo Portal', {
        module: 'portal',
        operation: 'downloadWarrantyCertificatePdf',
        warrantyId,
        error: error instanceof Error ? error.message : String(error),
      });
      return new NextResponse(null, { status: 500 });
    }
  });
}
