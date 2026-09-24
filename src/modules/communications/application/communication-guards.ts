import 'server-only';
import { and, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { getDb } from '@/core/db/client';
import { NotFoundError, ValidationError } from '@/core/errors';
import { customers } from '@/modules/customers/infrastructure/schema';
import type { TenantContext } from '@/modules/tenancy/domain/tenant-context';
import { CHANNEL_CONTACT_TYPE, type CommunicationChannel } from '../domain/communication';

/**
 * GUARDAS DE ENTRADA DA COMUNICAÇÃO.
 *
 * As três primeiras funções (`blank`, `parse`, `resolveUnit`) são gêmeas das
 * que a Agenda tem. A cópia é DELIBERADA: importar
 * `@/modules/agenda/application/agenda-guards` faria a Comunicação depender de
 * um módulo OPCIONAL — e então desligar a Agenda derrubaria o envio de
 * mensagem, o que nenhuma das duas features promete.
 *
 * São três funções de cinco linhas. Promovê-las para o núcleo é a saída
 * correta quando a terceira cópia aparecer; a segunda ainda não paga o custo
 * de mexer num módulo estável só para deduplicar quinze linhas.
 */

/** Texto vazio, em formulário, é ausência — não string de zero caractere. */
export function blank(value: string | undefined | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** Valida e devolve a PRIMEIRA mensagem: conserta-se um problema por vez. */
export function parse<T extends z.ZodTypeAny>(schema: T, raw: unknown): z.infer<T> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? 'Dados invalidos.');
  }
  return parsed.data;
}

/**
 * A UNIDADE VEM DO BACKEND.
 *
 * A unidade ativa do navegador é conveniência de tela; a autoridade é a lista
 * que o contexto autorizou. Uma unidade informada no formulário só é aceita se
 * estiver nessa lista.
 */
export function resolveUnit(context: TenantContext, requested: string | null): string {
  const unitId = requested ?? context.activeUnitId;
  if (!unitId) {
    throw new ValidationError('Escolha a unidade em que esta mensagem acontece.');
  }
  if (!context.authorizedUnitIds.includes(unitId)) {
    throw new NotFoundError('Unidade nao encontrada.');
  }
  return unitId;
}

export interface ResolvedRecipient {
  customerId: string;
  customerName: string;
  /** O valor como está no cadastro, antes de normalizar. */
  rawValue: string;
}

/**
 * O DESTINATÁRIO SAI DO CADASTRO, NUNCA DO FORMULÁRIO (itens 15, 17 e 86).
 *
 * Esta é a regra que separa uma ferramenta de atendimento de uma ferramenta de
 * disparo. Não existe caminho por onde alguém digite um número qualquer e o
 * Nexo56 mande mensagem para lá: o destino tem que ser um contato cadastrado
 * do cliente escolhido, do tipo que o canal aceita.
 *
 * Três coisas caem de uma vez com isso:
 *
 *   — o erro de digitação que mandaria a mensagem para um estranho;
 *   — o uso do ERP como disparador de lista comprada (Prompt 24 é outra
 *     conversa, e terá que se justificar sozinho);
 *   — a dúvida sobre de onde veio aquele telefone no histórico.
 *
 * E há a checagem específica do WhatsApp: mandar para um fixo que o cadastro
 * não marcou como WhatsApp produziria uma falha garantida do lado do
 * provedor, cobrada, depois de a tela ter dito "enviando".
 */
export async function resolveRecipient(
  context: Pick<TenantContext, 'tenantId'>,
  input: { customerId: string; contactValue: string; channel: CommunicationChannel },
): Promise<ResolvedRecipient> {
  const [cliente] = await getDb()
    .select({ id: customers.id, name: customers.name, status: customers.status })
    .from(customers)
    .where(and(eq(customers.id, input.customerId), eq(customers.tenantId, context.tenantId)))
    .limit(1);

  if (!cliente) throw new NotFoundError('Cliente nao encontrado.');

  const tipo = CHANNEL_CONTACT_TYPE[input.channel];
  const exigeWhatsapp = input.channel === 'whatsapp';

  /**
   * A comparação é feita com o valor CRU e com o NORMALIZADO, porque a tela
   * mostra o formatado e o cadastro guarda os dois. Comparar só um dos lados
   * recusaria um contato legítimo por causa de um hífen.
   */
  const linhas = await getDb().execute(sql`
    SELECT c.value
      FROM customer_contacts c
     WHERE c.customer_id = ${input.customerId}
       AND c.tenant_id = ${context.tenantId}
       AND c.type = ${tipo}
       AND (c.value = ${input.contactValue} OR c.value_normalized = ${input.contactValue})
       ${exigeWhatsapp ? sql`AND c.is_whatsapp = 1` : sql``}
     LIMIT 1
  `);

  const encontrado = (linhas as unknown as Array<Array<{ value: string }>>)[0]?.[0]?.value;

  if (!encontrado) {
    throw new ValidationError(
      exigeWhatsapp
        ? 'Escolha um telefone do cliente marcado como WhatsApp no cadastro.'
        : 'Escolha um contato que esteja no cadastro deste cliente.',
    );
  }

  return { customerId: cliente.id, customerName: cliente.name, rawValue: encontrado };
}

/**
 * DESTINATARIO PARA UMA ACAO DE AUTOMACAO (Prompt 19, itens 139 e 140).
 *
 * O Motor NUNCA aceita telefone digitado na regra (item 139) — o destino sai
 * do cadastro no momento em que a acao roda, nunca de um snapshot congelado
 * na versao da regra, porque o contato do cliente pode ter mudado depois
 * (item 140). Diferente de `resolveRecipient` (que confirma um valor que a
 * TELA already mostrou escolhido), aqui ninguem escolheu nada: a unica
 * fonte inambigua e o CONTATO PRINCIPAL do cliente, do tipo que o canal
 * exige. Sem contato principal elegivel, a acao falha explicitamente
 * (`NO_ELIGIBLE_RECIPIENT`) — o Motor nunca adivinha qual dos varios
 * contatos usar.
 */
export async function resolveAutomaticRecipient(
  context: Pick<TenantContext, 'tenantId'>,
  input: { customerId: string; channel: CommunicationChannel },
): Promise<ResolvedRecipient | null> {
  const [cliente] = await getDb()
    .select({ id: customers.id, name: customers.name })
    .from(customers)
    .where(and(eq(customers.id, input.customerId), eq(customers.tenantId, context.tenantId)))
    .limit(1);

  if (!cliente) return null;

  const tipo = CHANNEL_CONTACT_TYPE[input.channel];
  const exigeWhatsapp = input.channel === 'whatsapp';

  const linhas = await getDb().execute(sql`
    SELECT c.value
      FROM customer_contacts c
     WHERE c.customer_id = ${input.customerId}
       AND c.tenant_id = ${context.tenantId}
       AND c.type = ${tipo}
       AND c.is_primary = 1
       ${exigeWhatsapp ? sql`AND c.is_whatsapp = 1` : sql``}
     LIMIT 1
  `);

  const encontrado = (linhas as unknown as Array<Array<{ value: string }>>)[0]?.[0]?.value;
  if (!encontrado) return null;

  return { customerId: cliente.id, customerName: cliente.name, rawValue: encontrado };
}
