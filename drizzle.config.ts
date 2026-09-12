import { defineConfig } from 'drizzle-kit';

/**
 * Configuracao do drizzle-kit (geracao de migrations versionadas).
 *
 * Producao NUNCA usa `push`: as migrations SQL versionadas em ./drizzle sao
 * aplicadas explicitamente por `npm run db:migrate` (Prompt 01, item 47).
 */
export default defineConfig({
  dialect: 'mysql',
  schema: './src/core/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
  verbose: true,
  strict: true,
});
