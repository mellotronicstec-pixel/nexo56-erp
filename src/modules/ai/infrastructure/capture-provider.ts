import { isProduction } from '@/core/config/env';
import { InternalError } from '@/core/errors';
import type {
  AiGenerationRequest,
  AiGenerationResult,
  AiProvider,
} from '../application/ai-provider';

/**
 * PROVEDOR DE CAPTURA DO NEXO56 AI (Prompt 20, itens 36, 37, 111, 173).
 *
 * Mesmo papel do `CaptureProvider` de Comunicacao (Prompt 16): nao chama
 * vendor nenhum. Por padrao, devolve uma transformacao MINIMA e
 * DETERMINISTICA do texto de entrada (troca simples de maiuscula/minuscula
 * de exemplo) — o bastante para provar o fluxo ponta a ponta em
 * desenvolvimento e teste sem depender de rede.
 *
 * SCRIPTS CONTROLADOS (item 173): testes programam a proxima resposta
 * (sucesso com texto especifico, timeout, output invalido, incompatibilidade
 * tecnica, contexto insuficiente, erro de provedor) via `respondNext`.
 *
 * DETERMINISTICO POR CONSTRUCAO: sem rede, sem relogio na decisao, sem
 * aleatoriedade.
 */
export class CaptureAiProvider implements AiProvider {
  readonly name = 'capture';
  readonly modelKey = 'capture-deterministic';

  private scripted: { result: AiGenerationResult; delayMs: number }[] = [];
  private readonly calls: AiGenerationRequest[] = [];

  /**
   * Proxima resposta programada, na ordem. Sem valor magico no conteudo
   * (mesmo principio do item 173 de Comunicacao). `delayMs` existe SO para o
   * teste de timeout (item 113) provar o caminho sem esperar o timeout real
   * de producao — nunca usado fora de teste.
   */
  respondNext(result: AiGenerationResult, delayMs = 0): void {
    this.scripted.push({ result, delayMs });
  }

  async generate(
    request: AiGenerationRequest,
    _options?: { timeoutMs: number },
  ): Promise<AiGenerationResult> {
    assertNotProduction();
    this.calls.push(request);

    const programada = this.scripted.shift();
    if (programada) {
      if (programada.delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, programada.delayMs));
      }
      return programada.result;
    }

    return {
      outcome: 'generated',
      text: `[captura] ${request.userContent}`.slice(0, request.maxOutputChars),
      inputTokens: null,
      outputTokens: null,
    };
  }

  /** Chamadas recebidas, para o teste inspecionar o que foi enviado ao "provedor" (item 110). */
  requests(): readonly AiGenerationRequest[] {
    return this.calls;
  }

  reset(): void {
    this.scripted = [];
    this.calls.length = 0;
  }
}

/**
 * A GUARDA DE PRODUCAO (itens 37, 111, 157).
 *
 * Mesma logica do provedor de captura de Comunicacao: chamada de DENTRO do
 * `generate`, lanca em vez de devolver falha, e nao existe variavel de
 * ambiente que ligue a captura em producao.
 */
export function assertNotProduction(): void {
  if (isProduction()) {
    throw new InternalError(
      'O provedor de captura do Nexo56 AI foi acionado em producao. Ele nao gera sugestao real nenhuma, e fingir que gerou seria mentir para o operador.',
    );
  }
}
