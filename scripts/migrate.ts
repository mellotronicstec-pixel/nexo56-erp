/**
 * Aplica as migrations versionadas (Prompt 01, item 47).
 *
 * Usado tanto em desenvolvimento quanto no deploy da Hostinger.
 * Nunca usa `push`: o historico em ./drizzle e a fonte da verdade do schema.
 */
import './_bootstrap-env';
import { drizzle } from 'drizzle-orm/mysql2';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import mysql from 'mysql2/promise';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL ausente. Configure o ambiente antes de migrar.');

  const target = url.replace(/\/\/([^:]+):[^@]*@/, '//$1:***@');
  console.log(`[migrate] aplicando migrations em ${target}`);

  const connection = await mysql.createConnection({
    uri: url,
    timezone: 'Z',
    multipleStatements: true,
  });
  const db = drizzle(connection);

  const startedAt = Date.now();
  await migrate(db, { migrationsFolder: './drizzle' });
  console.log(`[migrate] concluido em ${Date.now() - startedAt}ms`);

  await connection.end();
}

main().catch((error: unknown) => {
  console.error('[migrate] FALHOU:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
