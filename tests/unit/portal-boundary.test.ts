import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * AS FRONTEIRAS DO PORTAL DO CLIENTE (Prompt 17).
 *
 * A separacao formal Customer != PortalIdentity != InternalUser (itens 7 a 9)
 * so vale se for IMPOSSIVEL de contornar por atalho. Testes de integracao
 * provam que o caminho feliz respeita as regras; este teste impede que
 * alguem, daqui a alguns meses, resolva um chamado chamando `authorize()`
 * dentro do Portal ou importando `modules/portal` de dentro de um modulo
 * operacional.
 */

const SRC = join(process.cwd(), 'src');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : /\.tsx?$/.test(entry) ? [full] : [];
  });
}

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

const FILES = walk(SRC).map((path) => {
  const raw = readFileSync(path, 'utf8');
  return { path, raw, code: stripComments(raw) };
});

const PORTAL = FILES.filter(
  ({ path }) =>
    path.includes(join('modules', 'portal')) ||
    path.includes(join('app', 'portal')) ||
    path.includes(join('app', 'api', 'portal')),
);

const INTERNAL_MODULES = [
  'customers',
  'service-orders',
  'warranties',
  'equipment',
  'auth',
  'access-control',
  'communications',
  'agenda',
  'work-center',
] as const;

describe('o modulo existe', () => {
  it('ha arquivos do Portal para inspecionar', () => {
    expect(PORTAL.length).toBeGreaterThan(0);
  });
});

describe('a dependencia e de mao unica: so o Portal importa os outros', () => {
  for (const modulo of INTERNAL_MODULES) {
    it(`modules/${modulo} nunca importa modules/portal`, () => {
      const alvo = FILES.filter(
        ({ path }) =>
          path.includes(join('modules', modulo)) && !path.includes(join('modules', 'portal')),
      );
      const infratores = alvo.filter(({ code }) => code.includes('modules/portal'));
      expect(infratores.map((f) => f.path)).toEqual([]);
    });
  }
});

describe('o Portal nunca usa RBAC interno (item 9)', () => {
  it('nenhum arquivo do Portal chama authorize()', () => {
    const infratores = PORTAL.filter(({ code }) => /\bauthorize\s*\(/.test(code));
    expect(infratores.map((f) => f.path)).toEqual([]);
  });

  it('nenhum arquivo do Portal importa a autorizacao interna', () => {
    const infratores = PORTAL.filter(({ code }) =>
      code.includes('access-control/application/authorization-service'),
    );
    expect(infratores.map((f) => f.path)).toEqual([]);
  });

  it('nenhum arquivo do Portal resolve TenantContext de sessao interna', () => {
    const infratores = PORTAL.filter(
      ({ code }) => code.includes('getCurrentContext') || code.includes('loadContextForSession'),
    );
    expect(infratores.map((f) => f.path)).toEqual([]);
  });

  it('a camada de aplicacao do Portal nunca importa PERMISSIONS', () => {
    const aplicacao = PORTAL.filter(({ path }) =>
      path.includes(join('modules', 'portal', 'application')),
    );
    const infratores = aplicacao.filter(({ code }) =>
      code.includes('access-control/domain/permissions'),
    );
    expect(infratores.map((f) => f.path)).toEqual([]);
  });
});

describe('o Portal nunca escreve nas tabelas de autenticacao interna', () => {
  it('nao ha insert/update/delete Drizzle contra `sessions` ou `users`', () => {
    const infratores = PORTAL.filter(({ code }) =>
      /\.(insert|update|delete)\s*\(\s*(sessions|users)\b/.test(code),
    );
    expect(infratores.map((f) => f.path)).toEqual([]);
  });
});

describe('negacao no Portal e sempre 404 (item 46)', () => {
  it('as rotas de API do Portal nunca respondem 403', () => {
    const rotas = PORTAL.filter(({ path }) => path.endsWith('route.ts'));
    const infratores = rotas.filter(({ code }) => code.includes('status: 403'));
    expect(infratores.map((f) => f.path)).toEqual([]);
  });
});
