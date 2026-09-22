import { formatPhone, isValidPhone, normalizeEmail, normalizePhone } from '@/core/contact/phone';
import { CHANNEL_CONTACT_TYPE, type CommunicationChannel, RECIPIENT_MAX } from './communication';

/**
 * O DESTINATÁRIO É UM RETRATO, NÃO UM PONTEIRO (itens 15 e 16).
 *
 * A mensagem guarda para onde ela foi de verdade, no momento em que foi. Se
 * amanhã o cliente trocar de telefone, a mensagem de ontem continua mostrando
 * o número de ontem — porque foi para lá que ela foi.
 *
 * Reconstruir o histórico a partir do cadastro atual produziria a pergunta
 * impossível de responder: "mandamos para qual número mesmo?".
 *
 * O vínculo com o cliente (`customerId`) é guardado ao lado, para navegação e
 * contexto — mas quem manda no histórico é o retrato, não o vínculo.
 *
 * E POR QUE NÃO GUARDAMOS O ID DO CONTATO. Seria natural anotar "veio do
 * contato X do cadastro". Só que `customer-service.ts` APAGA a lista inteira
 * de contatos e a reinsere com ids novos a cada edição do cliente — foi
 * verificado, não suposto. Um ponteiro assim estaria quebrado na primeira vez
 * que alguém corrigisse um telefone, e uma coluna que aponta para o vazio na
 * maioria das linhas é pior que coluna nenhuma: ela convida a um JOIN que
 * devolve menos linhas do que existem, silenciosamente.
 *
 * O tipo do contato e o valor já respondem "para onde foi". O id não
 * responderia nada que sobrevivesse.
 */
export interface RecipientSnapshot {
  /** Valor normalizado: dígitos para telefone, minúsculas para e-mail. */
  value: string;
  /** O valor como se mostra a uma pessoa. */
  display: string;
  customerId: string | null;
}

export interface RecipientInput {
  channel: CommunicationChannel;
  rawValue: string;
  customerId?: string | null;
}

export class InvalidRecipientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidRecipientError';
  }
}

/**
 * Validação DELIBERADAMENTE PRAGMÁTICA para e-mail (item 19).
 *
 * Não existe expressão regular que decida se um e-mail existe, e tentar provar
 * isso com consulta externa seria transformar o cadastro numa dependência de
 * rede. O que dá para recusar aqui é o que claramente não é endereço: sem
 * arroba, sem domínio, com espaço no meio.
 */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export function isValidEmail(value: string): boolean {
  const normalizado = normalizeEmail(value);
  return normalizado.length <= RECIPIENT_MAX && EMAIL_SHAPE.test(normalizado);
}

/**
 * Constrói o retrato a partir do que foi informado, validando por canal.
 *
 * O telefone usa a normalização que já existia no núcleo desde o Prompt 05 —
 * a mesma que o cadastro de clientes usa. Uma segunda normalização aqui faria
 * o mesmo número virar duas coisas diferentes dependendo de onde foi digitado.
 */
export function buildRecipient(input: RecipientInput): RecipientSnapshot {
  const bruto = input.rawValue.trim();
  if (!bruto) throw new InvalidRecipientError('Informe o destino da mensagem.');

  const tipo = CHANNEL_CONTACT_TYPE[input.channel];

  if (tipo === 'phone') {
    if (!isValidPhone(bruto)) {
      throw new InvalidRecipientError('O telefone informado não é válido.');
    }
    const digitos = normalizePhone(bruto);
    return {
      value: digitos,
      display: formatPhone(bruto),
      customerId: input.customerId ?? null,
    };
  }

  if (!isValidEmail(bruto)) {
    throw new InvalidRecipientError('O e-mail informado não é válido.');
  }

  const email = normalizeEmail(bruto);
  return {
    value: email,
    display: email,
    customerId: input.customerId ?? null,
  };
}

/**
 * MASCARAMENTO PARA LISTAGEM (item 81).
 *
 * Na lista ampla, o destino aparece parcialmente: reduz exposição de PII numa
 * tela que fica aberta no balcão, onde qualquer um que passe enxerga.
 *
 * MAS O MASCARAMENTO NÃO PODE SER INÚTIL: quem opera precisa confirmar que a
 * mensagem foi para o contato certo. Por isso o fim do telefone e o início do
 * e-mail continuam visíveis — o suficiente para reconhecer, insuficiente para
 * anotar.
 */
export function maskRecipient(channel: CommunicationChannel, display: string): string {
  const tipo = CHANNEL_CONTACT_TYPE[channel];

  if (tipo === 'email') {
    const [usuario, dominio] = display.split('@');
    if (!usuario || !dominio) return display;
    const visivel = usuario.slice(0, 2);
    return `${visivel}${'•'.repeat(Math.max(1, usuario.length - 2))}@${dominio}`;
  }

  const digitos = normalizePhone(display);
  if (digitos.length < 4) return display;
  const fim = digitos.slice(-4);
  return `••••-${fim}`;
}
