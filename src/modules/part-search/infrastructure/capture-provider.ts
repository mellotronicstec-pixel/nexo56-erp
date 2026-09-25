import { isProduction } from '@/core/config/env';
import { InternalError } from '@/core/errors';
import type {
  PartSearchProvider,
  PartSearchProviderQuery,
  PartSearchProviderResult,
} from '../application/part-search-provider';

/**
 * PROVEDOR DE CAPTURA DA BUSCA DE PECAS (Prompt 21, itens 21, 22, 214).
 *
 * Mesmo papel do `CaptureAiProvider` (ADR-085) e do `CaptureProvider` de
 * Comunicacao (Prompt 16): nao chama vendor nenhum, nao acessa rede. Por
 * padrao devolve uma lista VAZIA (busca externa "funcionou", zero
 * resultados) — o suficiente para provar o fluxo ponta a ponta sem inventar
 * peca nenhuma. Testes programam respostas especificas via `respondNext`
 * (sucesso com N itens cobrindo os cinco rotulos, timeout, erro,
 * resposta invalida) — exatamente o fixture pedido no item 214.
 */
export class CapturePartSearchProvider implements PartSearchProvider {
  readonly name = 'capture';

  private scripted: { result: PartSearchProviderResult; delayMs: number }[] = [];
  private readonly calls: PartSearchProviderQuery[] = [];

  respondNext(result: PartSearchProviderResult, delayMs = 0): void {
    this.scripted.push({ result, delayMs });
  }

  async search(
    query: PartSearchProviderQuery,
    _options?: { timeoutMs: number },
  ): Promise<PartSearchProviderResult> {
    assertNotProduction();
    this.calls.push(query);

    const programada = this.scripted.shift();
    if (programada) {
      if (programada.delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, programada.delayMs));
      }
      return programada.result;
    }

    return { outcome: 'ok', items: [] };
  }

  /** Chamadas recebidas, para o teste inspecionar o que foi enviado ao "provedor". */
  requests(): readonly PartSearchProviderQuery[] {
    return this.calls;
  }

  reset(): void {
    this.scripted = [];
    this.calls.length = 0;
  }
}

/**
 * A GUARDA DE PRODUCAO (item 22): chamada de DENTRO do `search`, lanca em
 * vez de devolver falha, e nao existe variavel de ambiente que ligue a
 * captura em producao — mesma logica exata do AI Gateway e de Comunicacao.
 */
export function assertNotProduction(): void {
  if (isProduction()) {
    throw new InternalError(
      'O provedor de captura da Busca de Pecas foi acionado em producao. Ele nao consulta fonte real nenhuma, e fingir que consultou seria mentir para o operador.',
    );
  }
}
