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
  // Motor de Automacoes (Prompt 19): tentativa pende da execucao, execucao e
  // versao pendem da regra, unidade da regra pende da regra. Nenhuma FK para
  // OS/cliente/etc — as referencias a outros modulos sao idRef sem FK.
  'automation_action_attempts',
  'automation_executions',
  'automation_rule_versions',
  'automation_rule_units',
  'automation_rules',
  // Comunicacao antes de tudo: anexo e tentativa pendem da mensagem, e a
  // mensagem pende de OS, cliente, unidade e garantia — sao as folhas mais
  // externas que existem hoje.
  'communication_attachments',
  'communication_attempts',
  'communication_messages',
  'communication_templates',
  // Portal: sessao e token pendem da identidade, que pende do cliente.
  'portal_sessions',
  'portal_login_tokens',
  'portal_identities',
  // Agenda primeiro: suas tarefas e compromissos apontam para OS, garantia,
  // aparelho e cliente, entao elas sao as folhas mais externas da arvore.
  'agenda_appointments',
  'agenda_tasks',
  // Filhas antes das maes: com FOREIGN_KEY_CHECKS desligado a ordem nao e
  // obrigatoria, mas manter a lista coerente evita que um esquecimento aqui
  // vire dado vazando de um teste para outro — foi o que aconteceu com
  // `service_order_tasks`, ausente desde o Prompt 08.
  // Garantias antes do Financeiro e das OS: custos e retornos apontam para as
  // duas pontas, e a linha do tempo pende da garantia.
  'warranty_timeline',
  'warranty_costs',
  'warranty_returns',
  'warranty_certificates',
  'warranty_coverage_items',
  'warranties',
  'warranty_policies',
  'financial_movements',
  'financial_settlements',
  'financial_title_timeline',
  'financial_installments',
  'financial_titles',
  'cash_sessions',
  'financial_accounts',
  'payment_methods',
  'financial_categories',
  'quote_timeline',
  'quote_items',
  'quotes',
  'purchase_price_history',
  'purchase_receipt_items',
  'purchase_receipts',
  'purchase_order_timeline',
  'purchase_order_items',
  'purchase_orders',
  'purchase_needs',
  'supplier_parts',
  'supplier_contacts',
  'suppliers',
  'stock_movements',
  'stock_reservations',
  'stock_transfers',
  'stock_balances',
  'stock_locations',
  'parts',
  'service_order_tasks',
  'service_order_timeline',
  'service_orders',
  'equipment_label_readings',
  'equipment_media',
  'equipment_intake_accessories',
  'equipment_intake_conditions',
  'equipment_intakes',
  'equipment',
  'customer_contacts',
  'customer_addresses',
  'customers',
  'password_reset_tokens',
  'user_unit_roles',
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
  'tenant_sequences',
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
