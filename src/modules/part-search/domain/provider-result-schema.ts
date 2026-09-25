import { z } from 'zod';

/**
 * VALIDACAO DO RESULTADO DO PROVEDOR EXTERNO (Prompt 21, itens 106, 107,
 * 109, 110, 165 a 169).
 *
 * A fonte externa e DADO NAO CONFIAVEL (item 32): cada item passa por este
 * schema antes de virar Candidate/Offer. Um item que falha e IGNORADO
 * individualmente — o restante da resposta continua valida (item 106: "essa
 * resposta" e o item, nunca a chamada inteira).
 *
 * `null` continua `null` em toda parte (item 109): disponibilidade/prazo
 * desconhecidos nunca viram um valor arbitrario so para preencher o campo.
 */
export const MAX_TITLE_LENGTH = 200;
export const MAX_PART_NUMBER_LENGTH = 60;
export const MAX_MANUFACTURER_LENGTH = 120;
export const MAX_SOURCE_NAME_LENGTH = 80;
export const MAX_SELLER_NAME_LENGTH = 160;
export const MAX_RESULTS_PER_PROVIDER = 30;

const priceSchema = z.object({
  /** Sempre string decimal — nunca float (item 182). Validado de novo pelo `Money.parse` do chamador. */
  amount: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,4})?$/, 'Valor de preco invalido — negativo ou mal formado (item 107).'),
  currency: z.literal('BRL'),
});

export const partSearchProviderResultItemSchema = z.object({
  providerResultId: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(MAX_TITLE_LENGTH),
  partNumber: z.string().trim().max(MAX_PART_NUMBER_LENGTH).nullable(),
  manufacturer: z.string().trim().max(MAX_MANUFACTURER_LENGTH).nullable(),
  sourceName: z.string().trim().min(1).max(MAX_SOURCE_NAME_LENGTH),
  price: priceSchema.nullable(),
  availability: z.enum(['available', 'unavailable', 'unknown']).nullable(),
  /** So inteiro >= 0 — nunca inferido de texto vago como "envio em breve" (item 110/185). */
  leadTimeDays: z.number().int().min(0).nullable(),
  url: z.string().trim().max(2048).nullable(),
  compatibilityData: z
    .object({
      exactFit: z.boolean(),
      incompatible: z.boolean(),
      note: z.string().trim().max(300).nullable(),
    })
    .nullable(),
  observedAt: z.date(),
});

export type ValidatedProviderResultItem = z.infer<typeof partSearchProviderResultItemSchema>;

export interface ProviderResultValidation {
  valid: readonly ValidatedProviderResultItem[];
  rejectedCount: number;
}

export function validateProviderResults(items: readonly unknown[]): ProviderResultValidation {
  const capped = items.slice(0, MAX_RESULTS_PER_PROVIDER);
  const valid: ValidatedProviderResultItem[] = [];
  let rejectedCount = 0;

  for (const item of capped) {
    const parsed = partSearchProviderResultItemSchema.safeParse(item);
    if (parsed.success) {
      valid.push(parsed.data);
    } else {
      rejectedCount += 1;
    }
  }

  return { valid, rejectedCount };
}
