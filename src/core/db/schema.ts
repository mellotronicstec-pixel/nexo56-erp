/**
 * Agregacao do schema para o Drizzle.
 *
 * Cada modulo mantem a definicao das SUAS tabelas em
 * `src/modules/<modulo>/infrastructure/schema.ts`. Este arquivo apenas reune
 * tudo para o cliente e para o drizzle-kit, sem criar uma pasta global de
 * "models" sem contexto de negocio (Prompt 01, item 7).
 */
export * from '@/modules/tenancy/infrastructure/schema';
export * from '@/modules/users/infrastructure/schema';
export * from '@/modules/auth/infrastructure/schema';
export * from '@/modules/access-control/infrastructure/schema';
export * from '@/modules/features/infrastructure/schema';
export * from '@/modules/audit/infrastructure/schema';
export * from '@/modules/events/infrastructure/schema';
export * from '@/modules/jobs/infrastructure/schema';
