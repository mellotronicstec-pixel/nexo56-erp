/**
 * COMUNICAÇÃO (Prompt 16).
 *
 * O QUE ESTE MÓDULO FAZ: prepara, registra e tenta entregar mensagens ao
 * cliente, guardando para sempre o que foi dito, para onde foi e o que
 * aconteceu em cada tentativa.
 *
 * O QUE ELE NÃO FAZ, e o módulo inteiro depende disso:
 *
 * NÃO É FONTE DE VERDADE DO FATO. "O equipamento está pronto" é um fato da
 * Ordem de Serviço. A mensagem apenas INFORMA esse fato. Se o WhatsApp falhar,
 * o equipamento continua pronto — a falha do canal não desfaz o trabalho
 * realizado (ADR-078).
 *
 * NÃO É AUTOMAÇÃO. Não existe "quando X acontecer, envie Y" configurável.
 * Isso é o Prompt 19.
 *
 * NÃO É IA. Nada aqui reescreve, resume ou profissionaliza texto. Prompt 20.
 *
 * NÃO É MARKETING. Sem campanha, sem disparo em massa, sem lista. A
 * comunicação aqui é transacional: ela acompanha um serviço real.
 *
 * AS SEPARAÇÕES FORMAIS QUE O MÓDULO PRESERVA:
 *
 *   Evento de domínio ≠ Mensagem ≠ Template ≠ Canal ≠ Destinatário
 *   ≠ Tentativa de entrega ≠ Status da OS
 *
 * Cada uma dessas coisas muda por um motivo diferente, e juntá-las faria uma
 * mudar quando a outra mudasse.
 */

// ---------------------------------------------------------------------------
// Canal
// ---------------------------------------------------------------------------

/**
 * CANAL NÃO É PROVEDOR (item 9).
 *
 * `whatsapp` é o canal; quem entrega pode ser a API oficial da Meta, um
 * intermediário ou nada disso — e trocar de fornecedor não pode renomear o
 * canal no histórico de ninguém. Por isso não existe `twilio_whatsapp` aqui:
 * seria o nome de uma empresa dentro do domínio de outra.
 */
export const COMMUNICATION_CHANNELS = ['whatsapp', 'email', 'sms'] as const;
export type CommunicationChannel = (typeof COMMUNICATION_CHANNELS)[number];

export function isCommunicationChannel(value: string): value is CommunicationChannel {
  return (COMMUNICATION_CHANNELS as readonly string[]).includes(value);
}

export const CHANNEL_LABEL: Record<CommunicationChannel, string> = {
  whatsapp: 'WhatsApp',
  email: 'E-mail',
  sms: 'SMS',
};

/** Que tipo de contato cada canal consome. */
export const CHANNEL_CONTACT_TYPE: Record<CommunicationChannel, 'phone' | 'email'> = {
  whatsapp: 'phone',
  email: 'email',
  sms: 'phone',
};

/** Só e-mail tem assunto. Forçar o campo nos outros criaria dado sem sentido. */
export function channelUsesSubject(channel: CommunicationChannel): boolean {
  return channel === 'email';
}

// ---------------------------------------------------------------------------
// Situação da mensagem
// ---------------------------------------------------------------------------

/**
 * A MÁQUINA DE ESTADOS, e o que cada palavra realmente promete.
 *
 * Esta lista é curta de propósito: ela contém apenas o que o sistema consegue
 * PROVAR hoje, sem provedor real e sem webhook.
 *
 *   queued     a intenção está registrada; nada foi tentado ainda
 *   sending    alguém reivindicou o processamento desta mensagem
 *   sent       o provedor ACEITOU a mensagem
 *   failed     a última tentativa falhou
 *   cancelled  foi cancelada antes de qualquer aceitação
 *
 * `sent` SIGNIFICA "ACEITO PELO PROVEDOR", NÃO "ENTREGUE AO CLIENTE".
 * A diferença é real: o provedor pode aceitar e depois não entregar, e quem
 * olha a tela precisa saber que essas duas coisas não são a mesma.
 *
 * NÃO EXISTEM `delivered` NEM `read`, e a ausência é decisão, não esquecimento
 * (item 29): confirmar entrega exige webhook de um provedor real. Quando esse
 * provedor existir, acrescentar os dois estados é uma migration aditiva —
 * mentir agora seria irreversível.
 */
export const MESSAGE_STATUSES = ['queued', 'sending', 'sent', 'failed', 'cancelled'] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export function isMessageStatus(value: string): value is MessageStatus {
  return (MESSAGE_STATUSES as readonly string[]).includes(value);
}

export const MESSAGE_STATUS_LABEL: Record<MessageStatus, string> = {
  queued: 'Na fila',
  sending: 'Processando',
  sent: 'Enviada ao provedor',
  failed: 'Falhou',
  cancelled: 'Cancelada',
};

/**
 * O rótulo diz "Enviada ao provedor", não "Enviada". Três palavras a mais que
 * impedem a leitura errada: ninguém deve olhar a tela e concluir que o cliente
 * recebeu.
 */
export const MESSAGE_STATUS_TONE: Record<
  MessageStatus,
  'neutral' | 'brand' | 'success' | 'danger'
> = {
  queued: 'neutral',
  sending: 'brand',
  sent: 'success',
  failed: 'danger',
  cancelled: 'neutral',
};

/** Situação final: não muda mais sozinha. */
export function isTerminalStatus(status: MessageStatus): boolean {
  return status === 'sent' || status === 'cancelled';
}

/**
 * Reenviar cria uma TENTATIVA nova, nunca uma mensagem nova (item 33): a
 * intenção continua sendo a mesma, e apagar a tentativa anterior esconderia
 * que houve dificuldade.
 */
