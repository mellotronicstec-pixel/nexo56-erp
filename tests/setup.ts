/**
 * Preparacao do ambiente de teste (Prompt 01, item 72).
 *
 * PROTECAO: os testes usam exclusivamente TEST_DATABASE_URL e recusam rodar
 * se essa URL for igual a DATABASE_URL ou se NODE_ENV for production — o banco
 * de producao nunca pode ser alcancado por um teste que trunca tabelas.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function loadEnvFile(file: string): void {
  const path = resolve(process.cwd(), file);
  if (!existsSync(path)) return;
  for (const rawLine of readFileSync(path, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile('.env.test.local');
loadEnvFile('.env.local');
loadEnvFile('.env');

if (process.env.NODE_ENV === 'production') {
  throw new Error('Testes nao rodam com NODE_ENV=production.');
}

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) {
  throw new Error(
    'TEST_DATABASE_URL ausente. Configure um banco de teste dedicado (veja README, secao Testes).',
  );
}

if (testUrl === process.env.DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL nao pode ser igual a DATABASE_URL.');
}

// A partir daqui, toda a aplicacao enxerga o banco de teste.
// `NODE_ENV` e somente-leitura nos tipos do Node; atribuimos via Object.assign.
Object.assign(process.env, { DATABASE_URL: testUrl, NODE_ENV: 'test' });
process.env.APP_URL ??= 'http://localhost:3000';
process.env.SESSION_SECRET ??= 'test-session-secret-com-mais-de-32-caracteres-ok';
process.env.JOB_SECRET ??= 'test-job-secret-com-mais-de-32-caracteres-okay!!';
