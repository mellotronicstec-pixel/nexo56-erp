import { drizzle } from 'drizzle-orm/mysql2';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import mysql from 'mysql2/promise';
import { closeDb } from '@/core/db/client';

/** Aplica as migrations versionadas no banco de teste. */
export async function migrateTestDatabase(): Promise<void> {
  const connection = await mysql.createConnection({
    uri: process.env.TEST_DATABASE_URL as string,
    timezone: 'Z',
    multipleStatements: true,
  });
  await migrate(drizzle(connection), { migrationsFolder: './drizzle' });
  await connection.end();
}

/**
 * Limpa os dados entre testes preservando o SCHEMA.
 * Nunca faz DROP DATABASE nem recria o banco (Prompt 01, itens 48 e 95).
 */
const TABLES_IN_DELETE_ORDER = [
  'audit_logs',
  'domain_events',
  'jobs',
  'sessions',
  'user_roles',
  'role_permissions',
  'user_units',
  'roles',
  'users',
  'units',
  'tenant_features',
  'tenants',
  'plan_entitlements',
  'plans',
  'feature_dependencies',
  'permissions',
  'features',
];

export async function truncateAll(): Promise<void> {
  // Uma conexao dedicada: `FOREIGN_KEY_CHECKS` e variavel de SESSAO, entao
  // usar o pool faria o SET valer para uma conexao e os DELETEs para outras.
  const connection = await mysql.createConnection({
    uri: process.env.TEST_DATABASE_URL as string,
    timezone: 'Z',
  });

  try {
    await connection.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const table of TABLES_IN_DELETE_ORDER) {
      await connection.query(`DELETE FROM \`${table}\``);
    }
    await connection.query('SET FOREIGN_KEY_CHECKS = 1');
  } finally {
    await connection.end();
  }
}

export async function closeTestDatabase(): Promise<void> {
  await closeDb();
}
