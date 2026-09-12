import { z } from 'zod';

/**
 * Validacao de variaveis de ambiente (Prompt 01, itens 44/45).
 *
 * A aplicacao falha de forma explicita quando uma configuracao critica esta
 * ausente ou quando producao tenta subir com segredo de desenvolvimento.
 */

const DEV_PLACEHOLDER = 'troque-este-valor';

const booleanish = z
  .string()
  .transform((value) => value === '1' || value.toLowerCase() === 'true')
  .pipe(z.boolean());

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_URL: z.url(),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL e obrigatoria'),
    TEST_DATABASE_URL: z.string().min(1).optional(),
    SESSION_SECRET: z.string().min(32, 'SESSION_SECRET precisa de ao menos 32 caracteres'),
    JOB_SECRET: z.string().min(32, 'JOB_SECRET precisa de ao menos 32 caracteres'),
    SESSION_TTL_HOURS: z.coerce.number().int().positive().max(720).default(12),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    ALLOW_SEED: booleanish.optional().default(false),
    /**
     * Escape hatch EXPLICITO para validar um build de producao localmente ou
     * em staging sem TLS. Precisa ser ligado de proposito; sem ele, producao
     * com APP_URL http nao sobe. Nunca usar em producao real.
     */
    ALLOW_INSECURE_APP_URL: booleanish.optional().default(false),
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV !== 'production') return;

    for (const key of ['SESSION_SECRET', 'JOB_SECRET'] as const) {
      if (value[key].includes(DEV_PLACEHOLDER)) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `${key} ainda contem o valor de exemplo — gere um segredo real para producao`,
        });
      }
    }

    if (!value.APP_URL.startsWith('https://') && !value.ALLOW_INSECURE_APP_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['APP_URL'],
        message: 'APP_URL deve usar https em producao (cookies Secure dependem disso)',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

/** Le e valida o ambiente uma unica vez por processo. */
export function getEnv(): Env {
  if (cached) return cached;

  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(raiz)'}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `Configuracao de ambiente invalida para o Nexo56.\n${details}\n\n` +
        'Consulte .env.example e o README (secao Variaveis de ambiente).',
    );
  }

  cached = parsed.data;
  return cached;
}

/** Apenas para testes: limpa o cache de ambiente. */
export function resetEnvCache(): void {
  cached = null;
}

export function isProduction(): boolean {
  return getEnv().NODE_ENV === 'production';
}
