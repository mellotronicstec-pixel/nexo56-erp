import { NextResponse } from 'next/server';
import { runWithContext } from '@/core/context/request-context';
import { isAppError } from '@/core/errors';
import { logger } from '@/core/logging/logger';
import { getCurrentContext } from '@/modules/auth/application/current-context';
import { readCertificatePdf } from '@/modules/warranties/application/warranty-certificate-pdf-service';

/**
 * DOWNLOAD DO CERTIFICADO EM PDF (Prompt 13.1, itens 28 a 33 e 36).
 *
 * POSSUIR A URL NAO E AUTORIZACAO (item 30). Cada byte servido aqui passa por
 * quatro perguntas, todas no BACKEND: ha sessao valida? a empresa tem o modulo
 * de Garantias disponivel? a pessoa tem `warranties.view`? a garantia e da
 * empresa e de uma unidade que ela acessa?
 *
 * As tres ultimas o caso de uso responde por conta propria — esta rota nao
 * reimplementa autorizacao, ela apenas traduz o resultado em HTTP.
 *
 * GARANTIA DE OUTRA EMPRESA RESPONDE 404, igual a inexistente: devolver 403
 * confirmaria que aquele certificado existe.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ warrantyId: string }> },
) {
  const { warrantyId } = await params;

  return runWithContext({ origin: 'web' }, async () => {
    const context = await getCurrentContext();
    if (!context) return new NextResponse(null, { status: 401 });

    try {
      const pdf = await readCertificatePdf(context, warrantyId);

      return new NextResponse(new Uint8Array(pdf.bytes), {
        status: 200,
        headers: {
          'Content-Type': pdf.mimeType,
          'Content-Length': String(pdf.byteSize),
          /**
           * O nome do arquivo sai do NUMERO da garantia, nunca do nome do
           * cliente (itens 27 e 28): ele vai parar na pasta de downloads e em
           * anexo de e-mail. `attachment` porque o certificado e para guardar
           * e imprimir; visualizar tem tela propria.
           *
           * O nome e montado pelo dominio a partir de uma faixa restrita de
           * caracteres, entao nao ha como injetar cabecalho por aqui.
           */
          'Content-Disposition': `attachment; filename="${pdf.filename}"`,
          /** Documento de um cliente: nunca em cache compartilhado. */
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    } catch (error) {
      if (isAppError(error)) {
        /**
         * Falta de permissao e de feature respondem 403; qualquer outra
         * recusa de negocio vira 404, para nao confirmar a existencia do
         * registro a quem nao deveria enxerga-lo.
         */
        const status = error.code === 'AUTHORIZATION_ERROR' ? 403 : 404;
        return new NextResponse(null, { status });
      }

      logger.error('Falha ao servir certificado em PDF', {
        module: 'warranties',
        operation: 'downloadCertificatePdf',
        warrantyId,
        error: error instanceof Error ? error.message : String(error),
      });
      return new NextResponse(null, { status: 500 });
    }
  });
}
