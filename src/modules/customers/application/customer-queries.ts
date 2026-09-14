import 'server-only';
import { and, asc, count, desc, eq, exists, inArray, like, or, sql, type SQL } from 'drizzle-orm';
import { getDb } from '@/core/db/client';
import { buildOffsetPage, resolveOffset, type OffsetPage } from '@/core/db/pagination';
import {
  normalizeSearchText,
  type ContactType,
  type CustomerKind,
  type CustomerStatus,
} from '@/modules/customers/domain/customer';
import type { DocumentType } from '@/core/document/brazilian-document';
import {
  customerAddresses,
  customerContacts,
  customers,
} from '@/modules/customers/infrastructure/schema';
import type { TenantContext } from '@/modules/tenancy/domain/tenant-context';

/**
 * Consultas de clientes (Prompt 05, itens 21, 22, 26, 28 e 71).
 *
 * TUDO ACONTECE NO SERVIDOR: busca, filtro, ordenacao e paginacao. Nenhuma
 * consulta traz a lista inteira para o navegador filtrar — com dezenas de
 * milhares de clientes isso trava o balcao, e e o tipo de decisao que so
 * aparece quando ja e tarde para mudar.
 */

export type CustomerSort = 'name' | 'recent';

export interface CustomerListFilters {
  /** Texto livre: nome, fantasia, documento, telefone ou e-mail. */
  query?: string;
  kind?: CustomerKind;
  status?: CustomerStatus;
  sort?: CustomerSort;
  page?: number;
  pageSize?: number;
}

export interface CustomerListItem {
  id: string;
  kind: CustomerKind;
  name: string;
  tradeName: string | null;
  documentType: DocumentType | null;
  documentDigits: string | null;
  status: CustomerStatus;
  updatedAt: Date;
  primaryContactType: ContactType | null;
  primaryContactValue: string | null;
  primaryContactIsWhatsapp: boolean;
}

/**
 * Condicao de busca.
 *
 * DOIS CAMINHOS, PORQUE SAO DOIS TIPOS DE DADO (item 21):
 *
 * 1. texto  -> compara com as colunas ja normalizadas (minusculas, sem acento)
 * 2. digito -> compara com documento e contatos normalizados
 *
 * Quem digita "123.456.789-00" e quem digita "12345678900" chega no mesmo
 * cliente, porque os dois lados da comparacao passam pela mesma normalizacao.
 * O mesmo vale para "(11) 98888-7777" e "11988887777".
 */
function buildSearchCondition(tenantId: string, rawQuery: string): SQL | undefined {
  const text = normalizeSearchText(rawQuery);
  if (!text) return undefined;

  const digits = rawQuery.replace(/\D/g, '');
  const conditions: SQL[] = [
    like(customers.nameNormalized, `%${text}%`),
    like(customers.tradeNameNormalized, `%${text}%`),
  ];

  /**
   * Subconsulta EXISTS em vez de JOIN: um cliente com cinco telefones
   * apareceria cinco vezes num JOIN, e o `total` da paginacao sairia errado.
   * O EXISTS para no primeiro contato que casa.
   */
  const contactMatches = (pattern: string) =>
    exists(
      getDb()
        .select({ one: sql`1` })
        .from(customerContacts)
        .where(
          and(
            eq(customerContacts.customerId, customers.id),
            eq(customerContacts.tenantId, tenantId),
            like(customerContacts.valueNormalized, pattern),
          ),
        ),
    );

  // E-mail: o texto normalizado ja e minusculo, que e como o contato e gravado.
  conditions.push(contactMatches(`%${text}%`));

  if (digits.length >= 3) {
    // Documento: prefixo, porque ninguem busca CPF pelo meio.
    conditions.push(like(customers.documentDigits, `${digits}%`));
    // Telefone: trecho, porque e comum lembrar so do numero sem o DDD.
    conditions.push(contactMatches(`%${digits}%`));
  }

  return or(...conditions);
}

