import 'server-only';
import { isProduction } from '@/core/config/env';
import type { PartSearchProvider } from '../application/part-search-provider';
import { CapturePartSearchProvider } from './capture-provider';

/**
 * QUEM RESPONDE A BUSCA EXTERNA, HOJE (Prompt 21, itens 19, 20, 23, 137,
 * 186 a 188).
 *
 * Nenhuma decisao de fornecedor de catalogo/marketplace foi tomada em
 * nenhum prompt ate aqui (verificado: nenhum ADR, variavel de ambiente ou
 * dependencia de pacote menciona um provedor real de busca de pecas) — o
 * item 19 proibe explicitamente escolher um (Google Shopping, Mercado
 * Livre, SerpAPI, RapidAPI etc.) em silencio.
 *
 *   FORA DE PRODUÇÃO  → provedor de captura, deterministico.
 *   EM PRODUÇÃO       → `null`. A busca interna (Estoque + historico de
 *                        compra) continua funcionando normalmente (item
 *                        23/137/105) — so a secao "Resultados externos" fica
 *                        indisponivel, com erro estruturado
 *                        `PART_SEARCH_PROVIDER_NOT_CONFIGURED`.
 *
 * Quando um provedor real for decidido, ele entra SO aqui — nenhuma mudanca
 * em dominio, aplicacao ou UI (mesmo compromisso do ADR-085).
 */
let override: PartSearchProvider | null = null;
let capture: CapturePartSearchProvider | null = null;

export function getPartSearchProvider(): PartSearchProvider | null {
  if (override) return override;
  if (isProduction()) return null;

  capture ??= new CapturePartSearchProvider();
  return capture;
}

/** O provedor de captura em uso, para o teste programar respostas e inspecionar chamadas. */
export function getCapturePartSearchProvider(): CapturePartSearchProvider | null {
  const atual = override ?? (isProduction() ? null : (capture ??= new CapturePartSearchProvider()));
  return atual instanceof CapturePartSearchProvider ? atual : null;
}

/** Troca o provedor. Existe para teste; producao usa o padrao. */
export function setPartSearchProviderForTesting(next: PartSearchProvider | null): void {
  override = next;
}

/** Zera a captura entre testes, sem recriar o registro. */
export function resetCapturePartSearchProviderForTesting(): void {
  capture?.reset();
  if (override instanceof CapturePartSearchProvider) override.reset();
}
