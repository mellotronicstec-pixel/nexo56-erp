import { formatDocument, type DocumentType } from '@/core/document/brazilian-document';

/**
 * Tipos e regras puras do dominio de Clientes (Prompt 05, itens 5, 7 e 18).
 *
 * O CLIENTE PERTENCE AO TENANT, NAO A UNIDADE (item 2).
 *
 * Uma empresa com tres lojas cadastra o Joao na loja A e o atende na loja B
 * sem recadastrar. Por isso nao existe `unitId` proprietario aqui: a unidade
 * aparecera na Ordem de Servico, que e o que de fato acontece em um lugar.
 * `originUnitId` existe apenas como procedencia auditavel — nunca como filtro.
 */

/** Pessoa fisica ou juridica. Explicito no modelo, nunca deduzido (item 7). */
export const CUSTOMER_KINDS = ['individual', 'company'] as const;
export type CustomerKind = (typeof CUSTOMER_KINDS)[number];

export const CUSTOMER_KIND_LABEL: Record<CustomerKind, string> = {
  individual: 'Pessoa fisica',
  company: 'Pessoa juridica',
};

export const CUSTOMER_KIND_SHORT: Record<CustomerKind, string> = {
  individual: 'PF',
  company: 'PJ',
};

export const CUSTOMER_STATUSES = ['active', 'inactive'] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

export const CUSTOMER_STATUS_LABEL: Record<CustomerStatus, string> = {
  active: 'Ativo',
  inactive: 'Inativo',
};

/** Cada tipo de pessoa aceita apenas o seu documento (item 7). */
export const DOCUMENT_TYPE_FOR_KIND: Record<CustomerKind, DocumentType> = {
  individual: 'cpf',
  company: 'cnpj',
};

export const CONTACT_TYPES = ['phone', 'email'] as const;
export type ContactType = (typeof CONTACT_TYPES)[number];

export const CONTACT_TYPE_LABEL: Record<ContactType, string> = {
  phone: 'Telefone',
  email: 'E-mail',
};

/**
 * Nome pelo qual o cliente e chamado na interface.
 *
 * Para PJ, o nome fantasia costuma ser como a empresa e conhecida no balcao —
 * "Padaria do Ze", nao "ZE ALIMENTOS LTDA". Quando existe, ele lidera; a razao
 * social continua visivel no cadastro e nos documentos.
 */
export function displayName(customer: {
  kind: CustomerKind;
  name: string;
  tradeName: string | null;
}): string {
  if (customer.kind === 'company' && customer.tradeName?.trim()) {
    return customer.tradeName.trim();
  }
  return customer.name;
}

/** Documento formatado para leitura, ou null quando nao informado. */
export function displayDocument(customer: {
  documentType: DocumentType | null;
  documentDigits: string | null;
}): string | null {
  if (!customer.documentType || !customer.documentDigits) return null;
  return formatDocument(customer.documentType, customer.documentDigits);
}

/**
 * Normalizacao de texto para busca (item 21).
 *
 * Minusculas e sem acento: quem digita "jose" no balcao precisa encontrar
 * "José", e quem digita "JOSÉ" tambem. A coluna normalizada e gravada junto
 * com o cadastro, entao a busca compara texto ja preparado dos dois lados —
 * em vez de aplicar funcao sobre a coluna a cada consulta, o que descartaria
 * qualquer indice.
 */
export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}
