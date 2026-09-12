import 'server-only';
import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import { getEnv } from '../config/env';
import * as schema from './schema';

/**
 * Pool de conexoes MariaDB/MySQL.
 *
 * `timezone: 'Z'` e deliberado: todo DATETIME e gravado e lido em UTC, sem
 * depender do fuso do servidor (Prompt 01, item 79). A conversao para o fuso
 * do tenant acontece na apresentacao.
 *
 * `connectionLimit` baixo porque a hospedagem compartilhada da Hostinger impoe
 * limite de conexoes simultaneas por usuario de banco.
 */

export type Database = MySql2Database<typeof schema>;

let pool: mysql.Pool | null = null;
let database: Database | null = null;

function createPool(url: string): mysql.Pool {
  return mysql.createPool({
    uri: url,
    connectionLimit: Number(process.env.DB_POOL_SIZE ?? 5),
    timezone: 'Z',
    charset: 'utf8mb4_unicode_ci',
    supportBigNumbers: true,
    bigNumberStrings: false,
    enableKeepAlive: true,
    waitForConnections: true,
  });
}

export function getDb(): Database {
  if (database) return database;
  const url = getEnv().DATABASE_URL;
  pool = createPool(url);
  database = drizzle(pool, { schema, mode: 'default' });
  return database;
}

/** Encerra o pool (scripts CLI e testes). */
export async function closeDb(): Promise<void> {
  if (pool) await pool.end();
  pool = null;
  database = null;
}

export { schema };
