import type { CommunicationChannel, DeliveryError } from '../domain/communication';

/**
 * A PORTA DE SAÍDA (itens 26 a 33).
 *
 * Este arquivo é a fronteira entre "o Nexo56 quer avisar o cliente" e "alguma
 * empresa lá fora entrega mensagens". Tudo que é específico de fornecedor —
 * formato de payload, cabeçalho de autenticação, código de erro, limite de
 * caracteres, webhook — fica do lado de lá.
 *
 * O TESTE DE QUE A FRONTEIRA ESTÁ NO LUGAR CERTO: nenhuma palavra abaixo é o
 * nome de um fornecedor. Não há `whatsappBusinessAccountId`, não há
 * `smtpHost`, não há `twilioSid`. Se um dia precisar haver, é sinal de que o
 * vazamento aconteceu.
 *
 * TROCAR DE FORNECEDOR NÃO PODE VIRAR MIGRATION. O canal (`whatsapp`) é
 * estável; quem entrega é detalhe operacional. Por isso `communication_messages`
 * guarda o canal numa coluna e o provedor apenas como retrato textual da
 * tentativa (item 33).
 */

export interface OutboundAttachment {
  filename: string;
  mimeType: string;
  /** Os bytes, já lidos pelo serviço autorizado que sabe quem pode lê-los. */
  bytes: Buffer;
}

export interface OutboundMessage {
  /** O id da nossa mensagem. Serve para correlacionar log, não é autenticação. */
  messageId: string;
  channel: CommunicationChannel;
  /** Destino já normalizado e validado pelo domínio. */
  recipient: string;
  subject: string | null;
  body: string;
  attachments: readonly OutboundAttachment[];
  correlationId: string | null;
}

/**
 * O RESULTADO É `accepted`, NUNCA `delivered` (itens 34 a 36).
 *
 * Um provedor responde "recebi e vou tentar". Ele não responde "a pessoa leu".
 * Nomear isto de `delivered` faria a UI, o relatório e, mais tarde, a
 * conversa com um cliente irritado afirmarem uma coisa que ninguém verificou.
 *
 * Quando existir provedor real com webhook de confirmação, `delivered` entra
 * como estado NOVO, com a prova que o justifica — não renomeando este aqui.
 */
export type DeliveryResult =
  | { outcome: 'accepted'; providerMessageId: string | null }
  | { outcome: 'failed'; error: DeliveryError; detail: string | null };

export interface CommunicationProvider {
  /** Nome curto e estável. Vai para `communication_attempts.provider`. */
  readonly name: string;
  /** Quais canais este provedor sabe entregar. */
  readonly channels: readonly CommunicationChannel[];

  /**
   * Tenta entregar.
   *
   * CONTRATO: falha de entrega é RESULTADO, não exceção. Timeout, recusa,
   * limite de taxa — tudo volta como `{ outcome: 'failed' }` com o erro já
   * traduzido para o vocabulário do domínio.
   *
   * Uma exceção que escape daqui significa defeito no adaptador, e a camada de
   * aplicação a registra como `unknown` — nunca como sucesso.
   */
  send(message: OutboundMessage): Promise<DeliveryResult>;
}

/**
 * Higieniza o detalhe do erro ANTES de ele virar linha de banco (item 67).
 *
 * Fornecedor devolve corpo de resposta, e corpo de resposta às vezes ecoa o
 * cabeçalho de autenticação que a gente mandou. Gravar isso criaria um
 * segredo em texto puro dentro de uma tabela que a tela de diagnóstico mostra
 * para qualquer pessoa com permissão de ver mensagens.
 *
 * A limpeza é por PADRÃO e não por lista de fornecedores conhecidos: o
 * adaptador que ainda não existe também passa por aqui.
 */
const SECRET_SHAPES: readonly RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi,
  /\bBasic\s+[A-Za-z0-9+/]+=*/gi,
  /\b(api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|senha|secret|token|authorization)\b\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;&}]+)/gi,
];

export function sanitizeProviderDetail(detail: string | null | undefined): string | null {
  if (!detail) return null;

  let limpo = detail;
  for (const padrao of SECRET_SHAPES) {
    limpo = limpo.replace(padrao, (trecho) => {
      const separador = trecho.search(/[:=]/);
      if (separador === -1) {
        const espaco = trecho.indexOf(' ');
        return espaco === -1 ? '[redigido]' : `${trecho.slice(0, espaco)} [redigido]`;
      }
      return `${trecho.slice(0, separador + 1)} [redigido]`;
    });
  }

  const colapsado = limpo.replace(/\s+/g, ' ').trim();
  return colapsado.length > 500 ? `${colapsado.slice(0, 497)}...` : colapsado;
}
