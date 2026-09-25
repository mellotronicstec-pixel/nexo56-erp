import 'server-only';
import { isProduction } from '@/core/config/env';
import type { AiProvider } from '../application/ai-provider';
import { CaptureAiProvider } from './capture-provider';

/**
 * QUEM GERA O RASCUNHO, HOJE (Prompt 20, itens 35, 38, 111, 157, 210).
 *
 * Mesma decisao registrada para Comunicacao no Prompt 16, e pelo mesmo
 * motivo: o Nexo56 nao tem contrato com nenhum fornecedor de modelo de
 * linguagem, nao tem cofre de segredos, e o prompt e explicito — SEM decisao
 * anterior de fornecedor, NAO escolher OpenAI, Anthropic, Google ou qualquer
 * outro em silencio (item 35).
 *
 *   FORA DE PRODUÇÃO  → provedor de captura, deterministico.
 *   EM PRODUÇÃO       → `null`, e a geracao falha com `AI_PROVIDER_NOT_CONFIGURED`.
 *
 * NAO EXISTE VARIAVEL DE AMBIENTE QUE LIGUE A CAPTURA EM PRODUÇÃO — a mesma
 * razao do Prompt 16: essa chave, mais cedo ou mais tarde, seria ligada em
 * producao por engano, e o sistema passaria a afirmar ter gerado uma
 * sugestao real que nunca existiu.
 *
 * Quando existir provedor real (Prompt 25/26), ele entra aqui, lendo
 * credencial de um cofre que ainda precisa ser construido. Ate la, esta
 * funcao e toda a verdade sobre a capacidade de geracao do sistema —
 * inclusive para o relatorio deste prompt (item 210): nao ha "Nexo56 AI
 * disponivel" sem provedor real configurado.
 */
let override: AiProvider | null = null;
let capture: CaptureAiProvider | null = null;

export function getAiProvider(): AiProvider | null {
  if (override) return override;
  if (isProduction()) return null;

  capture ??= new CaptureAiProvider();
  return capture;
}

/** O provedor de captura em uso, para o teste programar respostas e inspecionar chamadas. */
export function getCaptureAiProvider(): CaptureAiProvider | null {
  const atual = override ?? (isProduction() ? null : (capture ??= new CaptureAiProvider()));
  return atual instanceof CaptureAiProvider ? atual : null;
}

/** Troca o provedor. Existe para teste; producao usa o padrao. */
export function setAiProviderForTesting(next: AiProvider | null): void {
  override = next;
}

/** Zera a captura entre testes, sem recriar o registro. */
export function resetCaptureAiProviderForTesting(): void {
  capture?.reset();
  if (override instanceof CaptureAiProvider) override.reset();
}
