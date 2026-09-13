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

/**
 * Pasta temporaria contendo as migrations ATE a etapa indicada, para simular um
 * banco parado naquele prompt. O journal reduzido faz o migrator aplicar apenas
 * o que existia ate ali.
 */
function buildFolderUpTo(lastTag: string): string {
  const folder = mkdtempSync(join(tmpdir(), 'nexo56-migrations-'));
  cpSync('./drizzle', folder, { recursive: true });

  const journalPath = join(folder, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
    entries: Array<{ tag: string }>;
  };
  journal.entries = journal.entries.filter((entry) => entry.tag <= `${lastTag}_zzz`);
  writeFileSync(journalPath, JSON.stringify(journal, null, 2));

  return folder;
}

/** Atalho para o estado do Prompt 01. */
function buildFoundationOnlyFolder(): string {
  return buildFolderUpTo('0000');
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

describe('upgrade incremental entre prompts', () => {
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

  it('leva um banco do Prompt 02, com dados, ate o Prompt 03 sem perda', async () => {
    const stepDb = 'nexo56_migration_step03_test';
    await adminConnection.query(`DROP DATABASE IF EXISTS \`${stepDb}\``);
    await adminConnection.query(
      `CREATE DATABASE \`${stepDb}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );

    const folder = buildFolderUpTo('0001');
    const connection = await mysql.createConnection({
      uri: urlForDatabase(stepDb),
      timezone: 'Z',
      multipleStatements: true,
    });

    try {
      // --- banco no estado do Prompt 02 --------------------------------------
      await migrate(drizzle(connection), { migrationsFolder: folder });

      const [beforeTables] = await connection.query<mysql.RowDataPacket[]>('SHOW TABLES');
      const beforeNames = beforeTables.map((row) => Object.values(row)[0] as string);
      expect(beforeNames).not.toContain('user_unit_roles');
      expect(beforeNames).not.toContain('password_reset_tokens');

      await connection.query(`
        INSERT INTO plans (id, \`key\`, name, description, is_internal, created_at, updated_at)
        VALUES ('plan-p2', 'internal', 'Plano interno', '', 1, NOW(3), NOW(3));

        INSERT INTO tenants (id, slug, name, status, timezone, plan_id, created_at, updated_at)
        VALUES ('tenant-p2', 'empresa-p2', 'Empresa P2', 'active', 'America/Sao_Paulo', 'plan-p2', NOW(3), NOW(3));

        INSERT INTO units (id, tenant_id, name, status, created_at, updated_at)
        VALUES ('unit-p2', 'tenant-p2', 'Unidade P2', 'active', NOW(3), NOW(3));

        INSERT INTO users (id, tenant_id, email, name, password_hash, status, created_at, updated_at)
        VALUES ('user-p2', 'tenant-p2', 'p2@empresa.invalid', 'Usuario P2', 'scrypt$65536$8$2$c2FsdA==$aGFzaA==', 'active', NOW(3), NOW(3));

        INSERT INTO user_units (user_id, unit_id, tenant_id, created_at)
        VALUES ('user-p2', 'unit-p2', 'tenant-p2', NOW(3));

        INSERT INTO roles (id, tenant_id, \`key\`, name, description, is_system, created_at, updated_at)
        VALUES ('role-p2', 'tenant-p2', 'admin', 'Administrador', '', 1, NOW(3), NOW(3));

        INSERT INTO user_roles (user_id, role_id, tenant_id, created_at)
        VALUES ('user-p2', 'role-p2', 'tenant-p2', NOW(3));

        INSERT INTO sessions (id, user_id, tenant_id, token_hash, expires_at, last_used_at, created_at)
        VALUES ('sessao-p2', 'user-p2', 'tenant-p2', 'hash-p2', DATE_ADD(NOW(3), INTERVAL 1 DAY), NOW(3), NOW(3));

        INSERT INTO tenant_sequences (tenant_id, sequence_type, current_value, prefix, padding, updated_at)
        VALUES ('tenant-p2', 'service_order', 42, 'OS', 6, NOW(3));
      `);

      // --- aplica o Prompt 03 -------------------------------------------------
      await migrate(drizzle(connection), { migrationsFolder: './drizzle' });

      const [rows] = await connection.query<mysql.RowDataPacket[]>(`
        SELECT
          (SELECT COUNT(*) FROM tenants)          AS tenants,
          (SELECT COUNT(*) FROM users)            AS users,
          (SELECT COUNT(*) FROM user_units)       AS user_units,
          (SELECT COUNT(*) FROM user_roles)       AS user_roles,
          (SELECT COUNT(*) FROM sessions)         AS sessions,
          (SELECT current_value FROM tenant_sequences WHERE tenant_id='tenant-p2') AS sequence_value
      `);

      expect(rows[0]).toMatchObject({
        tenants: 1,
        users: 1,
        user_units: 1,
        user_roles: 1,
        sessions: 1,
        sequence_value: 42,
      });

      // A atribuicao tenant-wide existente continua valendo, sem migracao de linhas.
      const [assignment] = await connection.query<mysql.RowDataPacket[]>(
        "SELECT user_id, role_id, created_by FROM user_roles WHERE user_id = 'user-p2'",
      );
      expect(assignment[0]).toMatchObject({
        user_id: 'user-p2',
        role_id: 'role-p2',
        created_by: null,
      });

      // Papel por unidade EXIGE membership, imposto pelo banco (item 20).
      await connection.query(`
        INSERT INTO units (id, tenant_id, name, status, created_at, updated_at)
        VALUES ('unit-p2b', 'tenant-p2', 'Unidade sem vinculo', 'active', NOW(3), NOW(3))
      `);
      await expect(
        connection.query(`
          INSERT INTO user_unit_roles (user_id, role_id, unit_id, tenant_id, created_at)
          VALUES ('user-p2', 'role-p2', 'unit-p2b', 'tenant-p2', NOW(3))
        `),
      ).rejects.toThrow();
    } finally {
      await connection.end();
      rmSync(folder, { recursive: true, force: true });
      await adminConnection.query(`DROP DATABASE IF EXISTS \`${stepDb}\``);
    }
  });

  it('leva um banco do Prompt 05, com clientes, ate o Prompt 06 sem perda', async () => {
    const stepDb = 'nexo56_migration_step06_test';
    await adminConnection.query(`DROP DATABASE IF EXISTS \`${stepDb}\``);
    await adminConnection.query(
      `CREATE DATABASE \`${stepDb}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );

    const folder = buildFolderUpTo('0003');
    const connection = await mysql.createConnection({
      uri: urlForDatabase(stepDb),
      timezone: 'Z',
      multipleStatements: true,
    });

    try {
      // --- banco no estado do Prompt 05 --------------------------------------
      await migrate(drizzle(connection), { migrationsFolder: folder });

      const [beforeTables] = await connection.query<mysql.RowDataPacket[]>('SHOW TABLES');
      const beforeNames = beforeTables.map((row) => Object.values(row)[0] as string);
      expect(beforeNames).toContain('customers');
      expect(beforeNames).not.toContain('equipment');
      expect(beforeNames).not.toContain('equipment_intakes');

      await connection.query(`
        INSERT INTO plans (id, \`key\`, name, description, is_internal, created_at, updated_at)
        VALUES ('plan-p5', 'internal', 'Plano interno', '', 1, NOW(3), NOW(3));

        INSERT INTO tenants (id, slug, name, status, timezone, plan_id, created_at, updated_at)
        VALUES ('tenant-p5', 'empresa-p5', 'Empresa P5', 'active', 'America/Sao_Paulo', 'plan-p5', NOW(3), NOW(3));

        INSERT INTO units (id, tenant_id, name, status, created_at, updated_at)
        VALUES ('unit-p5', 'tenant-p5', 'Unidade P5', 'active', NOW(3), NOW(3));

        INSERT INTO users (id, tenant_id, email, name, password_hash, status, created_at, updated_at)
        VALUES ('user-p5', 'tenant-p5', 'p5@empresa.invalid', 'Usuario P5', 'scrypt$65536$8$2$c2FsdA==$aGFzaA==', 'active', NOW(3), NOW(3));

        INSERT INTO customers
          (id, tenant_id, kind, name, name_normalized, document_type, document_digits, notes,
           status, created_at, updated_at, created_by)
        VALUES
          ('cli-p5-a', 'tenant-p5', 'individual', 'Maria Souza', 'maria souza', 'cpf', '39053344705',
           'Cliente antiga', 'active', NOW(3), NOW(3), 'user-p5'),
          ('cli-p5-b', 'tenant-p5', 'company', 'Oficina Central LTDA', 'oficina central ltda', NULL, NULL,
           NULL, 'active', NOW(3), NOW(3), 'user-p5');

        INSERT INTO customer_contacts
          (id, customer_id, tenant_id, type, value, value_normalized, is_whatsapp, label,
           is_primary, primary_marker, created_at, updated_at)
        VALUES
          ('ctt-p5-a', 'cli-p5-a', 'tenant-p5', 'phone', '(11) 98765-4321', '11987654321', 1, 'WhatsApp',
           1, 1, NOW(3), NOW(3));

        INSERT INTO customer_addresses
          (id, customer_id, tenant_id, label, zip_code, street, number, district, city, state,
           is_primary, primary_marker, created_at, updated_at)
        VALUES
          ('end-p5-a', 'cli-p5-a', 'tenant-p5', 'Casa', '01001000', 'Praca da Se', '100', 'Se',
           'Sao Paulo', 'SP', 1, 1, NOW(3), NOW(3));
      `);

      // --- aplica o Prompt 06 -------------------------------------------------
      await migrate(drizzle(connection), { migrationsFolder: './drizzle' });

      const [rows] = await connection.query<mysql.RowDataPacket[]>(`
        SELECT
          (SELECT COUNT(*) FROM customers)           AS customers,
          (SELECT COUNT(*) FROM customer_contacts)   AS contacts,
          (SELECT COUNT(*) FROM customer_addresses)  AS addresses,
          (SELECT COUNT(*) FROM equipment)           AS equipment,
          (SELECT name FROM customers WHERE id='cli-p5-a') AS nome_a,
          (SELECT document_digits FROM customers WHERE id='cli-p5-a') AS doc_a,
          (SELECT value_normalized FROM customer_contacts WHERE id='ctt-p5-a') AS contato_a
      `);

      // Nada foi perdido nem reescrito (itens 101 e 102).
      expect(rows[0]).toMatchObject({
        customers: 2,
        contacts: 1,
        addresses: 1,
        equipment: 0,
        nome_a: 'Maria Souza',
        doc_a: '39053344705',
        contato_a: '11987654321',
      });

      const [afterTables] = await connection.query<mysql.RowDataPacket[]>('SHOW TABLES');
      const afterNames = afterTables.map((row) => Object.values(row)[0] as string);
      expect(afterNames).toEqual(
        expect.arrayContaining([
          'equipment',
          'equipment_intakes',
          'equipment_intake_accessories',
          'equipment_intake_conditions',
          'equipment_media',
          'equipment_label_readings',
        ]),
      );

      // O equipamento novo se prende ao cliente existente PELO PAR (id, tenant).
      await connection.query(`
        INSERT INTO equipment
          (id, tenant_id, customer_id, kind, kind_normalized, brand, brand_normalized,
           model, model_normalized, serial, serial_normalized, voltage, status,
           created_at, updated_at, created_by)
        VALUES
          ('eq-p5-a', 'tenant-p5', 'cli-p5-a', 'Televisor', 'televisor', 'Marca', 'marca',
           'Modelo', 'modelo', 'SN-1', 'SN1', 'bivolt', 'active', NOW(3), NOW(3), 'user-p5')
      `);

      const [equipamento] = await connection.query<mysql.RowDataPacket[]>(
        "SELECT customer_id, tenant_id FROM equipment WHERE id = 'eq-p5-a'",
      );
      expect(equipamento[0]).toMatchObject({ customer_id: 'cli-p5-a', tenant_id: 'tenant-p5' });

      // Cliente de OUTRA empresa e recusado pelo BANCO, nao so pela aplicacao.
      await connection.query(`
        INSERT INTO tenants (id, slug, name, status, timezone, plan_id, created_at, updated_at)
        VALUES ('tenant-p5b', 'empresa-p5b', 'Empresa P5B', 'active', 'America/Sao_Paulo', 'plan-p5', NOW(3), NOW(3))
      `);
      await expect(
        connection.query(`
          INSERT INTO equipment
            (id, tenant_id, customer_id, kind, kind_normalized, voltage, status,
             created_at, updated_at)
          VALUES
            ('eq-p5-x', 'tenant-p5b', 'cli-p5-a', 'Televisor', 'televisor', 'unknown', 'active',
             NOW(3), NOW(3))
        `),
      ).rejects.toThrow();

      // Cliente com equipamento nao pode simplesmente sumir (ON DELETE RESTRICT).
      await expect(
        connection.query("DELETE FROM customers WHERE id = 'cli-p5-a'"),
      ).rejects.toThrow();
    } finally {
      await connection.end();
      rmSync(folder, { recursive: true, force: true });
      await adminConnection.query(`DROP DATABASE IF EXISTS \`${stepDb}\``);
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

      // Presenca das estruturas de cada etapa — e nao uma contagem fixa, que
      // quebraria a cada prompt sem indicar problema real.
      expect(names).toEqual(
        expect.arrayContaining([
          // Prompt 01
          'tenants',
          'units',
          'users',
          'user_units',
          'sessions',
          'roles',
          'permissions',
          'role_permissions',
          'user_roles',
          'features',
          'plans',
          'tenant_features',
          'audit_logs',
          'domain_events',
          'jobs',
          // Prompt 02
          'tenant_sequences',
          // Prompt 03
          'user_unit_roles',
          'password_reset_tokens',
          // Prompt 05
          'customers',
          'customer_contacts',
          'customer_addresses',
          // Prompt 06
          'equipment',
          'equipment_intakes',
          'equipment_intake_accessories',
          'equipment_intake_conditions',
          'equipment_media',
          'equipment_label_readings',
        ]),
      );
    } finally {
      await connection.end();
      await adminConnection.query(`DROP DATABASE IF EXISTS \`${freshDb}\``);
    }
  });
});
