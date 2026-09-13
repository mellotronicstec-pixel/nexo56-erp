import { z } from 'zod';
import {
  CUSTOMER_KINDS,
  DOCUMENT_TYPE_FOR_KIND,
  type CustomerKind,
} from '@/modules/customers/domain/customer';
import { isValidDocument, onlyDigits } from '@/modules/customers/domain/document';
import { isValidPhone, normalizeEmail, normalizePhone } from '@/modules/customers/domain/phone';

/**
 * Entrada validada do cadastro de cliente (Prompt 05, itens 6, 7, 8 e 31).
 *
 * As mensagens sao ESPECIFICAS de proposito (item 31). "Dados invalidos" obriga
 * quem esta no balcao a adivinhar qual campo recusou, com o cliente esperando.
 * "CPF invalido" resolve em um segundo.
 */

const contactSchema = z
  .object({
    type: z.enum(['phone', 'email']),
    value: z.string().trim().max(190),
    isWhatsapp: z.boolean().default(false),
    label: z.string().trim().max(80).optional().or(z.literal('')),
  })
  .refine((contact) => contact.value.length > 0, {
    message: 'Informe o contato ou remova a linha.',
    path: ['value'],
  })
  .refine((contact) => contact.type !== 'phone' || isValidPhone(contact.value), {
    message: 'Telefone invalido. Informe DDD e numero.',
    path: ['value'],
  })
  .refine(
    (contact) =>
      contact.type !== 'email' || z.email().safeParse(normalizeEmail(contact.value)).success,
    { message: 'E-mail invalido.', path: ['value'] },
  );

const addressSchema = z.object({
  zipCode: z.string().trim().max(9).optional().or(z.literal('')),
  street: z.string().trim().max(200).optional().or(z.literal('')),
  number: z.string().trim().max(20).optional().or(z.literal('')),
  complement: z.string().trim().max(120).optional().or(z.literal('')),
  district: z.string().trim().max(120).optional().or(z.literal('')),
  city: z.string().trim().max(120).optional().or(z.literal('')),
  state: z.string().trim().max(2).optional().or(z.literal('')),
});

export const customerInputSchema = z
  .object({
    kind: z.enum(CUSTOMER_KINDS),
    name: z.string().trim().min(2, 'Informe o nome.').max(200),
    tradeName: z.string().trim().max(200).optional().or(z.literal('')),
    /** Aceita com ou sem pontuacao; a normalizacao acontece depois. */
    document: z.string().trim().max(20).optional().or(z.literal('')),
    stateRegistration: z.string().trim().max(32).optional().or(z.literal('')),
    birthDate: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data de nascimento invalida.')
      .optional()
      .or(z.literal('')),
    notes: z.string().trim().max(4000).optional().or(z.literal('')),
    contacts: z.array(contactSchema).max(20),
    address: addressSchema.optional(),
  })
  /**
   * PELO MENOS UM CONTATO (item 88).
   *
   * Cliente sem nenhuma forma de contato e um cadastro que nao serve para
   * nada: nao da para avisar que o aparelho ficou pronto. Telefone, WhatsApp
   * OU e-mail — qualquer um basta (itens 86 e 87).
   */
  .refine((input) => input.contacts.length > 0, {
    message: 'Informe pelo menos um telefone, WhatsApp ou e-mail.',
    path: ['contacts'],
  })
  /** O documento e opcional; quando vem, precisa ser o do tipo certo (item 7). */
  .superRefine((input, ctx) => {
    if (!input.document) return;

    const expected = DOCUMENT_TYPE_FOR_KIND[input.kind as CustomerKind];
    const digits = onlyDigits(input.document);
    const expectedLength = expected === 'cpf' ? 11 : 14;

    if (digits.length !== expectedLength) {
      ctx.addIssue({
        code: 'custom',
        path: ['document'],
        message: expected === 'cpf' ? 'CPF deve ter 11 digitos.' : 'CNPJ deve ter 14 digitos.',
      });
      return;
    }

    if (!isValidDocument(expected, digits)) {
      ctx.addIssue({
        code: 'custom',
        path: ['document'],
        message: expected === 'cpf' ? 'CPF invalido.' : 'CNPJ invalido.',
      });
    }
  })
  /** Nome fantasia e inscricao estadual so fazem sentido para PJ. */
  .superRefine((input, ctx) => {
    if (input.kind === 'individual' && input.stateRegistration) {
      ctx.addIssue({
        code: 'custom',
        path: ['stateRegistration'],
        message: 'Inscricao estadual vale apenas para pessoa juridica.',
      });
    }
    if (input.kind === 'company' && input.birthDate) {
      ctx.addIssue({
        code: 'custom',
        path: ['birthDate'],
        message: 'Data de nascimento vale apenas para pessoa fisica.',
      });
    }
  });

export type CustomerInput = z.infer<typeof customerInputSchema>;

export interface NormalizedContact {
  type: 'phone' | 'email';
  value: string;
  valueNormalized: string;
  isWhatsapp: boolean;
  label: string | null;
}

/**
 * Normaliza os contatos e resolve o principal.
 *
 * O PRIMEIRO contato da lista e o principal (item 11). E o modelo mais simples
 * que preserva evolucao: quando um canal precisar do proprio principal, a
 * coluna `primary_marker` aceita a mudanca sem migrar dado.
 *
 * Contatos repetidos (mesmo tipo e mesmo valor normalizado) sao descartados —
 * digitar o mesmo telefone duas vezes no formulario nao deve virar dois
 * registros.
 */
export function normalizeContacts(contacts: CustomerInput['contacts']): NormalizedContact[] {
  const seen = new Set<string>();
  const result: NormalizedContact[] = [];

  for (const contact of contacts) {
    const valueNormalized =
      contact.type === 'phone' ? normalizePhone(contact.value) : normalizeEmail(contact.value);

    const key = `${contact.type}:${valueNormalized}`;
    if (seen.has(key)) continue;
    seen.add(key);

    result.push({
      type: contact.type,
      value: contact.type === 'email' ? normalizeEmail(contact.value) : contact.value.trim(),
      valueNormalized,
      // WhatsApp e caracteristica de telefone; num e-mail seria ruido (item 13).
      isWhatsapp: contact.type === 'phone' ? contact.isWhatsapp : false,
      label: contact.label?.trim() ? contact.label.trim() : null,
    });
  }

  return result;
}

/** Endereco so e gravado quando tem ao menos um campo preenchido (item 15). */
export function hasAddressData(address: CustomerInput['address']): boolean {
  if (!address) return false;
  return Object.values(address).some((value) => Boolean(value && String(value).trim()));
}
