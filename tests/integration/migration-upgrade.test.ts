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

  it('leva um banco do Prompt 06, com dados, ate o Prompt 07 sem perda', async () => {
    const stepDb = 'nexo56_migration_step07_test';
    await adminConnection.query(`DROP DATABASE IF EXISTS \`${stepDb}\``);
    await adminConnection.query(
      `CREATE DATABASE \`${stepDb}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );

    const folder = buildFolderUpTo('0004');
    const connection = await mysql.createConnection({
      uri: urlForDatabase(stepDb),
      timezone: 'Z',
      multipleStatements: true,
    });

    try {
      // --- banco no estado do Prompt 06 --------------------------------------
      await migrate(drizzle(connection), { migrationsFolder: folder });

      const [beforeTables] = await connection.query<mysql.RowDataPacket[]>('SHOW TABLES');
      const beforeNames = beforeTables.map((row) => Object.values(row)[0] as string);
      expect(beforeNames).toContain('equipment_intakes');
      expect(beforeNames).not.toContain('service_orders');

      await connection.query(`
        INSERT INTO plans (id, \`key\`, name, description, is_internal, created_at, updated_at)
        VALUES ('plan-p6', 'internal', 'Plano interno', '', 1, NOW(3), NOW(3));

        INSERT INTO tenants (id, slug, name, status, timezone, plan_id, created_at, updated_at)
        VALUES ('tenant-p6', 'empresa-p6', 'Empresa P6', 'active', 'America/Sao_Paulo', 'plan-p6', NOW(3), NOW(3));

        INSERT INTO units (id, tenant_id, name, status, created_at, updated_at)
        VALUES ('unit-p6', 'tenant-p6', 'Unidade P6', 'active', NOW(3), NOW(3)),
               ('unit-p6b', 'tenant-p6', 'Unidade P6 Norte', 'active', NOW(3), NOW(3));

        INSERT INTO users (id, tenant_id, email, name, password_hash, status, created_at, updated_at)
        VALUES ('user-p6', 'tenant-p6', 'p6@empresa.invalid', 'Usuario P6', 'scrypt$65536$8$2$c2FsdA==$aGFzaA==', 'active', NOW(3), NOW(3));

        INSERT INTO customers
          (id, tenant_id, kind, name, name_normalized, status, created_at, updated_at, created_by)
        VALUES ('cli-p6', 'tenant-p6', 'individual', 'Joana Lima', 'joana lima', 'active', NOW(3), NOW(3), 'user-p6');

        INSERT INTO equipment
          (id, tenant_id, customer_id, kind, kind_normalized, brand, brand_normalized,
           model, model_normalized, serial, serial_normalized, voltage, status,
           created_at, updated_at, created_by)
        VALUES ('eq-p6', 'tenant-p6', 'cli-p6', 'Televisor', 'televisor', 'Marca', 'marca',
                'Modelo', 'modelo', 'SN-P6', 'SNP6', 'bivolt', 'active', NOW(3), NOW(3), 'user-p6');

        INSERT INTO equipment_intakes
          (id, tenant_id, unit_id, equipment_id, received_at, received_by, power_cable,
           created_at, updated_at, created_by)
        VALUES ('int-p6', 'tenant-p6', 'unit-p6', 'eq-p6', NOW(3), 'user-p6', 'yes',
                NOW(3), NOW(3), 'user-p6');

        INSERT INTO tenant_sequences (tenant_id, sequence_type, current_value, prefix, padding, updated_at)
        VALUES ('tenant-p6', 'service_order', 7, 'OS', 6, NOW(3));
      `);

      // --- aplica o Prompt 07 -------------------------------------------------
      await migrate(drizzle(connection), { migrationsFolder: './drizzle' });

      const [rows] = await connection.query<mysql.RowDataPacket[]>(`
        SELECT
          (SELECT COUNT(*) FROM customers)          AS customers,
          (SELECT COUNT(*) FROM equipment)          AS equipment,
          (SELECT COUNT(*) FROM equipment_intakes)  AS intakes,
          (SELECT COUNT(*) FROM service_orders)     AS service_orders,
          (SELECT name FROM customers WHERE id='cli-p6')  AS nome,
          (SELECT serial FROM equipment WHERE id='eq-p6') AS serial,
          (SELECT current_value FROM tenant_sequences
            WHERE tenant_id='tenant-p6' AND sequence_type='service_order') AS sequencia
      `);

      // Nada perdido, nada reescrito — inclusive a sequencia ja em uso.
      expect(rows[0]).toMatchObject({
        customers: 1,
        equipment: 1,
        intakes: 1,
        service_orders: 0,
        nome: 'Joana Lima',
        serial: 'SN-P6',
        sequencia: 7,
      });

      const [afterTables] = await connection.query<mysql.RowDataPacket[]>('SHOW TABLES');
      const afterNames = afterTables.map((row) => Object.values(row)[0] as string);
      expect(afterNames).toEqual(
        expect.arrayContaining(['service_orders', 'service_order_timeline']),
      );

      // A OS nasce presa ao recebimento E a unidade dele.
      await connection.query(`
        INSERT INTO service_orders
          (id, tenant_id, unit_id, number, customer_id, equipment_id, intake_id,
           status, customer_report, opened_at, created_by, created_at, updated_at)
        VALUES ('so-p6', 'tenant-p6', 'unit-p6', 8, 'cli-p6', 'eq-p6', 'int-p6',
                'awaiting_technical_opinion', 'Nao liga.', NOW(3), 'user-p6', NOW(3), NOW(3))
      `);

      // Recebimento da unidade A nao gera OS na unidade B (item 11).
      await expect(
        connection.query(`
          INSERT INTO service_orders
            (id, tenant_id, unit_id, number, customer_id, equipment_id, intake_id,
             status, customer_report, opened_at, created_at, updated_at)
          VALUES ('so-p6-x', 'tenant-p6', 'unit-p6b', 9, 'cli-p6', 'eq-p6', 'int-p6',
                  'awaiting_technical_opinion', 'x', NOW(3), NOW(3), NOW(3))
        `),
      ).rejects.toThrow();

      // Numero repetido na mesma empresa e recusado (item 106).
      await expect(
        connection.query(`
          INSERT INTO service_orders
            (id, tenant_id, unit_id, number, customer_id, equipment_id,
             status, customer_report, opened_at, created_at, updated_at)
          VALUES ('so-p6-y', 'tenant-p6', 'unit-p6', 8, 'cli-p6', 'eq-p6',
                  'awaiting_technical_opinion', 'x', NOW(3), NOW(3), NOW(3))
        `),
      ).rejects.toThrow();
    } finally {
      await connection.end();
      rmSync(folder, { recursive: true, force: true });
      await adminConnection.query(`DROP DATABASE IF EXISTS \`${stepDb}\``);
    }
  });

  it('leva um banco do Prompt 07, com Ordens de Servico abertas, ate o Prompt 08 sem perda', async () => {
    const stepDb = 'nexo56_migration_step08_test';
    await adminConnection.query(`DROP DATABASE IF EXISTS \`${stepDb}\``);
    await adminConnection.query(
      `CREATE DATABASE \`${stepDb}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );

    const folder = buildFolderUpTo('0005');
    const connection = await mysql.createConnection({
      uri: urlForDatabase(stepDb),
      timezone: 'Z',
      multipleStatements: true,
    });

    try {
      // --- banco no estado do Prompt 07 --------------------------------------
      await migrate(drizzle(connection), { migrationsFolder: folder });

      const [beforeTables] = await connection.query<mysql.RowDataPacket[]>('SHOW TABLES');
      const beforeNames = beforeTables.map((row) => Object.values(row)[0] as string);
      expect(beforeNames).toContain('service_orders');
      expect(beforeNames).not.toContain('service_order_tasks');

      await connection.query(`
        INSERT INTO plans (id, \`key\`, name, description, is_internal, created_at, updated_at)
        VALUES ('plan-p7', 'internal', 'Plano interno', '', 1, NOW(3), NOW(3));

        INSERT INTO tenants (id, slug, name, status, timezone, plan_id, created_at, updated_at)
        VALUES ('tenant-p7', 'empresa-p7', 'Empresa P7', 'active', 'America/Sao_Paulo', 'plan-p7', NOW(3), NOW(3));

        INSERT INTO units (id, tenant_id, name, status, created_at, updated_at)
        VALUES ('unit-p7', 'tenant-p7', 'Unidade P7', 'active', NOW(3), NOW(3)),
               ('unit-p7b', 'tenant-p7', 'Unidade P7 Norte', 'active', NOW(3), NOW(3));

        INSERT INTO users (id, tenant_id, email, name, password_hash, status, created_at, updated_at)
        VALUES ('user-p7', 'tenant-p7', 'p7@empresa.invalid', 'Usuario P7', 'scrypt$65536$8$2$c2FsdA==$aGFzaA==', 'active', NOW(3), NOW(3));

        INSERT INTO user_units (user_id, unit_id, tenant_id, created_at)
        VALUES ('user-p7', 'unit-p7', 'tenant-p7', NOW(3));

        INSERT INTO customers
          (id, tenant_id, kind, name, name_normalized, status, created_at, updated_at, created_by)
        VALUES ('cli-p7', 'tenant-p7', 'individual', 'Pedro Alves', 'pedro alves', 'active', NOW(3), NOW(3), 'user-p7');

        INSERT INTO equipment
          (id, tenant_id, customer_id, kind, kind_normalized, voltage, status,
           created_at, updated_at, created_by)
        VALUES ('eq-p7', 'tenant-p7', 'cli-p7', 'Televisor', 'televisor', 'bivolt', 'active',
                NOW(3), NOW(3), 'user-p7');

        INSERT INTO service_orders
          (id, tenant_id, unit_id, number, customer_id, equipment_id,
           status, customer_report, internal_notes, opened_at, created_by, created_at, updated_at)
        VALUES
          ('so-p7-a', 'tenant-p7', 'unit-p7', 1, 'cli-p7', 'eq-p7',
           'awaiting_technical_opinion', 'Nao liga desde a queda de energia.', 'Cliente apressado.',
           NOW(3), 'user-p7', NOW(3), NOW(3)),
          ('so-p7-b', 'tenant-p7', 'unit-p7', 2, 'cli-p7', 'eq-p7',
           'awaiting_technical_opinion', 'Imagem tremendo.', NULL,
           NOW(3), 'user-p7', NOW(3), NOW(3));

        INSERT INTO service_order_timeline
          (id, tenant_id, service_order_id, kind, summary, actor_id, occurred_at)
        VALUES ('tl-p7-a', 'tenant-p7', 'so-p7-a', 'created', 'Ordem de Servico aberta',
                'user-p7', NOW(3));
      `);

      // --- aplica o Prompt 08 -------------------------------------------------
      await migrate(drizzle(connection), { migrationsFolder: './drizzle' });

      const [rows] = await connection.query<mysql.RowDataPacket[]>(`
        SELECT
          (SELECT COUNT(*) FROM service_orders)         AS ordens,
          (SELECT COUNT(*) FROM service_order_timeline) AS linha,
          (SELECT COUNT(*) FROM service_order_tasks)    AS tarefas,
          (SELECT customer_report FROM service_orders WHERE id='so-p7-a') AS relato,
          (SELECT internal_notes  FROM service_orders WHERE id='so-p7-a') AS observacao,
          (SELECT status  FROM service_orders WHERE id='so-p7-a')         AS situacao,
          (SELECT number  FROM service_orders WHERE id='so-p7-b')         AS numero_b
      `);

      // Nada perdido, nada reescrito.
      expect(rows[0]).toMatchObject({
        ordens: 2,
        linha: 1,
        tarefas: 0,
        relato: 'Nao liga desde a queda de energia.',
        observacao: 'Cliente apressado.',
        situacao: 'awaiting_technical_opinion',
        numero_b: 2,
      });

      /**
       * AS ORDENS ANTIGAS ENTRAM NO WORKFLOW NA VERSAO 1 (itens 97 e 99).
       *
       * A migration e ADITIVA: nao reescreve estado nem inventa follow-up
       * retroativo. Uma OS parada ha meses nao deve aparecer "vencida" no dia
       * do deploy so porque a coluna passou a existir.
       */
      const [ordens] = await connection.query<mysql.RowDataPacket[]>(
        'SELECT id, version, follow_up_at, follow_up_alerted_for, status_changed_at, assigned_technician_id FROM service_orders ORDER BY number',
      );
      for (const ordem of ordens) {
        expect(ordem.version).toBe(1);
        expect(ordem.follow_up_at).toBeNull();
        expect(ordem.follow_up_alerted_for).toBeNull();
        expect(ordem.status_changed_at).toBeNull();
        expect(ordem.assigned_technician_id).toBeNull();
      }

      const [afterTables] = await connection.query<mysql.RowDataPacket[]>('SHOW TABLES');
      expect(afterTables.map((row) => Object.values(row)[0] as string)).toContain(
        'service_order_tasks',
      );

      // A tarefa nasce presa a ordem E a unidade dela, pelo PAR (id, tenant).
      await connection.query(`
        INSERT INTO service_order_tasks
          (id, tenant_id, unit_id, service_order_id, kind, title, status, open_marker,
           created_at, updated_at)
        VALUES ('task-p7-a', 'tenant-p7', 'unit-p7', 'so-p7-a', 'delivery_preparation',
                'Preparar equipamento para entrega', 'open', 1, NOW(3), NOW(3))
      `);

      // DUAS tarefas abertas do mesmo tipo na mesma ordem: recusado pelo BANCO.
      await expect(
        connection.query(`
          INSERT INTO service_order_tasks
            (id, tenant_id, unit_id, service_order_id, kind, title, status, open_marker,
             created_at, updated_at)
          VALUES ('task-p7-b', 'tenant-p7', 'unit-p7', 'so-p7-a', 'delivery_preparation',
                  'Preparar equipamento para entrega', 'open', 1, NOW(3), NOW(3))
        `),
      ).rejects.toThrow();

      // Encerrada, ela libera espaco para a proxima: `open_marker` vira NULL e
      // cada NULL e distinto no UNIQUE do MySQL.
      await connection.query(
        "UPDATE service_order_tasks SET status='done', open_marker=NULL WHERE id='task-p7-a'",
      );
      await connection.query(`
        INSERT INTO service_order_tasks
          (id, tenant_id, unit_id, service_order_id, kind, title, status, open_marker,
           created_at, updated_at)
        VALUES ('task-p7-c', 'tenant-p7', 'unit-p7', 'so-p7-a', 'delivery_preparation',
                'Preparar equipamento para entrega', 'open', 1, NOW(3), NOW(3))
      `);

      // Tecnico de OUTRA empresa e recusado pelo banco, nao so pela aplicacao.
      await connection.query(`
        INSERT INTO tenants (id, slug, name, status, timezone, plan_id, created_at, updated_at)
        VALUES ('tenant-p7b', 'empresa-p7b', 'Empresa P7B', 'active', 'UTC', 'plan-p7', NOW(3), NOW(3));

        INSERT INTO users (id, tenant_id, email, name, password_hash, status, created_at, updated_at)
        VALUES ('user-p7b', 'tenant-p7b', 'p7b@empresa.invalid', 'De Outra Empresa', 'scrypt$65536$8$2$c2FsdA==$aGFzaA==', 'active', NOW(3), NOW(3));
      `);
      await expect(
        connection.query(
          "UPDATE service_orders SET assigned_technician_id='user-p7b' WHERE id='so-p7-a'",
        ),
      ).rejects.toThrow();

      // E a ordem apagada leva suas tarefas junto (ON DELETE CASCADE).
      await connection.query("DELETE FROM service_orders WHERE id = 'so-p7-a'");
      const [restantes] = await connection.query<mysql.RowDataPacket[]>(
        'SELECT COUNT(*) AS total FROM service_order_tasks',
      );
      expect(restantes[0]).toMatchObject({ total: 0 });
    } finally {
      await connection.end();
      rmSync(folder, { recursive: true, force: true });
      await adminConnection.query(`DROP DATABASE IF EXISTS \`${stepDb}\``);
    }
  });

  it('leva um banco do Prompt 08, com OS e workflow, ate o Prompt 09 sem perda', async () => {
    const stepDb = 'nexo56_migration_step09_test';
    await adminConnection.query(`DROP DATABASE IF EXISTS \`${stepDb}\``);
    await adminConnection.query(
      `CREATE DATABASE \`${stepDb}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );

    const folder = buildFolderUpTo('0006');
    const connection = await mysql.createConnection({
      uri: urlForDatabase(stepDb),
      timezone: 'Z',
      multipleStatements: true,
    });

    try {
      // --- banco no estado do Prompt 08 --------------------------------------
      await migrate(drizzle(connection), { migrationsFolder: folder });

      const [beforeTables] = await connection.query<mysql.RowDataPacket[]>('SHOW TABLES');
      const beforeNames = beforeTables.map((row) => Object.values(row)[0] as string);
      expect(beforeNames).toContain('service_order_tasks');
      expect(beforeNames).not.toContain('quotes');

      await connection.query(`
        INSERT INTO plans (id, \`key\`, name, description, is_internal, created_at, updated_at)
        VALUES ('plan-p8', 'internal', 'Plano interno', '', 1, NOW(3), NOW(3));

        INSERT INTO tenants (id, slug, name, status, timezone, plan_id, created_at, updated_at)
        VALUES ('tenant-p8', 'empresa-p8', 'Empresa P8', 'active', 'America/Sao_Paulo', 'plan-p8', NOW(3), NOW(3));

        INSERT INTO units (id, tenant_id, name, status, created_at, updated_at)
        VALUES ('unit-p8', 'tenant-p8', 'Unidade P8', 'active', NOW(3), NOW(3)),
               ('unit-p8b', 'tenant-p8', 'Unidade P8 Norte', 'active', NOW(3), NOW(3));

        INSERT INTO users (id, tenant_id, email, name, password_hash, status, created_at, updated_at)
        VALUES ('user-p8', 'tenant-p8', 'p8@empresa.invalid', 'Usuario P8', 'scrypt$65536$8$2$c2FsdA==$aGFzaA==', 'active', NOW(3), NOW(3));

        INSERT INTO customers
          (id, tenant_id, kind, name, name_normalized, status, created_at, updated_at, created_by)
        VALUES ('cli-p8', 'tenant-p8', 'individual', 'Rita Nunes', 'rita nunes', 'active', NOW(3), NOW(3), 'user-p8');

        INSERT INTO equipment
          (id, tenant_id, customer_id, kind, kind_normalized, voltage, status,
           created_at, updated_at, created_by)
        VALUES ('eq-p8', 'tenant-p8', 'cli-p8', 'Televisor', 'televisor', 'bivolt', 'active',
                NOW(3), NOW(3), 'user-p8');

        INSERT INTO service_orders
          (id, tenant_id, unit_id, number, customer_id, equipment_id, status, customer_report,
           opened_at, version, follow_up_at, status_changed_at, created_by, created_at, updated_at)
        VALUES
          ('so-p8-a', 'tenant-p8', 'unit-p8', 1, 'cli-p8', 'eq-p8', 'awaiting_approval',
           'Tela sem imagem.', NOW(3), 4, '2026-10-01', NOW(3), 'user-p8', NOW(3), NOW(3)),
          ('so-p8-b', 'tenant-p8', 'unit-p8', 2, 'cli-p8', 'eq-p8', 'awaiting_repair',
           'Nao liga.', NOW(3), 2, NULL, NOW(3), 'user-p8', NOW(3), NOW(3));

        INSERT INTO service_order_tasks
          (id, tenant_id, unit_id, service_order_id, kind, title, status, open_marker,
           created_at, updated_at)
        VALUES ('task-p8', 'tenant-p8', 'unit-p8', 'so-p8-b', 'part_pickup', 'Buscar peca',
                'open', 1, NOW(3), NOW(3));

        INSERT INTO tenant_sequences (tenant_id, sequence_type, current_value, prefix, padding, updated_at)
        VALUES ('tenant-p8', 'service_order', 2, 'OS', 6, NOW(3));
      `);

      // --- aplica o Prompt 09 -------------------------------------------------
      await migrate(drizzle(connection), { migrationsFolder: './drizzle' });

      const [rows] = await connection.query<mysql.RowDataPacket[]>(`
        SELECT
          (SELECT COUNT(*) FROM service_orders)      AS ordens,
          (SELECT COUNT(*) FROM service_order_tasks) AS tarefas,
          (SELECT COUNT(*) FROM quotes)              AS orcamentos,
          (SELECT status  FROM service_orders WHERE id='so-p8-a') AS situacao_a,
          (SELECT status  FROM service_orders WHERE id='so-p8-b') AS situacao_b,
          (SELECT version FROM service_orders WHERE id='so-p8-a') AS versao_a,
          (SELECT follow_up_at FROM service_orders WHERE id='so-p8-a') AS prazo_a,
          (SELECT customer_report FROM service_orders WHERE id='so-p8-a') AS relato_a
      `);

      /**
       * NADA DA OS FOI TOCADO (item 118). A migration e aditiva: nenhuma ordem
       * muda de situacao, de versao ou de prazo por causa de uma tabela nova.
       */
      expect(rows[0]).toMatchObject({
        ordens: 2,
        tarefas: 1,
        orcamentos: 0,
        situacao_a: 'awaiting_approval',
        situacao_b: 'awaiting_repair',
        versao_a: 4,
        prazo_a: '2026-10-01',
        relato_a: 'Tela sem imagem.',
      });

      const [afterTables] = await connection.query<mysql.RowDataPacket[]>('SHOW TABLES');
      const afterNames = afterTables.map((row) => Object.values(row)[0] as string);
      expect(afterNames).toEqual(
        expect.arrayContaining(['quotes', 'quote_items', 'quote_timeline']),
      );

      // O orcamento nasce preso a OS, a empresa E a unidade dela.
      await connection.query(`
        INSERT INTO quotes
          (id, tenant_id, unit_id, service_order_id, number, revision, status, active_marker,
           subtotal, discount, total, currency, version, created_by, created_at, updated_at)
        VALUES ('orc-p8-a', 'tenant-p8', 'unit-p8', 'so-p8-a', 1, 1, 'draft', 1,
                '0.00', '0.00', '0.00', 'BRL', 1, 'user-p8', NOW(3), NOW(3))
      `);

      // OS da unidade A nao aceita orcamento carimbado na unidade B (item 8).
      await expect(
        connection.query(`
          INSERT INTO quotes
            (id, tenant_id, unit_id, service_order_id, number, revision, status,
             subtotal, discount, total, currency, version, created_at, updated_at)
          VALUES ('orc-p8-x', 'tenant-p8', 'unit-p8b', 'so-p8-a', 9, 1, 'draft',
                  '0.00', '0.00', '0.00', 'BRL', 1, NOW(3), NOW(3))
        `),
      ).rejects.toThrow();

      // DUAS propostas vivas na mesma OS: recusado pelo BANCO (item 65).
      await expect(
        connection.query(`
          INSERT INTO quotes
            (id, tenant_id, unit_id, service_order_id, number, revision, status, active_marker,
             subtotal, discount, total, currency, version, created_at, updated_at)
          VALUES ('orc-p8-b', 'tenant-p8', 'unit-p8', 'so-p8-a', 2, 1, 'draft', 1,
                  '0.00', '0.00', '0.00', 'BRL', 1, NOW(3), NOW(3))
        `),
      ).rejects.toThrow();

      // Encerrada, ela libera o lugar: cada NULL e distinto no UNIQUE.
      await connection.query(
        "UPDATE quotes SET status='cancelled', active_marker=NULL WHERE id='orc-p8-a'",
      );
      await connection.query(`
        INSERT INTO quotes
          (id, tenant_id, unit_id, service_order_id, number, revision, status, active_marker,
           subtotal, discount, total, currency, version, created_at, updated_at)
        VALUES ('orc-p8-c', 'tenant-p8', 'unit-p8', 'so-p8-a', 1, 2, 'draft', 1,
                '0.00', '0.00', '0.00', 'BRL', 1, NOW(3), NOW(3))
      `);

      // Numero + revisao sao unicos na empresa (item 12).
      await expect(
        connection.query(`
          INSERT INTO quotes
            (id, tenant_id, unit_id, service_order_id, number, revision, status,
             subtotal, discount, total, currency, version, created_at, updated_at)
          VALUES ('orc-p8-d', 'tenant-p8', 'unit-p8', 'so-p8-b', 1, 2, 'draft',
                  '0.00', '0.00', '0.00', 'BRL', 1, NOW(3), NOW(3))
        `),
      ).rejects.toThrow();

      // OS de OUTRA empresa e recusada pela FK composta (item 7).
      await connection.query(`
        INSERT INTO tenants (id, slug, name, status, timezone, plan_id, created_at, updated_at)
        VALUES ('tenant-p8b', 'empresa-p8b', 'Empresa P8B', 'active', 'UTC', 'plan-p8', NOW(3), NOW(3))
      `);
      await expect(
        connection.query(`
          INSERT INTO quotes
            (id, tenant_id, unit_id, service_order_id, number, revision, status,
             subtotal, discount, total, currency, version, created_at, updated_at)
          VALUES ('orc-p8-y', 'tenant-p8b', 'unit-p8', 'so-p8-a', 1, 1, 'draft',
                  '0.00', '0.00', '0.00', 'BRL', 1, NOW(3), NOW(3))
        `),
      ).rejects.toThrow();

      // O item segue o orcamento no CASCADE; a OS nunca some por baixo dele.
      await connection.query(`
        INSERT INTO quote_items
          (id, tenant_id, quote_id, kind, description, quantity, unit_price, discount, total,
           position, created_at, updated_at)
        VALUES ('item-p8', 'tenant-p8', 'orc-p8-c', 'service', 'Bancada',
                '1.0000', '100.00', '0.00', '100.00', 0, NOW(3), NOW(3))
      `);
      await connection.query("DELETE FROM quotes WHERE id = 'orc-p8-c'");
      const [restantes] = await connection.query<mysql.RowDataPacket[]>(
        'SELECT COUNT(*) AS total FROM quote_items',
      );
      expect(restantes[0]).toMatchObject({ total: 0 });

      // E a OS com orcamento nao pode simplesmente sumir (ON DELETE RESTRICT).
      await expect(
        connection.query("DELETE FROM service_orders WHERE id = 'so-p8-a'"),
      ).rejects.toThrow();
    } finally {
      await connection.end();
      rmSync(folder, { recursive: true, force: true });
      await adminConnection.query(`DROP DATABASE IF EXISTS \`${stepDb}\``);
    }
  });

  it('leva um banco do Prompt 09, com orcamentos, ate o Prompt 10 sem perda', async () => {
    const stepDb = 'nexo56_migration_step10_test';
    await adminConnection.query(`DROP DATABASE IF EXISTS \`${stepDb}\``);
    await adminConnection.query(
      `CREATE DATABASE \`${stepDb}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );

    const folder = buildFolderUpTo('0007');
    const connection = await mysql.createConnection({
      uri: urlForDatabase(stepDb),
      timezone: 'Z',
      multipleStatements: true,
    });

    try {
      // --- banco no estado do Prompt 09 --------------------------------------
      await migrate(drizzle(connection), { migrationsFolder: folder });

      const [beforeTables] = await connection.query<mysql.RowDataPacket[]>('SHOW TABLES');
      const beforeNames = beforeTables.map((row) => Object.values(row)[0] as string);
      expect(beforeNames).toContain('quotes');
      expect(beforeNames).not.toContain('parts');
      expect(beforeNames).not.toContain('stock_balances');

      await connection.query(`
        INSERT INTO plans (id, \`key\`, name, description, is_internal, created_at, updated_at)
        VALUES ('plan-p9', 'internal', 'Plano interno', '', 1, NOW(3), NOW(3));

        INSERT INTO tenants (id, slug, name, status, timezone, plan_id, created_at, updated_at)
        VALUES ('tenant-p9', 'empresa-p9', 'Empresa P9', 'active', 'America/Sao_Paulo', 'plan-p9', NOW(3), NOW(3)),
               ('tenant-p9b', 'empresa-p9b', 'Empresa P9B', 'active', 'UTC', 'plan-p9', NOW(3), NOW(3));

        INSERT INTO units (id, tenant_id, name, status, created_at, updated_at)
        VALUES ('unit-p9', 'tenant-p9', 'Unidade P9', 'active', NOW(3), NOW(3)),
               ('unit-p9b', 'tenant-p9', 'Unidade P9 Norte', 'active', NOW(3), NOW(3)),
               ('unit-p9x', 'tenant-p9b', 'Unidade de outra empresa', 'active', NOW(3), NOW(3));

        INSERT INTO users (id, tenant_id, email, name, password_hash, status, created_at, updated_at)
        VALUES ('user-p9', 'tenant-p9', 'p9@empresa.invalid', 'Usuario P9', 'scrypt$65536$8$2$c2FsdA==$aGFzaA==', 'active', NOW(3), NOW(3));

        INSERT INTO customers
          (id, tenant_id, kind, name, name_normalized, status, created_at, updated_at, created_by)
        VALUES ('cli-p9', 'tenant-p9', 'individual', 'Ana Prado', 'ana prado', 'active', NOW(3), NOW(3), 'user-p9');

        INSERT INTO equipment
          (id, tenant_id, customer_id, kind, kind_normalized, voltage, status,
           created_at, updated_at, created_by)
        VALUES ('eq-p9', 'tenant-p9', 'cli-p9', 'Televisor', 'televisor', 'bivolt', 'active',
                NOW(3), NOW(3), 'user-p9');

        INSERT INTO service_orders
          (id, tenant_id, unit_id, number, customer_id, equipment_id, status, customer_report,
           opened_at, version, follow_up_at, status_changed_at, created_by, created_at, updated_at)
        VALUES
          ('so-p9-a', 'tenant-p9', 'unit-p9', 1, 'cli-p9', 'eq-p9', 'awaiting_repair',
           'Imagem piscando.', NOW(3), 6, '2026-11-05', NOW(3), 'user-p9', NOW(3), NOW(3)),
          ('so-p9-b', 'tenant-p9', 'unit-p9b', 2, 'cli-p9', 'eq-p9', 'in_repair',
           'Sem som.', NOW(3), 3, NULL, NOW(3), 'user-p9', NOW(3), NOW(3));

        INSERT INTO service_order_tasks
          (id, tenant_id, unit_id, service_order_id, kind, title, status, open_marker,
           created_at, updated_at)
        VALUES ('task-p9', 'tenant-p9', 'unit-p9', 'so-p9-a', 'part_pickup', 'Buscar peca',
                'open', 1, NOW(3), NOW(3));

        INSERT INTO service_order_timeline
          (id, tenant_id, service_order_id, kind, summary, actor_id, occurred_at)
        VALUES ('tl-p9', 'tenant-p9', 'so-p9-a', 'status_changed', 'Situacao alterada',
                'user-p9', NOW(3));

        INSERT INTO quotes
          (id, tenant_id, unit_id, service_order_id, number, revision, status, approved_marker,
           subtotal, discount, total, currency, version, created_by, created_at, updated_at)
        VALUES ('orc-p9-v1', 'tenant-p9', 'unit-p9', 'so-p9-a', 7, 1, 'superseded', NULL,
                '300.00', '0.00', '300.00', 'BRL', 2, 'user-p9', NOW(3), NOW(3)),
               ('orc-p9-v2', 'tenant-p9', 'unit-p9', 'so-p9-a', 7, 2, 'approved', 1,
                '450.00', '50.00', '400.00', 'BRL', 3, 'user-p9', NOW(3), NOW(3));

        INSERT INTO quote_items
          (id, tenant_id, quote_id, kind, description, quantity, unit_price, discount, total,
           position, created_at, updated_at)
        VALUES ('qi-p9-1', 'tenant-p9', 'orc-p9-v2', 'part', 'Tela LCD escrita a mao',
                '2.0000', '200.00', '0.00', '400.00', 0, NOW(3), NOW(3)),
               ('qi-p9-2', 'tenant-p9', 'orc-p9-v2', 'service', 'Bancada',
                '1.0000', '50.00', '0.00', '50.00', 1, NOW(3), NOW(3));

        INSERT INTO quote_timeline
          (id, tenant_id, quote_id, kind, summary, actor_id, occurred_at)
        VALUES ('qt-p9', 'tenant-p9', 'orc-p9-v2', 'approved', 'Orcamento aprovado',
                'user-p9', NOW(3));

        INSERT INTO tenant_sequences (tenant_id, sequence_type, current_value, prefix, padding, updated_at)
        VALUES ('tenant-p9', 'service_order', 2, 'OS', 6, NOW(3)),
               ('tenant-p9', 'quote', 7, 'ORC', 6, NOW(3));

        INSERT INTO domain_events (id, type, tenant_id, payload, occurred_at)
        VALUES ('ev-p9', 'QUOTE_APPROVED', 'tenant-p9', '{}', NOW(3));
      `);

      // --- aplica o Prompt 10 -------------------------------------------------
      await migrate(drizzle(connection), { migrationsFolder: './drizzle' });

      const [rows] = await connection.query<mysql.RowDataPacket[]>(`
        SELECT
          (SELECT COUNT(*) FROM service_orders)         AS ordens,
          (SELECT COUNT(*) FROM service_order_tasks)    AS tarefas,
          (SELECT COUNT(*) FROM service_order_timeline) AS linha_do_tempo,
          (SELECT COUNT(*) FROM quotes)                 AS orcamentos,
          (SELECT COUNT(*) FROM quote_items)            AS itens,
          (SELECT COUNT(*) FROM quote_timeline)         AS historico,
          (SELECT COUNT(*) FROM domain_events)          AS eventos,
          (SELECT COUNT(part_id) FROM quote_items)      AS itens_com_peca,
          (SELECT status  FROM service_orders WHERE id='so-p9-a') AS situacao_a,
          (SELECT version FROM service_orders WHERE id='so-p9-a') AS versao_a,
          (SELECT follow_up_at FROM service_orders WHERE id='so-p9-a') AS prazo_a,
          (SELECT status  FROM quotes WHERE id='orc-p9-v2')       AS situacao_orc,
          (SELECT revision FROM quotes WHERE id='orc-p9-v2')      AS revisao_orc,
          (SELECT total   FROM quotes WHERE id='orc-p9-v2')       AS total_orc,
          (SELECT description FROM quote_items WHERE id='qi-p9-1') AS descricao_item,
          (SELECT current_value FROM tenant_sequences
            WHERE tenant_id='tenant-p9' AND sequence_type='quote') AS sequencia_orc
      `);

      /**
       * NADA DO PROMPT 09 FOI TOCADO (itens 129 e 130). A migration e aditiva:
       * nenhuma OS muda de situacao, nenhum orcamento muda de total, e TODAS as
       * linhas PART existentes continuam validas com vinculo NULO.
       */
      expect(rows[0]).toMatchObject({
        ordens: 2,
        tarefas: 1,
        linha_do_tempo: 1,
        orcamentos: 2,
        itens: 2,
        historico: 1,
        eventos: 1,
        itens_com_peca: 0,
        situacao_a: 'awaiting_repair',
        versao_a: 6,
        prazo_a: '2026-11-05',
        situacao_orc: 'approved',
        revisao_orc: 2,
        total_orc: '400.00',
        descricao_item: 'Tela LCD escrita a mao',
        sequencia_orc: 7,
      });

      const [afterTables] = await connection.query<mysql.RowDataPacket[]>('SHOW TABLES');
      const afterNames = afterTables.map((row) => Object.values(row)[0] as string);
      expect(afterNames).toEqual(
        expect.arrayContaining([
          'parts',
          'stock_locations',
          'stock_balances',
          'stock_movements',
          'stock_reservations',
          'stock_transfers',
        ]),
      );

      // --- as invariantes novas, provadas no banco ----------------------------
      await connection.query(`
        INSERT INTO parts
          (id, tenant_id, code, code_normalized, name, name_search, unit_of_measure,
           status, version, created_by, created_at, updated_at)
        VALUES ('peca-p9', 'tenant-p9', 'TELA-01', 'TELA01', 'Tela LCD', 'tela lcd', 'unit',
                'active', 1, 'user-p9', NOW(3), NOW(3))
      `);

      // Codigo interno unico por empresa (item 12).
      await expect(
        connection.query(`
          INSERT INTO parts
            (id, tenant_id, code, code_normalized, name, name_search, unit_of_measure,
             status, version, created_at, updated_at)
          VALUES ('peca-p9-dup', 'tenant-p9', 'tela 01', 'TELA01', 'Outra tela', 'outra tela',
                  'unit', 'active', 1, NOW(3), NOW(3))
        `),
      ).rejects.toThrow();

      // Peca de outra empresa nao entra numa linha de orcamento desta (item 124).
      await connection.query(`
        INSERT INTO parts
          (id, tenant_id, code, code_normalized, name, name_search, unit_of_measure,
           status, version, created_at, updated_at)
        VALUES ('peca-p9x', 'tenant-p9b', 'TELA-01', 'TELA01', 'Tela de outra empresa',
                'tela de outra empresa', 'unit', 'active', 1, NOW(3), NOW(3))
      `);
      await expect(
        connection.query("UPDATE quote_items SET part_id = 'peca-p9x' WHERE id = 'qi-p9-1'"),
      ).rejects.toThrow();

      // Vincular peca da MESMA empresa e legitimo, e nao muda o snapshot.
      await connection.query("UPDATE quote_items SET part_id = 'peca-p9' WHERE id = 'qi-p9-1'");
      const [snapshot] = await connection.query<mysql.RowDataPacket[]>(
        "SELECT description, unit_price, total FROM quote_items WHERE id = 'qi-p9-1'",
      );
      expect(snapshot[0]).toMatchObject({
        description: 'Tela LCD escrita a mao',
        unit_price: '200.00',
        total: '400.00',
      });

      // Saldo negativo e recusado pela CHECK (item 123).
      await expect(
        connection.query(`
          INSERT INTO stock_balances
            (id, tenant_id, unit_id, part_id, on_hand, reserved, minimum_quantity,
             version, created_at, updated_at)
          VALUES ('saldo-neg', 'tenant-p9', 'unit-p9', 'peca-p9', '-1.0000', '0.0000', '0.0000',
                  1, NOW(3), NOW(3))
        `),
      ).rejects.toThrow();

      // Reservado maior que o fisico tambem (item 123).
      await expect(
        connection.query(`
          INSERT INTO stock_balances
            (id, tenant_id, unit_id, part_id, on_hand, reserved, minimum_quantity,
             version, created_at, updated_at)
          VALUES ('saldo-res', 'tenant-p9', 'unit-p9', 'peca-p9', '1.0000', '2.0000', '0.0000',
                  1, NOW(3), NOW(3))
        `),
      ).rejects.toThrow();

      // Movimento apontando para OS de OUTRA unidade e recusado (item 127).
      await expect(
        connection.query(`
          INSERT INTO stock_movements
            (id, tenant_id, unit_id, part_id, type, quantity, resulting_on_hand,
             origin_kind, service_order_id, occurred_at, created_at)
          VALUES ('mov-x', 'tenant-p9', 'unit-p9', 'peca-p9', 'issue', '-1.0000', '0.0000',
                  'service_order', 'so-p9-b', NOW(3), NOW(3))
        `),
      ).rejects.toThrow();

      // Transferencia cruzando empresas e recusada (item 54).
      await expect(
        connection.query(`
          INSERT INTO stock_transfers
            (id, tenant_id, number, from_unit_id, to_unit_id, part_id, quantity, status,
             created_at, updated_at)
          VALUES ('trf-x', 'tenant-p9', 1, 'unit-p9', 'unit-p9x', 'peca-p9', '1.0000',
                  'completed', NOW(3), NOW(3))
        `),
      ).rejects.toThrow();

      // Reserva consumindo mais do que reservou e recusada (item 105).
      await expect(
        connection.query(`
          INSERT INTO stock_reservations
            (id, tenant_id, unit_id, part_id, service_order_id, quantity,
             consumed_quantity, released_quantity, status, version, created_at, updated_at)
          VALUES ('res-x', 'tenant-p9', 'unit-p9', 'peca-p9', 'so-p9-a', '2.0000',
                  '3.0000', '0.0000', 'open', 1, NOW(3), NOW(3))
        `),
      ).rejects.toThrow();
    } finally {
      await connection.end();
      rmSync(folder, { recursive: true, force: true });
      await adminConnection.query(`DROP DATABASE IF EXISTS \`${stepDb}\``);
    }
  });

  it('leva um banco do Prompt 10, com estoque movimentado, ate o Prompt 11 sem perda', async () => {
    const stepDb = 'nexo56_migration_step11_test';
    await adminConnection.query(`DROP DATABASE IF EXISTS \`${stepDb}\``);
    await adminConnection.query(
      `CREATE DATABASE \`${stepDb}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );

    const folder = buildFolderUpTo('0008');
    const connection = await mysql.createConnection({
      uri: urlForDatabase(stepDb),
      timezone: 'Z',
      multipleStatements: true,
    });

    try {
      // --- banco no estado do Prompt 10 --------------------------------------
      await migrate(drizzle(connection), { migrationsFolder: folder });

      const [beforeTables] = await connection.query<mysql.RowDataPacket[]>('SHOW TABLES');
      const beforeNames = beforeTables.map((row) => Object.values(row)[0] as string);
      expect(beforeNames).toContain('stock_movements');
      expect(beforeNames).not.toContain('suppliers');
      expect(beforeNames).not.toContain('purchase_orders');

      await connection.query(`
        INSERT INTO plans (id, \`key\`, name, description, is_internal, created_at, updated_at)
        VALUES ('plan-p10', 'internal', 'Plano interno', '', 1, NOW(3), NOW(3));

        INSERT INTO tenants (id, slug, name, status, timezone, plan_id, created_at, updated_at)
        VALUES ('tenant-p10', 'empresa-p10', 'Empresa P10', 'active', 'America/Sao_Paulo', 'plan-p10', NOW(3), NOW(3)),
               ('tenant-p10b', 'empresa-p10b', 'Empresa P10B', 'active', 'UTC', 'plan-p10', NOW(3), NOW(3));

        INSERT INTO units (id, tenant_id, name, status, created_at, updated_at)
        VALUES ('unit-p10', 'tenant-p10', 'Unidade P10', 'active', NOW(3), NOW(3)),
               ('unit-p10b', 'tenant-p10', 'Unidade P10 Norte', 'active', NOW(3), NOW(3)),
               ('unit-p10x', 'tenant-p10b', 'Unidade de outra empresa', 'active', NOW(3), NOW(3));

        INSERT INTO users (id, tenant_id, email, name, password_hash, status, created_at, updated_at)
        VALUES ('user-p10', 'tenant-p10', 'p10@empresa.invalid', 'Usuario P10', 'scrypt$65536$8$2$c2FsdA==$aGFzaA==', 'active', NOW(3), NOW(3));

        INSERT INTO customers
          (id, tenant_id, kind, name, name_normalized, status, created_at, updated_at, created_by)
        VALUES ('cli-p10', 'tenant-p10', 'individual', 'Bruno Lima', 'bruno lima', 'active', NOW(3), NOW(3), 'user-p10');

        INSERT INTO equipment
          (id, tenant_id, customer_id, kind, kind_normalized, voltage, status,
           created_at, updated_at, created_by)
        VALUES ('eq-p10', 'tenant-p10', 'cli-p10', 'Televisor', 'televisor', 'bivolt', 'active',
                NOW(3), NOW(3), 'user-p10');

        INSERT INTO service_orders
          (id, tenant_id, unit_id, number, customer_id, equipment_id, status, customer_report,
           opened_at, version, status_changed_at, created_by, created_at, updated_at)
        VALUES
          ('so-p10-a', 'tenant-p10', 'unit-p10', 1, 'cli-p10', 'eq-p10', 'awaiting_repair',
           'Nao liga.', NOW(3), 4, NOW(3), 'user-p10', NOW(3), NOW(3)),
          ('so-p10-b', 'tenant-p10', 'unit-p10b', 2, 'cli-p10', 'eq-p10', 'in_repair',
           'Sem imagem.', NOW(3), 2, NOW(3), 'user-p10', NOW(3), NOW(3));

        INSERT INTO parts
          (id, tenant_id, code, code_normalized, name, name_search, unit_of_measure, status,
           version, created_at, updated_at, created_by)
        VALUES ('peca-p10', 'tenant-p10', 'TELA-01', 'TELA01', 'Tela LCD', 'tela lcd', 'unit',
                'active', 1, NOW(3), NOW(3), 'user-p10');

        INSERT INTO stock_balances
          (id, tenant_id, unit_id, part_id, on_hand, reserved, minimum_quantity, average_cost,
           version, created_at, updated_at)
        VALUES ('saldo-p10', 'tenant-p10', 'unit-p10', 'peca-p10', '5.0000', '0.0000', '2.0000',
                '120.00', 1, NOW(3), NOW(3));

        INSERT INTO stock_movements
          (id, tenant_id, unit_id, part_id, type, quantity, resulting_on_hand, unit_cost,
           total_cost, origin_kind, reference, occurred_at, created_at)
        VALUES ('mov-p10', 'tenant-p10', 'unit-p10', 'peca-p10', 'receipt', '5.0000', '5.0000',
                '120.00', '600.00', 'manual', 'NF 998', NOW(3), NOW(3));
      `);

      // --- upgrade para o Prompt 11 ------------------------------------------
      await migrate(drizzle(connection), { migrationsFolder: './drizzle' });

      const [afterTables] = await connection.query<mysql.RowDataPacket[]>('SHOW TABLES');
      const afterNames = afterTables.map((row) => Object.values(row)[0] as string);
      for (const tabela of [
        'suppliers',
        'supplier_contacts',
        'supplier_parts',
        'purchase_price_history',
        'purchase_needs',
        'purchase_orders',
        'purchase_order_items',
        'purchase_receipts',
        'purchase_receipt_items',
        'purchase_order_timeline',
      ]) {
        expect(afterNames).toContain(tabela);
      }

      /**
       * NENHUMA TABELA FINANCEIRA (itens 41 e 88). Compras prepara o terreno
       * para Contas a Pagar; nao a implementa.
       */
      for (const proibida of ['accounts_payable', 'payments', 'financial_entries', 'invoices']) {
        expect(afterNames).not.toContain(proibida);
      }

      // O estoque do Prompt 10 continua intacto.
      const [saldos] = await connection.query<mysql.RowDataPacket[]>(
        'SELECT on_hand, average_cost FROM stock_balances WHERE id = ?',
        ['saldo-p10'],
      );
      expect(saldos[0]).toMatchObject({ on_hand: '5.0000', average_cost: '120.00' });

      const [movimentos] = await connection.query<mysql.RowDataPacket[]>(
        'SELECT reference, origin_kind FROM stock_movements WHERE id = ?',
        ['mov-p10'],
      );
      expect(movimentos[0]).toMatchObject({ reference: 'NF 998', origin_kind: 'manual' });

      // A UNIQUE nova em stock_movements — o alvo da FK de rastreabilidade.
      const [indices] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT index_name FROM information_schema.statistics
          WHERE table_schema = ? AND table_name = 'stock_movements'
            AND index_name = 'uq_stock_movement_id_tenant'`,
        [stepDb],
      );
      expect(indices.length).toBeGreaterThan(0);

      // --- as invariantes novas valem no banco -------------------------------
      await connection.query(`
        INSERT INTO suppliers
          (id, tenant_id, kind, name, name_search, status, version, created_at, updated_at)
        VALUES ('forn-p10', 'tenant-p10', 'company', 'Distribuidora P10', 'distribuidora p10',
                'active', 1, NOW(3), NOW(3)),
               ('forn-p10x', 'tenant-p10b', 'company', 'Distribuidora alheia', 'distribuidora alheia',
                'active', 1, NOW(3), NOW(3));

        INSERT INTO purchase_orders
          (id, tenant_id, unit_id, supplier_id, number, status, subtotal, discount, freight,
           other_costs, total, version, created_by, created_at, updated_at)
        VALUES ('pc-p10', 'tenant-p10', 'unit-p10', 'forn-p10', 1, 'placed', '250.00', '0.00',
                '30.00', '0.00', '280.00', 1, 'user-p10', NOW(3), NOW(3));
      `);

      // Pedido apontando para fornecedor de OUTRA empresa e recusado (item 78).
      await expect(
        connection.query(`
          INSERT INTO purchase_orders
            (id, tenant_id, unit_id, supplier_id, number, status, subtotal, discount, freight,
             other_costs, total, version, created_by, created_at, updated_at)
          VALUES ('pc-x', 'tenant-p10', 'unit-p10', 'forn-p10x', 2, 'draft', '0.00', '0.00',
                  '0.00', '0.00', '0.00', 1, 'user-p10', NOW(3), NOW(3))
        `),
      ).rejects.toThrow();

      // Item com recebido MAIOR que o pedido e recusado pela CHECK (item 22).
      await expect(
        connection.query(`
          INSERT INTO purchase_order_items
            (id, tenant_id, purchase_order_id, part_id, description, unit_of_measure, position,
             quantity, received_quantity, unit_cost, total, created_at, updated_at)
          VALUES ('item-x', 'tenant-p10', 'pc-p10', 'peca-p10', 'Tela LCD', 'unit', 1,
                  '10.0000', '11.0000', '25.00', '250.00', NOW(3), NOW(3))
        `),
      ).rejects.toThrow();

      // Necessidade apontando para OS de OUTRA unidade e recusada (item 79).
      await expect(
        connection.query(`
          INSERT INTO purchase_needs
            (id, tenant_id, unit_id, part_id, quantity, ordered_quantity, received_quantity,
             origin, service_order_id, status, version, created_by, created_at, updated_at)
          VALUES ('nec-x', 'tenant-p10', 'unit-p10', 'peca-p10', '1.0000', '0.0000', '0.0000',
                  'service_order', 'so-p10-b', 'open', 1, 'user-p10', NOW(3), NOW(3))
        `),
      ).rejects.toThrow();

      // Recebimento apontando para pedido de OUTRA unidade e recusado (item 79).
      await expect(
        connection.query(`
          INSERT INTO purchase_receipts
            (id, tenant_id, unit_id, purchase_order_id, received_at, created_by, created_at, updated_at)
          VALUES ('rec-x', 'tenant-p10', 'unit-p10b', 'pc-p10', NOW(3), 'user-p10', NOW(3), NOW(3))
        `),
      ).rejects.toThrow();

      // A necessidade legitima, na mesma unidade da OS, passa.
      await connection.query(`
        INSERT INTO purchase_needs
          (id, tenant_id, unit_id, part_id, quantity, ordered_quantity, received_quantity,
           origin, service_order_id, status, version, created_by, created_at, updated_at)
        VALUES ('nec-ok', 'tenant-p10', 'unit-p10', 'peca-p10', '1.0000', '0.0000', '0.0000',
                'service_order', 'so-p10-a', 'open', 1, 'user-p10', NOW(3), NOW(3))
      `);

      const [necessidades] = await connection.query<mysql.RowDataPacket[]>(
        'SELECT status FROM purchase_needs WHERE id = ?',
        ['nec-ok'],
      );
      expect(necessidades[0]).toMatchObject({ status: 'open' });
    } finally {
      await connection.end();
      rmSync(folder, { recursive: true, force: true });
      await adminConnection.query(`DROP DATABASE IF EXISTS \`${stepDb}\``);
    }
  });

  it('leva um banco do Prompt 11, com compras e estoque, ate o Prompt 12 sem perda', async () => {
    const stepDb = 'nexo56_migration_step12_test';
    await adminConnection.query(`DROP DATABASE IF EXISTS \`${stepDb}\``);
    await adminConnection.query(
      `CREATE DATABASE \`${stepDb}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );

    const folder = buildFolderUpTo('0009');
    const connection = await mysql.createConnection({
      uri: urlForDatabase(stepDb),
      timezone: 'Z',
      multipleStatements: true,
    });

    try {
      // --- banco no estado do Prompt 11 --------------------------------------
      await migrate(drizzle(connection), { migrationsFolder: folder });

      const [beforeTables] = await connection.query<mysql.RowDataPacket[]>('SHOW TABLES');
      const beforeNames = beforeTables.map((row) => Object.values(row)[0] as string);
      expect(beforeNames).toContain('purchase_orders');
      expect(beforeNames).toContain('stock_movements');
      expect(beforeNames).not.toContain('financial_titles');

      await connection.query(`
        INSERT INTO plans (id, \`key\`, name, description, is_internal, created_at, updated_at)
        VALUES ('plan-p11', 'internal', 'Plano interno', '', 1, NOW(3), NOW(3));

        INSERT INTO tenants (id, slug, name, status, timezone, plan_id, created_at, updated_at)
        VALUES ('tenant-p11', 'empresa-p11', 'Empresa P11', 'active', 'America/Sao_Paulo', 'plan-p11', NOW(3), NOW(3)),
               ('tenant-p11b', 'empresa-p11b', 'Empresa P11B', 'active', 'UTC', 'plan-p11', NOW(3), NOW(3));

        INSERT INTO units (id, tenant_id, name, status, created_at, updated_at)
        VALUES ('unit-p11', 'tenant-p11', 'Unidade P11', 'active', NOW(3), NOW(3)),
               ('unit-p11b', 'tenant-p11', 'Unidade P11 Norte', 'active', NOW(3), NOW(3)),
               ('unit-p11x', 'tenant-p11b', 'Unidade de outra empresa', 'active', NOW(3), NOW(3));

        INSERT INTO users (id, tenant_id, email, name, password_hash, status, created_at, updated_at)
        VALUES ('user-p11', 'tenant-p11', 'p11@empresa.invalid', 'Usuario P11', 'scrypt$65536$8$2$c2FsdA==$aGFzaA==', 'active', NOW(3), NOW(3));

        INSERT INTO customers
          (id, tenant_id, kind, name, name_normalized, status, created_at, updated_at, created_by)
        VALUES ('cli-p11', 'tenant-p11', 'individual', 'Carla Souza', 'carla souza', 'active', NOW(3), NOW(3), 'user-p11'),
               ('cli-p11x', 'tenant-p11b', 'individual', 'Cliente alheio', 'cliente alheio', 'active', NOW(3), NOW(3), 'user-p11');

        INSERT INTO equipment
          (id, tenant_id, customer_id, kind, kind_normalized, voltage, status,
           created_at, updated_at, created_by)
        VALUES ('eq-p11', 'tenant-p11', 'cli-p11', 'Televisor', 'televisor', 'bivolt', 'active',
                NOW(3), NOW(3), 'user-p11');

        INSERT INTO service_orders
          (id, tenant_id, unit_id, number, customer_id, equipment_id, status, customer_report,
           opened_at, version, status_changed_at, created_by, created_at, updated_at)
        VALUES
          ('so-p11', 'tenant-p11', 'unit-p11', 1, 'cli-p11', 'eq-p11', 'awaiting_repair',
           'Nao liga.', NOW(3), 4, NOW(3), 'user-p11', NOW(3), NOW(3)),
          ('so-p11b', 'tenant-p11', 'unit-p11b', 2, 'cli-p11', 'eq-p11', 'in_repair',
           'Sem som.', NOW(3), 2, NOW(3), 'user-p11', NOW(3), NOW(3));

        INSERT INTO quotes
          (id, tenant_id, unit_id, service_order_id, number, revision, status,
           subtotal, discount, total, version, created_by, created_at, updated_at)
        VALUES ('orc-p11', 'tenant-p11', 'unit-p11', 'so-p11', 1, 1, 'approved',
                '900.00', '0.00', '900.00', 2, 'user-p11', NOW(3), NOW(3));

        INSERT INTO parts
          (id, tenant_id, code, code_normalized, name, name_search, unit_of_measure, status,
           version, created_at, updated_at, created_by)
        VALUES ('peca-p11', 'tenant-p11', 'TELA-01', 'TELA01', 'Tela LCD', 'tela lcd', 'unit',
                'active', 1, NOW(3), NOW(3), 'user-p11');

        INSERT INTO stock_balances
          (id, tenant_id, unit_id, part_id, on_hand, reserved, minimum_quantity, average_cost,
           version, created_at, updated_at)
        VALUES ('saldo-p11', 'tenant-p11', 'unit-p11', 'peca-p11', '10.0000', '0.0000', '2.0000',
                '100.00', 1, NOW(3), NOW(3));

        INSERT INTO stock_movements
          (id, tenant_id, unit_id, part_id, type, quantity, resulting_on_hand, unit_cost,
           total_cost, origin_kind, reference, occurred_at, created_at)
        VALUES ('mov-p11', 'tenant-p11', 'unit-p11', 'peca-p11', 'receipt', '10.0000', '10.0000',
                '100.00', '1000.00', 'purchase_order', 'PC 000001', NOW(3), NOW(3));

        INSERT INTO suppliers
          (id, tenant_id, kind, name, name_search, status, version, created_at, updated_at)
        VALUES ('forn-p11', 'tenant-p11', 'company', 'Distribuidora P11', 'distribuidora p11',
                'active', 1, NOW(3), NOW(3));

        INSERT INTO purchase_needs
          (id, tenant_id, unit_id, part_id, quantity, ordered_quantity, received_quantity,
           origin, status, version, created_by, created_at, updated_at)
        VALUES ('nec-p11', 'tenant-p11', 'unit-p11', 'peca-p11', '10.0000', '10.0000', '10.0000',
                'manual', 'fulfilled', 3, 'user-p11', NOW(3), NOW(3));

        INSERT INTO purchase_orders
          (id, tenant_id, unit_id, supplier_id, number, status, subtotal, discount, freight,
           other_costs, total, version, created_by, created_at, updated_at)
        VALUES ('pc-p11', 'tenant-p11', 'unit-p11', 'forn-p11', 1, 'received', '1000.00', '0.00',
                '0.00', '0.00', '1000.00', 4, 'user-p11', NOW(3), NOW(3));

        INSERT INTO purchase_order_items
          (id, tenant_id, purchase_order_id, part_id, description, unit_of_measure, position,
           quantity, received_quantity, unit_cost, total, created_at, updated_at)
        VALUES ('pci-p11', 'tenant-p11', 'pc-p11', 'peca-p11', 'Tela LCD', 'unit', 1,
                '10.0000', '10.0000', '100.00', '1000.00', NOW(3), NOW(3));

        INSERT INTO purchase_receipts
          (id, tenant_id, unit_id, purchase_order_id, received_at, document_number,
           created_by, created_at, updated_at)
        VALUES ('rec-p11', 'tenant-p11', 'unit-p11', 'pc-p11', NOW(3), 'NF 4321',
                'user-p11', NOW(3), NOW(3));

        INSERT INTO purchase_price_history
          (id, tenant_id, supplier_id, part_id, unit_id, purchase_order_id, purchase_receipt_id,
           quantity, unit_cost, total_cost, occurred_at, created_at)
        VALUES ('hist-p11', 'tenant-p11', 'forn-p11', 'peca-p11', 'unit-p11', 'pc-p11', 'rec-p11',
                '10.0000', '100.00', '1000.00', NOW(3), NOW(3));
      `);

      // --- upgrade para o Prompt 12 ------------------------------------------
      await migrate(drizzle(connection), { migrationsFolder: './drizzle' });

      const [afterTables] = await connection.query<mysql.RowDataPacket[]>('SHOW TABLES');
      const afterNames = afterTables.map((row) => Object.values(row)[0] as string);
      for (const tabela of [
        'financial_accounts',
        'payment_methods',
        'financial_categories',
        'financial_titles',
        'financial_installments',
        'financial_settlements',
        'financial_movements',
        'cash_sessions',
        'financial_title_timeline',
      ]) {
        expect(afterNames).toContain(tabela);
      }

      /**
       * NENHUMA TABELA DE CONTABILIDADE OU FISCAL (itens 80 e 82). O Prompt 12
       * e financeiro OPERACIONAL: nao ha razao contabil, plano de contas, nem
       * nota fiscal.
       */
      for (const proibida of [
        'accounting_entries',
        'chart_of_accounts',
        'general_ledger',
        'fiscal_invoices',
        'bank_statements',
      ]) {
        expect(afterNames).not.toContain(proibida);
      }

      // --- TUDO do Prompt 11 continua exatamente onde estava ------------------
      const preservados: Array<[string, string, Record<string, unknown>]> = [
        ['service_orders', 'so-p11', { status: 'awaiting_repair', number: 1 }],
        ['quotes', 'orc-p11', { status: 'approved', total: '900.00' }],
        ['stock_balances', 'saldo-p11', { on_hand: '10.0000', average_cost: '100.00' }],
        ['stock_movements', 'mov-p11', { reference: 'PC 000001', origin_kind: 'purchase_order' }],
        ['suppliers', 'forn-p11', { name: 'Distribuidora P11', status: 'active' }],
        ['purchase_orders', 'pc-p11', { status: 'received', total: '1000.00' }],
        ['purchase_order_items', 'pci-p11', { received_quantity: '10.0000' }],
        ['purchase_receipts', 'rec-p11', { document_number: 'NF 4321' }],
        ['purchase_price_history', 'hist-p11', { unit_cost: '100.00' }],
        ['purchase_needs', 'nec-p11', { status: 'fulfilled', received_quantity: '10.0000' }],
        ['customers', 'cli-p11', { name: 'Carla Souza' }],
        ['equipment', 'eq-p11', { kind: 'Televisor' }],
        ['parts', 'peca-p11', { code: 'TELA-01' }],
      ];

      for (const [tabela, id, esperado] of preservados) {
        const [linhas] = await connection.query<mysql.RowDataPacket[]>(
          `SELECT * FROM \`${tabela}\` WHERE id = ?`,
          [id],
        );
        expect(linhas, `${tabela}/${id} sumiu no upgrade`).toHaveLength(1);
        expect(linhas[0]).toMatchObject(esperado);
      }

      // --- e o Financeiro ja funciona sobre esse banco -----------------------
      await connection.query(`
        INSERT INTO financial_accounts
          (id, tenant_id, name, name_search, kind, current_balance, status, version,
           created_by, created_at, updated_at)
        VALUES ('conta-p12', 'tenant-p11', 'Banco', 'banco', 'bank', '0.00', 'active', 1,
                'user-p11', NOW(3), NOW(3));

        INSERT INTO payment_methods
          (id, tenant_id, kind, name, name_search, status, position, version,
           created_by, created_at, updated_at)
        VALUES ('metodo-p12', 'tenant-p11', 'pix', 'PIX', 'pix', 'active', 0, 1,
                'user-p11', NOW(3), NOW(3));

        INSERT INTO financial_titles
          (id, tenant_id, unit_id, direction, number, counterparty_kind, customer_id,
           description, origin, origin_key, service_order_id, quote_id, amount, settled_amount,
           issued_at, due_date, installment_count, status, version, created_by, created_at, updated_at)
        VALUES ('tit-p12', 'tenant-p11', 'unit-p11', 'receivable', 1, 'customer', 'cli-p11',
                'Atendimento da OS 000001', 'service_order', 'service_order:so-p11', 'so-p11',
                'orc-p11', '900.00', '0.00', '2026-09-14', '2026-10-15', 1, 'open', 1,
                'user-p11', NOW(3), NOW(3));

        INSERT INTO financial_installments
          (id, tenant_id, unit_id, title_id, number, amount, settled_amount, due_date,
           status, version, created_at, updated_at)
        VALUES ('parc-p12', 'tenant-p11', 'unit-p11', 'tit-p12', 1, '900.00', '0.00',
                '2026-10-15', 'open', 1, NOW(3), NOW(3));

        INSERT INTO financial_settlements
          (id, tenant_id, unit_id, title_id, installment_id, direction, amount, effective_date,
           financial_account_id, payment_method_id, status, created_by, created_at, updated_at)
        VALUES ('liq-p12', 'tenant-p11', 'unit-p11', 'tit-p12', 'parc-p12', 'receivable',
                '900.00', '2026-09-20', 'conta-p12', 'metodo-p12', 'confirmed',
                'user-p11', NOW(3), NOW(3));

        INSERT INTO financial_movements
          (id, tenant_id, unit_id, financial_account_id, direction, amount, resulting_balance,
           origin_kind, settlement_id, effective_date, occurred_at, actor_id, created_at)
        VALUES ('mv-p12', 'tenant-p11', 'unit-p11', 'conta-p12', 'inflow', '900.00', '900.00',
                'settlement', 'liq-p12', '2026-09-20', NOW(3), 'user-p11', NOW(3));

        UPDATE financial_titles SET settled_amount = '900.00', status = 'settled' WHERE id = 'tit-p12';
        UPDATE financial_installments SET settled_amount = '900.00', status = 'settled' WHERE id = 'parc-p12';
      `);

      const [titulo] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT status, settled_amount FROM financial_titles WHERE id = 'tit-p12'`,
      );
      expect(titulo[0]).toMatchObject({ status: 'settled', settled_amount: '900.00' });

      // --- as invariantes novas valem no banco -------------------------------

      /** Conta a receber com fornecedor e recusada pela CHECK (item 8). */
      await expect(
        connection.query(`
          INSERT INTO financial_titles
            (id, tenant_id, unit_id, direction, number, counterparty_kind, supplier_id,
             description, amount, settled_amount, issued_at, due_date, installment_count,
             status, version, created_by, created_at, updated_at)
          VALUES ('tit-x', 'tenant-p11', 'unit-p11', 'receivable', 2, 'supplier', 'forn-p11',
                  'Invalido', '10.00', '0.00', '2026-09-14', '2026-10-15', 1, 'open', 1,
                  'user-p11', NOW(3), NOW(3))
        `),
      ).rejects.toThrow();

      /** Over-settlement e recusado pela CHECK (item 12). */
      await expect(
        connection.query(
          `UPDATE financial_titles SET settled_amount = '1000.00' WHERE id = 'tit-p12'`,
        ),
      ).rejects.toThrow();

      /** Valor zero ou negativo e recusado (item 87). */
      await expect(
        connection.query(`
          INSERT INTO financial_titles
            (id, tenant_id, unit_id, direction, number, counterparty_kind, customer_id,
             description, amount, settled_amount, issued_at, due_date, installment_count,
             status, version, created_by, created_at, updated_at)
          VALUES ('tit-zero', 'tenant-p11', 'unit-p11', 'receivable', 3, 'customer', 'cli-p11',
                  'Zero', '0.00', '0.00', '2026-09-14', '2026-10-15', 1, 'open', 1,
                  'user-p11', NOW(3), NOW(3))
        `),
      ).rejects.toThrow();

      /** Cliente de OUTRA empresa e recusado pela FK composta (item 96). */
      await expect(
        connection.query(`
          INSERT INTO financial_titles
            (id, tenant_id, unit_id, direction, number, counterparty_kind, customer_id,
             description, amount, settled_amount, issued_at, due_date, installment_count,
             status, version, created_by, created_at, updated_at)
          VALUES ('tit-cross', 'tenant-p11', 'unit-p11', 'receivable', 4, 'customer', 'cli-p11x',
                  'Cross-tenant', '10.00', '0.00', '2026-09-14', '2026-10-15', 1, 'open', 1,
                  'user-p11', NOW(3), NOW(3))
        `),
      ).rejects.toThrow();

      /** Titulo apontando para OS de OUTRA unidade e recusado (item 97). */
      await expect(
        connection.query(`
          INSERT INTO financial_titles
            (id, tenant_id, unit_id, direction, number, counterparty_kind, customer_id,
             service_order_id, description, amount, settled_amount, issued_at, due_date,
             installment_count, status, version, created_by, created_at, updated_at)
          VALUES ('tit-unit', 'tenant-p11', 'unit-p11', 'receivable', 5, 'customer', 'cli-p11',
                  'so-p11b', 'Unidade errada', '10.00', '0.00', '2026-09-14', '2026-10-15', 1,
                  'open', 1, 'user-p11', NOW(3), NOW(3))
        `),
      ).rejects.toThrow();

      /** Duas cobrancas para a MESMA OS sao recusadas pela UNIQUE (item 38). */
      await expect(
        connection.query(`
          INSERT INTO financial_titles
            (id, tenant_id, unit_id, direction, number, counterparty_kind, customer_id,
             description, origin, origin_key, amount, settled_amount, issued_at, due_date,
             installment_count, status, version, created_by, created_at, updated_at)
          VALUES ('tit-dup', 'tenant-p11', 'unit-p11', 'receivable', 6, 'customer', 'cli-p11',
                  'Duplicada', 'service_order', 'service_order:so-p11', '10.00', '0.00',
                  '2026-09-14', '2026-10-15', 1, 'open', 1, 'user-p11', NOW(3), NOW(3))
        `),
      ).rejects.toThrow();

      /** Movimento com valor negativo e recusado: o sinal vive na direcao (item 15). */
      await expect(
        connection.query(`
          INSERT INTO financial_movements
            (id, tenant_id, unit_id, financial_account_id, direction, amount, resulting_balance,
             origin_kind, effective_date, occurred_at, created_at)
          VALUES ('mv-neg', 'tenant-p11', 'unit-p11', 'conta-p12', 'inflow', '-10.00', '0.00',
                  'settlement', '2026-09-20', NOW(3), NOW(3))
        `),
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
          // Prompt 07
          'service_orders',
          'service_order_timeline',
          // Prompt 08
          'service_order_tasks',
          // Prompt 09
          'quotes',
          'quote_items',
          'quote_timeline',
          // Prompt 10
          'parts',
          'stock_locations',
          'stock_balances',
          'stock_movements',
          'stock_reservations',
          'stock_transfers',
        ]),
      );
    } finally {
      await connection.end();
      await adminConnection.query(`DROP DATABASE IF EXISTS \`${freshDb}\``);
    }
  });
});
