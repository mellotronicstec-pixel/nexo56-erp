import { FEATURES } from '@/modules/features/domain/catalog';
import { PERMISSIONS, type PermissionKey } from '@/modules/access-control/domain/permissions';
import type { AiTaskKey } from './task-catalog';

/**
 * AI SURFACE CATALOG — ALLOWLIST FECHADA (Prompt 20, itens 31 e 32).
 *
 * O frontend nunca diz "rode IA sobre qualquer campo". Toda chamada informa
 * uma `surfaceKey`, e o backend so aceita uma que exista aqui — qualquer
 * outra e `AI_SURFACE_NOT_ALLOWED` (item 32), nunca uma tentativa de
 * descobrir o campo pelo nome que o cliente mandou.
 *
 * SOMENTE CAMPOS REAIS (item 5 e 31): `service_order.internal_notes` e
 * `service_orders.internal_notes` (Prompt 07) — a observacao interna da OS,
 * o unico campo de texto livre que a equipe escreve e que nao e o relato do
 * cliente. `quote.customer_notes` e `quotes.customer_notes` (Prompt 09) — a
 * unica nota de Orcamento que e, por definicao, voltada ao cliente. Nenhum
 * campo foi inventado para este prompt.
 */

export const AI_ENTITY_TYPES = ['service_order', 'quote'] as const;
export type AiEntityType = (typeof AI_ENTITY_TYPES)[number];

export const AI_SURFACE_KEYS = ['service_order.internal_notes', 'quote.customer_notes'] as const;
export type AiSurfaceKey = (typeof AI_SURFACE_KEYS)[number];

export interface AiSurfaceDefinition {
  key: AiSurfaceKey;
  entityType: AiEntityType;
  /** Nome do campo no dominio, para o rótulo e para a leitura de contexto. */
  field: string;
  label: string;
  /**
   * Tasks permitidas NESTE campo (item 65): "Gerar parecer técnico" nunca
   * aparece numa nota destinada ao cliente, e "Deixar mais claro para o
   * cliente" não faz sentido num campo que o cliente nunca vê.
   */
  allowedTasks: readonly AiTaskKey[];
  /** Feature do MÓDULO dono do campo (não a feature do AI). */
  domainFeatureKey: string;
  /** Permissão do MÓDULO dono do campo — sempre exigida ALÉM de `ai.use` (item 93). */
  domainPermission: PermissionKey;
  /** Toda superfície hoje pertence a um registro de uma unidade só. */
  unitSemantics: 'unit_scoped';
  maxLength: number;
  contentType: 'plain_text';
}

export const AI_SURFACE_CATALOG: readonly AiSurfaceDefinition[] = [
  {
    key: 'service_order.internal_notes',
    entityType: 'service_order',
    field: 'internalNotes',
    label: 'Observações internas da Ordem de Serviço',
    allowedTasks: [
      'CORRIGIR_PORTUGUES',
      'DEIXAR_MAIS_PROFISSIONAL',
      'RESUMIR',
      'GERAR_PARECER_TECNICO',
    ],
    domainFeatureKey: FEATURES.CORE_SERVICE_ORDERS,
    domainPermission: PERMISSIONS.SERVICE_ORDERS_UPDATE,
    unitSemantics: 'unit_scoped',
    maxLength: 2000,
    contentType: 'plain_text',
  },
  {
    key: 'quote.customer_notes',
    entityType: 'quote',
    field: 'customerNotes',
    label: 'Observações para o cliente do Orçamento',
    allowedTasks: [
      'CORRIGIR_PORTUGUES',
      'DEIXAR_MAIS_PROFISSIONAL',
      'RESUMIR',
      'DEIXAR_MAIS_CLARO_PARA_CLIENTE',
    ],
    domainFeatureKey: FEATURES.CORE_QUOTES,
    domainPermission: PERMISSIONS.QUOTES_UPDATE_DRAFT,
    unitSemantics: 'unit_scoped',
    maxLength: 2000,
    contentType: 'plain_text',
  },
];

const BY_KEY = new Map<string, AiSurfaceDefinition>(AI_SURFACE_CATALOG.map((s) => [s.key, s]));

export function findAiSurface(key: string): AiSurfaceDefinition | undefined {
  return BY_KEY.get(key);
}

export function isTaskAllowedOnSurface(surface: AiSurfaceDefinition, taskKey: string): boolean {
  return (surface.allowedTasks as readonly string[]).includes(taskKey);
}
