import { sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/core/db/client';

/**
 * Health check (Prompt 01, item 76).
 *
 *   GET /api/health            -> liveness (processo vivo)
 *   GET /api/health?check=ready -> readiness (inclui o banco)
 *
 * Nao expoe versao de banco, host, credencial nem qualquer detalhe interno.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse> {
  const wantsReadiness = new URL(request.url).searchParams.get('check') === 'ready';

  if (!wantsReadiness) {
    return NextResponse.json({ status: 'ok' }, { status: 200 });
  }

  try {
    await getDb().execute(sql`SELECT 1`);
    return NextResponse.json({ status: 'ok', database: 'ok' }, { status: 200 });
  } catch {
    // Mensagem deliberadamente opaca: o detalhe fica no log estruturado.
    return NextResponse.json({ status: 'degraded', database: 'unavailable' }, { status: 503 });
  }
}
