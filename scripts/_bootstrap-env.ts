/**
 * Carregador minimo de .env para scripts CLI (migrate, seed, bootstrap, jobs).
 *
 * O Next carrega .env automaticamente; os scripts rodam fora dele. Preferimos
 * um leitor de 30 linhas a mais uma dependencia no runtime de producao.
 *
 * Precedencia: variaveis ja presentes no ambiente real > .env.local > .env
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function loadFile(file: string): void {
  const path = resolve(process.cwd(), file);
  if (!existsSync(path)) return;

  for (const rawLine of readFileSync(path, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const separator = line.indexOf('=');
    if (separator === -1) continue;

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadFile('.env.local');
loadFile('.env');
