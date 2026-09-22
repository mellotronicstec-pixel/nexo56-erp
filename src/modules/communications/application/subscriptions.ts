import 'server-only';
import { logger } from '@/core/logging/logger';
import { subscribe } from '@/modules/events/application/event-bus';
import { EVENT_TYPES } from '@/modules/events/domain/event';

/**
 * A COSTURA COM A ORDEM DE SERVIÇO (itens 56 a 65).
 *
 * O módulo de Ordens de Serviço NÃO conhece a Comunicação. Ele não a importa,
 * não verifica se ela está ligada, não espera por ela. O que ele faz é
 * publicar um fato — "alguém pediu para avisar o cliente desta ordem" — e
 * seguir em frente.
 *
 * Este arquivo é o outro lado dessa costura, e é de mão única: a Comunicação
 * escuta o Core; o Core nunca escuta a Comunicação. Com a feature desligada,
 * nada aqui é registrado, e o Core continua idêntico.
 *
 * ────────────────────────────────────────────────────────────────────────
 * E AGORA A PARTE QUE PARECE UM BUG E NÃO É: ESTE HANDLER NÃO ENVIA NADA.
 * ────────────────────────────────────────────────────────────────────────
 *
 * Enviar sozinho, ao receber o evento, exigiria o sistema decidir por conta
 * própria três coisas que ninguém lhe disse:
 *
 *   POR QUAL CANAL. WhatsApp? E-mail? O cliente tem os dois; qual deles a
 *   empresa usa para avisar que o aparelho está pronto? Escolher por ele é
 *   escolher errado metade das vezes.
 *
 *   COM QUAL TEXTO. Não existe "modelo padrão para ordem disponível" — existe
 *   uma lista de modelos que a empresa escreveu, nenhum deles marcado como o
 *   que responde a este evento.
 *
 *   SE DEVE ENVIAR. Nem toda empresa quer que o ERP fale com o cliente
 *   automaticamente, e algumas têm bom motivo para não querer.
 *
 * Responder essas três perguntas É o motor de regras, que é o Prompt 19.
 * Antecipá-lo aqui produziria uma automação escondida dentro de um módulo de
 * mensagens, configurável por ninguém, desligável por ninguém.
 *
 * ENTÃO O QUE ESTE HANDLER FAZ: registra que a intenção chegou, de forma
 * observável, e nada mais. A pessoa avisa o cliente pela tela da OS, com um
 * clique e uma confirmação — e é a tela que mostra, lendo o histórico, que a
 * ordem foi marcada como avisada sem que mensagem nenhuma tenha saído daqui.
 *
 * Quando o Prompt 19 existir, é AQUI que ele se conecta. O ponto de extensão
 * já está no lugar certo, sem nada escondido atrás dele.
 */

const flag = globalThis as unknown as { __nexo56CommunicationSubscriptions?: boolean };

export function registerCommunicationSubscriptions(): void {
  /**
   * Idempotente. O Next recarrega módulos em desenvolvimento, e uma segunda
   * inscrição faria o mesmo evento ser tratado duas vezes — que, no dia em que
   * este handler enviar mensagem, seriam duas mensagens.
   */
  if (flag.__nexo56CommunicationSubscriptions) return;
  flag.__nexo56CommunicationSubscriptions = true;

  subscribe(EVENT_TYPES.SERVICE_ORDER_CUSTOMER_NOTIFICATION_REQUESTED, async (event) => {
    const payload = event.payload as {
      serviceOrderId?: string;
      unitId?: string;
      reason?: string;
    };

    /**
     * Log sem PII: identificadores e motivo. O evento do Core já é assim, e
     * copiá-lo para um log mais detalhado desfaria o cuidado que ele teve.
     *
     * `delivered: false` está escrito à mão, e não lido do payload, porque é
     * uma afirmação deste módulo sobre si mesmo: ninguém foi avisado por aqui.
     */
    logger.info('Intencao de avisar o cliente recebida; nenhum envio automatico existe', {
      module: 'communications',
      operation: 'onCustomerNotificationRequested',
      serviceOrderId: payload.serviceOrderId,
      unitId: payload.unitId,
      reason: payload.reason,
      delivered: false,
    });
  });
}

/** Desfaz a marca de registro. Existe para teste. */
export function resetCommunicationSubscriptionsForTesting(): void {
  flag.__nexo56CommunicationSubscriptions = false;
}