export function canRetry(status: MessageStatus): boolean {
  return status === 'failed';
}

/**
 * Cancelar só antes de qualquer aceitação. Cancelar o que o provedor já
 * aceitou seria fingir que a mensagem deixou de existir — e ela pode estar
 * chegando ao cliente neste momento (item 142).
 */
export function canCancel(status: MessageStatus): boolean {
  return status === 'queued' || status === 'failed';
}

export function explainNotRetryable(status: MessageStatus): string {
  if (status === 'sent') return 'Esta mensagem já foi aceita pelo provedor.';
  if (status === 'cancelled') return 'Esta mensagem foi cancelada.';
  if (status === 'sending') return 'Esta mensagem está sendo processada agora.';
  return 'Esta mensagem ainda não falhou.';
}

// ---------------------------------------------------------------------------
// Origem e propósito
// ---------------------------------------------------------------------------

/**
 * DE ONDE A MENSAGEM VEIO.
 *
 * Importa porque `manual` tem uma pessoa responsável e as outras não —
 * atribuir mensagem automática a um humano seria inventar um autor.
 */
export const MESSAGE_ORIGINS = ['manual', 'domain_event'] as const;
export type MessageOrigin = (typeof MESSAGE_ORIGINS)[number];

export const MESSAGE_ORIGIN_LABEL: Record<MessageOrigin, string> = {
  manual: 'Enviada por uma pessoa',
  domain_event: 'Gerada por um fato da operação',
};

export function isMessageOrigin(value: string): value is MessageOrigin {
  return (MESSAGE_ORIGINS as readonly string[]).includes(value);
}

/**
 * PARA QUE SERVE A MENSAGEM.
 *
 * O propósito existe por três motivos concretos, não por taxonomia: ele
 * impede que o template de "equipamento pronto" seja usado num contexto que
 * não é esse (item 122), dá escopo à chave de idempotência, e permite que o
 * histórico seja lido por assunto.
 *
 * A lista é curta e só contém propósitos que os dados existentes sustentam.
 */
export const MESSAGE_PURPOSES = [
  'generic',
  'service_update',
  'ready_for_pickup',
  'quote_available',
  'warranty_document',
] as const;

export type MessagePurpose = (typeof MESSAGE_PURPOSES)[number];

export function isMessagePurpose(value: string): value is MessagePurpose {
  return (MESSAGE_PURPOSES as readonly string[]).includes(value);
}

export const MESSAGE_PURPOSE_LABEL: Record<MessagePurpose, string> = {
  generic: 'Mensagem avulsa',
  service_update: 'Andamento do serviço',
  ready_for_pickup: 'Equipamento disponível para retirada',
  quote_available: 'Orçamento disponível',
  warranty_document: 'Documento de garantia',
};

// ---------------------------------------------------------------------------
// Erros normalizados
// ---------------------------------------------------------------------------

/**
 * O ERRO DO PROVEDOR É TRADUZIDO, NUNCA COPIADO (item 32).
 *
 * Um código de fornecedor dentro do domínio amarraria o Nexo56 a ele: trocar
 * de provedor passaria a exigir reescrever o histórico. E `ECONNREFUSED
 * 10.0.0.3:443` não é mensagem para quem atende no balcão.
 */
export const DELIVERY_ERRORS = [
  /** O destino não é válido para este canal. */
  'invalid_recipient',
  /** Não há provedor configurado para o canal — nada foi tentado de verdade. */
  'provider_not_configured',
  /** O provedor existe mas não respondeu. */
  'provider_unavailable',
  /** O provedor respondeu recusando a mensagem. */
  'rejected',
  /** O provedor pediu para esperar. */
  'rate_limited',
  /** Tempo esgotado sem resposta conclusiva. */
  'timeout',
  /** Nenhuma das anteriores. */
  'unknown',
] as const;

export type DeliveryError = (typeof DELIVERY_ERRORS)[number];

export function isDeliveryError(value: string): value is DeliveryError {
  return (DELIVERY_ERRORS as readonly string[]).includes(value);
}

/** Texto para quem opera. Nunca stack trace, nunca endereço de servidor. */
export const DELIVERY_ERROR_LABEL: Record<DeliveryError, string> = {
  invalid_recipient: 'O destino informado não é válido para este canal.',
  provider_not_configured: 'Este canal ainda não tem um provedor configurado.',
  provider_unavailable: 'O provedor não respondeu. Tente novamente mais tarde.',
  rejected: 'O provedor recusou a mensagem.',
  rate_limited: 'O provedor pediu para aguardar antes de novo envio.',
  timeout: 'O provedor demorou demais para responder.',
  unknown: 'Não foi possível enviar. Tente novamente.',
};

/**
 * Vale a pena tentar de novo?
 *
 * `invalid_recipient` e `rejected` não: tentar de novo com o mesmo destino e o
 * mesmo conteúdo dará exatamente o mesmo resultado, e insistir só gasta o
 * tempo de quem está olhando. `provider_not_configured` também não — o que
 * falta é configuração, não sorte.
 */
export function isRetryableError(error: DeliveryError): boolean {
  return error === 'provider_unavailable' || error === 'rate_limited' || error === 'timeout';
}

// ---------------------------------------------------------------------------
// Limites
// ---------------------------------------------------------------------------

export const SUBJECT_MAX = 200;
export const BODY_MAX = 4000;
export const TEMPLATE_NAME_MAX = 120;
export const RECIPIENT_MAX = 190;
export const RECIPIENT_DISPLAY_MAX = 190;
/** Mesmo limite do cancelamento das demais entidades, para o texto não pular. */
export const CANCEL_REASON_MAX = 300;

/** Anexo: teto conservador, para não carregar arquivo enorme em memória. */
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
