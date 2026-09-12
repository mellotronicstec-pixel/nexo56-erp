import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/mysql2';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import mysql from 'mysql2/promise';

/**
 * TESTE DE UPGRADE (Prompt 02, itens 70 e 75).
 *
 * Prova o caminho real de producao: um banco que ja roda a fundacao do
 * Prompt 01, com dados dentro, recebe a migration do Prompt 02 sem perder nada.
 *
 * Como funciona:
 *   1. cria um banco vazio e aplica SOMENTE a migration 0000 (Prompt 01),
 *      usando uma copia da pasta drizzle com o journal reduzido;
 *   2. insere dados representativos (empresa, unidade, usuario, papel,
 *      vinculos, auditoria);
 *   3. aplica a pasta de migrations COMPLETA — o journal faz a 0000 ser
 *      pulada e so a 0001 roda;
 *   4. confere que todos os registros continuam la, com o mesmo conteudo, e
 *      que as novas estruturas existem.
 */

const BASE_URL = process.env.TEST_DATABASE_URL as string;
const UPGRADE_DB = 'nexo56_migration_upgrade_test';

function urlForDatabase(name: string): string {
  const url = new URL(BASE_URL.replace('mysql://', 'http://'));
  return `mysql://${url.username}:${url.password}@${url.hostname}:${url.port || 3306}/${name}`;
}

let adminConnection: mysql.Connection;

async function connectToUpgradeDatabase(): Promise<mysql.Connection> {
  return mysql.createConnection({
    uri: urlForDatabase(UPGRADE_DB),
    timezone: 'Z',
    multipleStatements: true,
  });
}

/** Pasta temporaria com apenas a primeira migration, simulando o Prompt 01. */
function buildFoundationOnlyFolder(): string {
  const folder = mkdtempSync(join(tmpdir(), 'nexo56-migrations-'));
  cpSync('./drizzle', folder, { recursive: true });

  const journalPath = join(folder, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
    entries: Array<{ tag: string }>;
  };
  journal.entries = journal.entries.filter((entry) => entry.tag.startsWith('0000'));
  writeFileSync(journalPath, JSON.stringify(journal, null, 2));

  return folder;
}

beforeAll(async () => {
  adminConnection = await mysql.createConnection({ uri: BASE_URL, timezone: 'Z' });
  await adminConnection.query(`DROP DATABASE IF EXISTS \`${UPGRADE_DB}\``);
  await adminConnection.query(
    `CREATE DATABASE \`${UPGRADE_DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );
});

afterAll(async () => {
  await adminConnection.query(`DROP DATABASE IF EXISTS \`${UPGRADE_DB}\``);
  await adminConnection.end();
});