export async function listCustomers(
  context: TenantContext,
  filters: CustomerListFilters = {},
): Promise<OffsetPage<CustomerListItem>> {
  const db = getDb();
  const { limit, offset, page } = resolveOffset(filters);

  const where = and(
    eq(customers.tenantId, context.tenantId),
    filters.query ? buildSearchCondition(context.tenantId, filters.query) : undefined,
    filters.kind ? eq(customers.kind, filters.kind) : undefined,
    filters.status ? eq(customers.status, filters.status) : undefined,
  );

  /**
   * Ordenacao SEMPRE deterministica (Prompt 02, item 58): a coluna escolhida
   * mais o `id` como desempate. Sem o desempate, dois clientes atualizados no
   * mesmo milissegundo podem trocar de lugar entre a pagina 1 e a 2 — e um
   * deles simplesmente nao aparece.
   */
  const orderBy =
    filters.sort === 'name'
      ? [asc(customers.nameNormalized), asc(customers.id)]
      : [desc(customers.updatedAt), desc(customers.id)];

  const [rows, [totals]] = await Promise.all([
    db
      .select({
        id: customers.id,
        kind: customers.kind,
        name: customers.name,
        tradeName: customers.tradeName,
        documentType: customers.documentType,
        documentDigits: customers.documentDigits,
        status: customers.status,
        updatedAt: customers.updatedAt,
      })
      .from(customers)
      .where(where)
      .orderBy(...orderBy)
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(customers).where(where),
  ]);

  /**
   * Contatos principais em UMA consulta para a pagina inteira.
   *
   * Nao e N+1: sao duas consultas no total (clientes + contatos da pagina),
   * independentemente de a pagina ter 1 ou 100 linhas. Um JOIN traria o mesmo
   * dado, mas multiplicaria as linhas do cliente com varios contatos e
   * estragaria a contagem da paginacao.
   */
  const primaryByCustomer = new Map<string, typeof customerContacts.$inferSelect>();

  if (rows.length > 0) {
    const contactRows = await db
      .select()
      .from(customerContacts)
      .where(
        and(
          eq(customerContacts.tenantId, context.tenantId),
          eq(customerContacts.isPrimary, true),
          inArray(
            customerContacts.customerId,
            rows.map((row) => row.id),
          ),
        ),
      );

    for (const contact of contactRows) primaryByCustomer.set(contact.customerId, contact);
  }

  const items: CustomerListItem[] = rows.map((row) => {
    const primary = primaryByCustomer.get(row.id);
    return {
      id: row.id,
      kind: row.kind,
      name: row.name,
      tradeName: row.tradeName,
      documentType: row.documentType,
      documentDigits: row.documentDigits,
      status: row.status,
      updatedAt: row.updatedAt,
      primaryContactType: primary?.type ?? null,
      primaryContactValue: primary?.value ?? null,
      primaryContactIsWhatsapp: primary?.isWhatsapp ?? false,
    };
  });

  return buildOffsetPage(items, Number(totals?.total ?? 0), { page, pageSize: limit });
}

export interface CustomerDetail {
  customer: typeof customers.$inferSelect;
  contacts: (typeof customerContacts.$inferSelect)[];
  addresses: (typeof customerAddresses.$inferSelect)[];
}

/**
 * Ficha do cliente.
 *
 * Escopo `tenant_id + id` na propria consulta: um ID valido de outra empresa
 * simplesmente nao encontra nada, e a interface responde "nao encontrado" — a
 * mesma resposta de um ID inexistente. Responder "sem permissao" confirmaria
 * que o registro existe (Prompt 03, ADR-021).
 */
export async function findCustomerDetail(
  context: TenantContext,
  customerId: string,
): Promise<CustomerDetail | null> {
  const db = getDb();

  const [customer] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.tenantId, context.tenantId), eq(customers.id, customerId)))
    .limit(1);

  if (!customer) return null;

  // Duas consultas em paralelo, nao uma por contato: o detalhe carrega apenas
  // o que a tela mostra (item 69).
  const [contacts, addresses] = await Promise.all([
    db
      .select()
      .from(customerContacts)
      .where(
        and(
          eq(customerContacts.tenantId, context.tenantId),
          eq(customerContacts.customerId, customerId),
        ),
      )
      .orderBy(desc(customerContacts.isPrimary), asc(customerContacts.createdAt)),
    db
      .select()
      .from(customerAddresses)
      .where(
        and(
          eq(customerAddresses.tenantId, context.tenantId),
          eq(customerAddresses.customerId, customerId),
        ),
      )
      .orderBy(desc(customerAddresses.isPrimary)),
  ]);

  return { customer, contacts, addresses };
}

/**
 * Possiveis duplicados por CONTATO (itens 20 e 89).
 *
 * Telefone e e-mail repetidos sao AVISO, nunca bloqueio: casal com um celular
 * so, empresa com telefone unico no balcao, familia com um e-mail. Bloquear
 * esses casos impediria cadastros legitimos todo dia.
 *
 * Sempre escopado ao tenant — nunca revela cliente de outra empresa.
 */
export async function findSimilarByContact(
  context: TenantContext,
  values: readonly string[],
  exceptCustomerId?: string,
): Promise<{ id: string; name: string; status: CustomerStatus }[]> {
  const normalized = values.map((value) => value.trim()).filter(Boolean);
  if (normalized.length === 0) return [];

  const db = getDb();

  const rows = await db
    .selectDistinct({ id: customers.id, name: customers.name, status: customers.status })
    .from(customers)
    .innerJoin(
      customerContacts,
      and(
        eq(customerContacts.customerId, customers.id),
        eq(customerContacts.tenantId, customers.tenantId),
      ),
    )
    .where(
      and(
        eq(customers.tenantId, context.tenantId),
        or(...normalized.map((value) => eq(customerContacts.valueNormalized, value))),
        exceptCustomerId ? sql`${customers.id} <> ${exceptCustomerId}` : undefined,
      ),
    )
    .limit(5);

  return rows;
}
