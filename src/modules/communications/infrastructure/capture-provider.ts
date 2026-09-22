import { isProduction } from '@/core/config/env';
import { InternalError } from '@/core/errors';
import type {
  CommunicationProvider,
  DeliveryResult,
  OutboundMessage,
} from '../application/communication-provider';
import { COMMUNICATION_CHANNELS, type DeliveryError } from '../domain/communication';

/**
 * PROVEDOR DE CAPTURA (itens 7, 31 e 66).
 *
 * Ele não manda mensagem para ninguém. Guarda o que teria sido enviado numa
 * lista em memória e responde "aceito". Existe para que o módulo inteiro possa
 * ser desenvolvido, testado e demonstrado sem credencial, sem internet e sem
 * o risco de um teste automatizado tocar o telefone de uma pessoa real.
 *
 * O NOME É `capture`, E ISSO APARECE NO BANCO. Toda tentativa feita por ele
 * grava `provider = 'capture'` em `communication_attempts`. Não existe modo em
 * que uma mensagem de mentira se disfarce de mensagem enviada: a evidência de
 * que ninguém recebeu nada fica registrada junto com a própria tentativa.
 *
 * DETERMINÍSTICO POR CONSTRUÇÃO: sem rede, sem relógio na decisão, sem
 * aleatoriedade. O mesmo teste dá o mesmo resultado na décima execução.
 */
export interface CapturedMessage {
  messageId: string;
  channel: string;
  recipient: string;
  subject: string | null;
  body: string;
  attachments: { filename: string; mimeType: string; byteSize: number }[];
  correlationId: string | null;
}

export class CaptureProvider implements CommunicationProvider {
  readonly name = 'capture';
  readonly channels = COMMUNICATION_CHANNELS;

  private readonly captured: CapturedMessage[] = [];
  private scripted: { error: DeliveryError; detail: string }[] = [];

  /**
   * Falhas programadas, uma por chamada, na ordem.
   *
   * SEM VALOR MÁGICO NO DESTINATÁRIO. A alternativa tentadora seria "telefone
   * terminado em 0000 falha" — e então um cliente real com esse número nunca
   * receberia mensagem, por causa de uma conveniência de teste. O roteiro fica
   * do lado de fora, onde é o teste que decide.
   */
  failNext(error: DeliveryError, detail = 'Falha programada pelo teste.'): void {
    this.scripted.push({ error, detail });
  }

  async send(message: OutboundMessage): Promise<DeliveryResult> {
    assertNotProduction();

    const programada = this.scripted.shift();
    if (programada) {
      return { outcome: 'failed', error: programada.error, detail: programada.detail };
    }

    this.captured.push({
      messageId: message.messageId,
      channel: message.channel,
      recipient: message.recipient,
      subject: message.subject,
      body: message.body,
      attachments: message.attachments.map((anexo) => ({
        filename: anexo.filename,
        mimeType: anexo.mimeType,
        byteSize: anexo.bytes.byteLength,
      })),
      correlationId: message.correlationId,
    });

    /**
     * O protocolo é derivado do id da mensagem, não sorteado: dois testes que
     * enviam a mesma mensagem obtêm o mesmo protocolo, e uma comparação de
     * igualdade num teste não vira falha intermitente na sexta-feira.
     */
    return { outcome: 'accepted', providerMessageId: `capture-${message.messageId}` };
  }

  /** O que foi capturado, em ordem. Para teste e para a tela de diagnóstico. */
  messages(): readonly CapturedMessage[] {
    return this.captured;
  }

  reset(): void {
    this.captured.length = 0;
    this.scripted = [];
  }
}

/**
 * A GUARDA DE PRODUÇÃO (itens 7, 31 e 250).
 *
 * Chamada de dentro do `send`, e não só na hora de escolher o provedor. A
 * diferença importa: alguém pode injetar uma instância de captura por engano —
 * num script de deploy, num teste que esqueceu de limpar o registro global, num
 * `setCommunicationProviderForTesting` chamado em código de produção. Todas
 * essas rotas passam por aqui.
 *
 * E a guarda LANÇA em vez de devolver falha. Uma falha registrada seria uma
 * linha discreta num histórico que ninguém lê; um erro interrompe e aparece.
 * Entre atrapalhar o operador e deixar o sistema afirmar em produção que
 * avisou um cliente que nunca foi avisado, atrapalhar o operador é barato.
 */
export function assertNotProduction(): void {
  if (isProduction()) {
    throw new InternalError(
      'O provedor de captura foi acionado em producao. Ele nao envia mensagem a ninguem, e fingir que enviou seria mentir para o operador e para o cliente.',
    );
  }
}