describe('upgrade do Prompt 01 para o Prompt 02', () => {
  it('preserva todos os dados existentes e adiciona as novas estruturas', async () => {
    // --- 1. banco na fundacao do Prompt 01 -----------------------------------
    const foundationFolder = buildFoundationOnlyFolder();
    const connection = await connectToUpgradeDatabase();

    try {
      await migrate(drizzle(connection), { migrationsFolder: foundationFolder });

      const [foundationTables] = await connection.query<mysql.RowDataPacket[]>('SHOW TABLES');
      expect(foundationTables.length).toBeGreaterThanOrEqual(18);

      // tenant_sequences ainda NAO existe nesta etapa
      const tableNames = foundationTables.map((row) => Object.values(row)[0] as string);
      expect(tableNames).not.toContain('tenant_sequences');

      // --- 2. dados representativos do Prompt 01 -----------------------------
      await connection.query(`
        INSERT INTO plans (id, \`key\`, name, description, is_internal, created_at, updated_at)
        VALUES ('plan-legado', 'internal', 'Plano interno', '', 1, NOW(3), NOW(3));

        INSERT INTO tenants (id, slug, name, status, timezone, plan_id, created_at, updated_at)
        VALUES ('tenant-legado', 'empresa-legada', 'Empresa Legada', 'active', 'America/Sao_Paulo', 'plan-legado', NOW(3), NOW(3));

        INSERT INTO units (id, tenant_id, name, status, created_at, updated_at)
        VALUES ('unit-legada', 'tenant-legado', 'Unidade Legada', 'active', NOW(3), NOW(3));

        INSERT INTO users (id, tenant_id, email, name, password_hash, status, created_at, updated_at)
        VALUES ('user-legado', 'tenant-legado', 'legado@empresa.invalid', 'Usuario Legado', 'scrypt$65536$8$2$c2FsdA==$aGFzaA==', 'active', NOW(3), NOW(3));

        INSERT INTO user_units (user_id, unit_id, tenant_id, created_at)
        VALUES ('user-legado', 'unit-legada', 'tenant-legado', NOW(3));

        INSERT INTO roles (id, tenant_id, \`key\`, name, description, is_system, created_at, updated_at)
        VALUES ('role-legado', 'tenant-legado', 'admin', 'Administrador', '', 1, NOW(3), NOW(3));

        INSERT INTO user_roles (user_id, role_id, tenant_id, created_at)
        VALUES ('user-legado', 'role-legado', 'tenant-legado', NOW(3));

        INSERT INTO sessions (id, user_id, tenant_id, token_hash, expires_at, last_used_at, created_at)
        VALUES ('sessao-legada', 'user-legado', 'tenant-legado', 'hash-legado', DATE_ADD(NOW(3), INTERVAL 1 DAY), NOW(3), NOW(3));

        INSERT INTO audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, origin, created_at)
        VALUES ('audit-legado', 'tenant-legado', 'user-legado', 'tenant.created', 'tenant', 'tenant-legado', 'cli', NOW(3));
      `);

      // --- 3. aplica a migration do Prompt 02 --------------------------------
      await migrate(drizzle(connection), { migrationsFolder: './drizzle' });

      // --- 4. nada se perdeu -------------------------------------------------
      const [rows] = await connection.query<mysql.RowDataPacket[]>(`
        SELECT
          (SELECT COUNT(*) FROM tenants)     AS tenants,
          (SELECT COUNT(*) FROM units)       AS units,
          (SELECT COUNT(*) FROM users)       AS users,
          (SELECT COUNT(*) FROM user_units)  AS user_units,
          (SELECT COUNT(*) FROM user_roles)  AS user_roles,
          (SELECT COUNT(*) FROM roles)       AS roles,
          (SELECT COUNT(*) FROM sessions)    AS sessions,
          (SELECT COUNT(*) FROM audit_logs)  AS audit_logs
      `);

      expect(rows[0]).toMatchObject({
        tenants: 1,
        units: 1,
        users: 1,
        user_units: 1,
        user_roles: 1,
        roles: 1,
        sessions: 1,
        audit_logs: 1,
      });

      // conteudo, nao apenas contagem
      const [userRows] = await connection.query<mysql.RowDataPacket[]>(
        "SELECT email, name, password_hash, status FROM users WHERE id = 'user-legado'",
      );
      expect(userRows[0]).toMatchObject({
        email: 'legado@empresa.invalid',
        name: 'Usuario Legado',
        password_hash: 'scrypt$65536$8$2$c2FsdA==$aGFzaA==',
        status: 'active',
      });

      // --- 5. novas estruturas presentes -------------------------------------
      const [afterTables] = await connection.query<mysql.RowDataPacket[]>('SHOW TABLES');
      expect(afterTables.map((row) => Object.values(row)[0] as string)).toContain(
        'tenant_sequences',
      );

      const [constraints] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT CONSTRAINT_NAME FROM information_schema.REFERENTIAL_CONSTRAINTS
         WHERE CONSTRAINT_SCHEMA = ? AND CONSTRAINT_NAME LIKE 'fk_%'`,
        [UPGRADE_DB],
      );
      const names = constraints.map((row) => row.CONSTRAINT_NAME as string);
      expect(names).toEqual(
        expect.arrayContaining([
          'fk_user_units_user_tenant',
          'fk_user_units_unit_tenant',
          'fk_user_roles_user_tenant',
          'fk_user_roles_role_tenant',
          'fk_sessions_user_tenant',
        ]),
      );

      // --- 6. a nova protecao esta ativa no banco atualizado -----------------
      await connection.query(`
        INSERT INTO tenants (id, slug, name, status, timezone, plan_id, created_at, updated_at)
        VALUES ('tenant-novo', 'empresa-nova', 'Empresa Nova', 'active', 'UTC', 'plan-legado', NOW(3), NOW(3))
      `);
      await connection.query(`
        INSERT INTO units (id, tenant_id, name, status, created_at, updated_at)
        VALUES ('unit-nova', 'tenant-novo', 'Unidade Nova', 'active', NOW(3), NOW(3))
      `);

      await expect(
        connection.query(`
          INSERT INTO user_units (user_id, unit_id, tenant_id, created_at)
          VALUES ('user-legado', 'unit-nova', 'tenant-legado', NOW(3))
        `),
      ).rejects.toThrow();
    } finally {
      await connection.end();
      rmSync(foundationFolder, { recursive: true, force: true });
    }
  });

  it('cria um banco vazio do zero com todas as migrations', async () => {
    const freshDb = 'nexo56_migration_fresh_test';
    await adminConnection.query(`DROP DATABASE IF EXISTS \`${freshDb}\``);
    await adminConnection.query(
      `CREATE DATABASE \`${freshDb}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );

    const connection = await mysql.createConnection({
      uri: urlForDatabase(freshDb),
      timezone: 'Z',
      multipleStatements: true,
    });

    try {
      await migrate(drizzle(connection), { migrationsFolder: './drizzle' });

      const [tables] = await connection.query<mysql.RowDataPacket[]>('SHOW TABLES');
      const names = tables.map((row) => Object.values(row)[0] as string);

      expect(names).toContain('tenant_sequences');
      expect(names).toContain('tenants');
      // 18 tabelas de negocio/infra + o journal do drizzle
      expect(names.length).toBe(19);
    } finally {
      await connection.end();
      await adminConnection.query(`DROP DATABASE IF EXISTS \`${freshDb}\``);
    }
  });
});
