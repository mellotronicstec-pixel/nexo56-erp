import 'server-only';
import { isProduction } from '@/core/config/env';
import type { CommunicationProvider } from '../application/communication-provider';
import { CaptureProvider } from './capture-provider';

/**
 * QUEM ENTREGA, HOJE (itens 7, 30, 31 e 66).
 *
 * Hoje: ninguém. O Nexo56 não tem contrato com provedor de WhatsApp, não tem
 * servidor de e-mail configurado e não tem cofre de segredos. O prompt é
 * explícito: não inventar armazenamento inseguro para credencial que não
 * existe, e não construir integração real sem requisito e sem credencial.
 *
 * Então este registro tem exatamente dois comportamentos:
 *
 *   FORA DE PRODUÇÃO  → provedor de captura, que registra e não envia.
 *   EM PRODUÇÃO       → `null`, e a mensagem falha com `provider_not_configured`.
 *
 * POR QUE `null` E NÃO UMA EXCEÇÃO EM PRODUÇÃO. A ausência de provedor é um
 * fato operacional legítimo — a empresa ainda não contratou nenhum. O que o
 * sistema deve fazer com isso é registrar a intenção, marcar a tentativa como
 * falha com um motivo que uma pessoa entende ("provedor não configurado") e
 * deixar a mensagem pronta para reenvio no dia em que houver provedor. Quebrar
 * a tela não informaria nada melhor, e perderia o registro.
 *
 * NÃO EXISTE VARIÁVEL DE AMBIENTE QUE LIGUE A CAPTURA EM PRODUÇÃO, e essa
 * ausência é o recurso: uma configuração assim seria, mais cedo ou mais tarde,
 * ligada em produção por engano — e a partir daí o sistema afirmaria ter
 * avisado clientes que nunca foram avisados.
 *
 * Quando existir provedor real, ele entra aqui, lendo credencial de um cofre
 * que ainda precisa ser construído. Até lá, esta função é toda a verdade sobre
 * a capacidade de envio do sistema.
 */
let override: CommunicationProvider | null = null;
let capture: CaptureProvider | null = null;

export function getCommunicationProvider(): CommunicationProvider | null {
  if (override) return override;
  if (isProduction()) return null;

  capture ??= new CaptureProvider();
  return capture;
}

/**
 * O provedor de captura em uso, para o teste inspecionar o que foi capturado.
 * Devolve `null` quando não há captura ativa — em produção, sempre.
 */
export function getCaptureProvider(): CaptureProvider | null {
  const atual = override ?? (isProduction() ? null : (capture ??= new CaptureProvider()));
  return atual instanceof CaptureProvider ? atual : null;
}

/** Troca o provedor. Existe para teste; produção usa o padrão. */
export function setCommunicationProviderForTesting(next: CommunicationProvider | null): void {
  override = next;
}

/** Zera a captura entre testes, sem recriar o registro. */
export function resetCaptureProviderForTesting(): void {
  capture?.reset();
  if (override instanceof CaptureProvider) override.reset();
}
