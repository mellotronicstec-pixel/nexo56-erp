import type { AiTaskKey } from '../domain/task-catalog';

/**
 * A PORTA DE SAIDA DO NEXO56 AI (Prompt 20, itens 33, 34, 39 e 156).
 *
 * Mesmo papel de `communication-provider.ts` no Prompt 16: o dominio e a UI
 * NUNCA conhecem vendor. Nenhuma palavra abaixo e nome de fornecedor — sem
 * `anthropicApiKey`, sem `openaiOrgId`. Trocar de provedor no futuro
 * (Prompt 25/26) nunca deve exigir mudar OS, Quotes, UI, catalogo ou
 * autorizacao — so o adaptador que implementa esta interface.
 *
 * CONTRATO (item 110): o provedor recebe SOMENTE o necessario para a task —
 * `taskKey`, versao do prompt, o texto/contexto ja delimitado, o idioma e o
 * limite de saida. Nunca o objeto Tenant, User, Customer ou a OS inteira.
 */
export interface AiGenerationRequest {
  taskKey: AiTaskKey;
  promptVersion: string;
  /** Instrucao de sistema, ja com os delimitadores de seguranca (item 161). */
  systemPrompt: string;
  /** Conteudo do usuario — texto a transformar OU contexto estruturado —, ja delimitado. */
  userContent: string;
  language: 'pt-BR';
  maxOutputChars: number;
}

/**
 * `outcome: 'generated'` nao significa "aceito": a camada de aplicacao ainda
 * valida tipo, tamanho e ancoras tecnicas antes de virar rascunho (item 53).
 * Token usage e `null` quando o provedor nao informa — nunca inventado
 * (item 79).
 */
export type AiGenerationResult =
  | {
      outcome: 'generated';
      text: string;
      inputTokens: number | null;
      outputTokens: number | null;
    }
  | {
      outcome: 'error';
      kind: 'timeout' | 'provider_error' | 'invalid_output';
      /** Detalhe TECNICO para log sanitizado — nunca repassado ao usuario cru (item 103). */
      detail: string | null;
    };

export interface AiProvider {
  /** Nome curto e estavel — vai para `ai_requests.provider_key`. */
  readonly name: string;
  /** Modelo usado, quando aplicavel — metadado, nunca regra de negocio (item 155). */
  readonly modelKey: string;

  /**
   * Gera o resultado.
   *
   * CONTRATO: falha e RESULTADO (`outcome: 'error'`), nao excecao — timeout,
   * recusa, payload invalido, tudo volta traduzido para o vocabulario do
   * dominio. Uma excecao que escape daqui e defeito do adaptador.
   */
  generate(
    request: AiGenerationRequest,
    options: { timeoutMs: number },
  ): Promise<AiGenerationResult>;
}
