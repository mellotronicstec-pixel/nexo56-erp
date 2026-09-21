import { addDays, addMonths, todayIn } from '@/core/time/civil-date';
import { PERMISSIONS, type PermissionKey } from '@/modules/access-control/domain/permissions';

/**
 * DOMINIO DE GARANTIAS (Prompt 13).
 *
 * ESTE ARQUIVO E A AUTORIDADE sobre o que uma garantia e, quanto tempo ela
 * dura, o que ela cobre e quando ela vale. Nenhuma pagina, Server Action,
 * consulta ou componente decide nada disso.
 *
 * AS SEPARACOES FORMAIS QUE ESTE MODULO PRESERVA (item 2):
 *
 *   Politica        -> o molde: "reparo de placa = 90 dias, cobre mao de obra"
 *   Garantia        -> a emissao concreta, com SNAPSHOT dos termos da epoca
 *   Certificado     -> o documento daquela garantia
 *   Cobertura       -> o que especificamente esta coberto (pode ser parcial)
 *   Retorno         -> o fato "o aparelho voltou"
 *   Nova OS         -> o trabalho que o retorno gerou
 *   Classificacao   -> a natureza da OS, NUNCA o estado dela
 *   Custo           -> o que a garantia custou a loja, que nao e pagamento
 *
 * Reduzir qualquer par desses a uma coisa so economiza uma tabela hoje e
 * cobra o preco na primeira divergencia: uma politica alterada em marco nao
 * pode mudar o certificado emitido em janeiro, e isso e impossivel de garantir
 * se o certificado for lido da politica.
 */

// ---------------------------------------------------------------------------
// Tipos (item 3)
// ---------------------------------------------------------------------------

export const WARRANTY_TYPES = ['internal', 'factory', 'part', 'extended'] as const;
export type WarrantyType = (typeof WARRANTY_TYPES)[number];

export const WARRANTY_TYPE_LABEL: Record<WarrantyType, string> = {
  internal: 'Garantia Interna',
  factory: 'Garantia de Fabrica',
  part: 'Garantia de Peca',
  extended: 'Garantia Estendida',
};

export const WARRANTY_TYPE_HINT: Record<WarrantyType, string> = {
  internal: 'Cobertura concedida pela propria assistencia sobre o servico realizado.',
  factory: 'Cobertura do fabricante. O Nexo56 registra e acompanha; nao assume a despesa.',
  part: 'Cobertura de uma peca especifica instalada no aparelho.',
  extended: 'Cobertura adicional contratada ou concedida, alem da garantia normal.',
};

export function isKnownWarrantyType(value: string): value is WarrantyType {
  return (WARRANTY_TYPES as readonly string[]).includes(value);
}

export function warrantyTypeLabel(value: string): string {
  return isKnownWarrantyType(value) ? WARRANTY_TYPE_LABEL[value] : value;
}

/**
 * SO a Garantia Interna origina retorno com OS de garantia (itens 23 e 33).
 *
 * Garantia de fabrica e do fabricante: a loja pode intermediar, mas o
 * atendimento nao e "conserto que a loja ja devia". Garantia de peca e de
 * fornecedor entram pelo caminho normal enquanto nao houver politica propria.
 */
export function originatesInternalWarrantyService(type: string): boolean {
  return type === 'internal';
}

// ---------------------------------------------------------------------------
// Duracao (itens 9 e 97)
// ---------------------------------------------------------------------------

export const DURATION_UNITS = ['days', 'months'] as const;
export type DurationUnit = (typeof DURATION_UNITS)[number];

export const DURATION_UNIT_LABEL: Record<DurationUnit, string> = {
  days: 'dias',
  months: 'meses',
};

export const DURATION_MIN = 1;
export const DURATION_MAX = 120;

export function isKnownDurationUnit(value: string): value is DurationUnit {
  return (DURATION_UNITS as readonly string[]).includes(value);
}

export function formatDuration(amount: number, unit: DurationUnit): string {
  if (unit === 'months') return amount === 1 ? '1 mes' : `${amount} meses`;
  return amount === 1 ? '1 dia' : `${amount} dias`;
}

/**
 * O ULTIMO DIA COBERTO, a partir do primeiro.
 *
 * A REGRA, em uma frase: soma-se a duracao a data de inicio, e o resultado e
 * o ultimo dia em que a garantia ainda vale.
 *
 *   inicio 2026-01-01 + 90 dias  ->  termina 2026-04-01
 *   inicio 2026-01-15 + 3 meses  ->  termina 2026-04-15
 *   inicio 2026-01-31 + 1 mes    ->  termina 2026-02-28
 *
 * MES NAO E 30 DIAS, e as duas unidades divergem de proposito (item 9):
 * 31/01 + 1 mes termina em 28/02, enquanto 31/01 + 30 dias termina em 02/03.
 * Um contrato que diz "3 meses" nao diz "90 dias", e converter um no outro
 * silenciosamente e inventar termo comercial que ninguem assinou.
 *
 * O FIM E INCLUSIVO (item 35): o retorno registrado no proprio `ends_on`
 * ainda esta coberto. E como o balcao le a data impressa no certificado, e
 * discutir um dia com o cliente por causa de aritmetica interna nao e um
 * debate que o sistema deva criar.
 */
export function warrantyEndDate(startsOn: string, amount: number, unit: DurationUnit): string {
  if (!Number.isInteger(amount) || amount < DURATION_MIN) {
    throw new RangeError('A duracao da garantia deve ser um numero inteiro de dias ou meses.');
  }
  return unit === 'months' ? addMonths(startsOn, amount) : addDays(startsOn, amount);
}

// ---------------------------------------------------------------------------
// Situacao administrativa x classificacao temporal (item 14)
// ---------------------------------------------------------------------------

/**
 * O que uma PESSOA fez com a garantia. Muda por ato humano, nunca pelo relogio.
 */
export const WARRANTY_STATUSES = ['draft', 'active', 'cancelled', 'revoked'] as const;
export type WarrantyStatus = (typeof WARRANTY_STATUSES)[number];

export const WARRANTY_STATUS_LABEL: Record<WarrantyStatus, string> = {
  draft: 'Rascunho',
  active: 'Ativa',
  cancelled: 'Cancelada',
  revoked: 'Revogada',
};

export const WARRANTY_STATUS_TONE: Record<
  WarrantyStatus,
  'neutral' | 'brand' | 'success' | 'danger'
> = {
  draft: 'neutral',
  active: 'success',
  cancelled: 'neutral',
  revoked: 'danger',
};

export function isKnownWarrantyStatus(value: string): value is WarrantyStatus {
  return (WARRANTY_STATUSES as readonly string[]).includes(value);
}

/**
 * O que o CALENDARIO diz. Derivado, nunca persistido (item 14).
 *
 * Uma coluna `expired` exigiria um job diario reescrevendo a carteira inteira
 * a meia-noite; no dia em que ele falhasse, a tela mostraria "valida" para
 * garantias vencidas sem nenhum sinal de que algo deu errado. E a mesma
 * decisao que o Financeiro tomou para "vencido" (ADR-055).
 */
export const TEMPORAL_CLASSES = ['future', 'valid', 'expired'] as const;
export type TemporalClass = (typeof TEMPORAL_CLASSES)[number];

export const TEMPORAL_CLASS_LABEL: Record<TemporalClass, string> = {
  future: 'Ainda nao comecou',
  valid: 'Vigente',
  expired: 'Expirada',
};

export interface WarrantyPeriod {
  startsOn: string;
  endsOn: string;
}

/**
 * Onde a data de referencia cai em relacao a vigencia.
 *
 * `referenceDate` e data CIVIL resolvida no fuso da EMPRESA pelo servidor
 * (item 34) — nunca `new Date()` do navegador. Uma garantia que termina dia 15
 * termina no dia 15 da loja, e nao no dia 15 de quem abriu a tela viajando.
 */
export function temporalClassOf(period: WarrantyPeriod, referenceDate: string): TemporalClass {
  if (referenceDate < period.startsOn) return 'future';
  /** Comparacao INCLUSIVA: o proprio `endsOn` ainda e dia coberto (item 35). */
  if (referenceDate > period.endsOn) return 'expired';
  return 'valid';
}

export interface WarrantySnapshot extends WarrantyPeriod {
  status: string;
  type: string;
}

/**
 * A garantia esta valendo AGORA, para efeito de acionamento?
 *
 * Duas condicoes, e as duas importam: administrativamente ativa E dentro da
 * vigencia. Uma garantia revogada dentro do prazo nao vale; uma garantia ativa
 * e vencida tambem nao.
 */
export function isWarrantyEnforceable(snapshot: WarrantySnapshot, referenceDate: string): boolean {
  if (snapshot.status !== 'active') return false;
  return temporalClassOf(snapshot, referenceDate) === 'valid';
}

/** Por que a garantia nao pode ser acionada, em portugues de balcao. */
export function explainNotEnforceable(
  snapshot: WarrantySnapshot,
  referenceDate: string,
): string | null {
  if (snapshot.status === 'draft') {
    return 'Esta garantia ainda e um rascunho: ela precisa ser emitida antes de valer.';
  }
  if (snapshot.status === 'cancelled') return 'Esta garantia foi cancelada.';
  if (snapshot.status === 'revoked') return 'Esta garantia foi revogada.';

  const temporal = temporalClassOf(snapshot, referenceDate);
  if (temporal === 'future') {
    return `Esta garantia comeca em ${formatCivil(snapshot.startsOn)} e ainda nao esta valendo.`;
  }
  if (temporal === 'expired') {
    return `Esta garantia terminou em ${formatCivil(snapshot.endsOn)}.`;
  }
  return null;
}

function formatCivil(civil: string): string {
  const [ano, mes, dia] = civil.split('-');
  return ano && mes && dia ? `${dia}/${mes}/${ano}` : civil;
}

/** Quantos dias ainda restam de cobertura. Negativo quando ja venceu. */
export function daysRemaining(period: WarrantyPeriod, referenceDate: string): number {
  const fim = Date.parse(`${period.endsOn}T00:00:00Z`);
  const hoje = Date.parse(`${referenceDate}T00:00:00Z`);
  return Math.round((fim - hoje) / 86_400_000);
}

/** Vence dentro da janela informada (para o painel "proximas de vencer"). */
export function expiresWithin(
  period: WarrantyPeriod,
  referenceDate: string,
  days: number,
): boolean {
  const restam = daysRemaining(period, referenceDate);
  return restam >= 0 && restam <= days;
}

// ---------------------------------------------------------------------------
// Cobertura (itens 15 e 16)
// ---------------------------------------------------------------------------

/**
 * O QUE esta coberto. Nunca um booleano "tem garantia" (item 15).
 *
 * O caso que obriga isso e rotineiro: a OS trocou a fonte, reparou a placa e
 * fez limpeza, mas a garantia concedida cobre APENAS o reparo da fonte. Um
 * booleano transformaria o retorno por defeito na placa em garantia aceita, e
 * a loja consertaria de graca um servico que nunca garantiu.
 */
export const COVERAGE_KINDS = ['labor', 'service', 'part', 'component', 'other'] as const;
export type CoverageKind = (typeof COVERAGE_KINDS)[number];

export const COVERAGE_KIND_LABEL: Record<CoverageKind, string> = {
  labor: 'Mao de obra',
  service: 'Servico',
  part: 'Peca',
  component: 'Componente',
  other: 'Outro',
};

export function isKnownCoverageKind(value: string): value is CoverageKind {
  return (COVERAGE_KINDS as readonly string[]).includes(value);
}

export interface CoverageItem {
  id: string;
  kind: string;
  description: string;
  partId: string | null;
}

/** Uma garantia sem nenhum item de cobertura nao cobre nada, e isso e recusa. */
export function hasAnyCoverage(items: readonly CoverageItem[]): boolean {
  return items.length > 0;
}

/**
 * A cobertura e PARCIAL quando nao abrange o atendimento inteiro.
 *
 * A marca `coversWholeService` e declarada na emissao por quem concede — o
 * sistema nao adivinha, porque so a loja sabe o que prometeu ao cliente.
 */
export function isPartialCoverage(coversWholeService: boolean): boolean {
  return !coversWholeService;
}

export const COVERAGE_DESCRIPTION_MAX = 200;
export const COVERAGE_SUMMARY_MAX = 1000;
export const EXCLUSIONS_MAX = 2000;
export const TERMS_MAX = 4000;

// ---------------------------------------------------------------------------
// Avaliacao de cobertura no retorno (itens 22, 33 e 102)
// ---------------------------------------------------------------------------

/**
 * O QUE A PESSOA CONCLUIU sobre a cobertura daquele retorno.
 *
 * O sistema NAO decide isso sozinho, e a razao e tecnica antes de ser
 * comercial: o defeito relatado no retorno ("volta a desligar depois de 20
 * minutos") nao se casa automaticamente com um item de cobertura ("reparo da
 * fonte") por comparacao de texto. Quem casa os dois e o tecnico.
 *
 * O sistema faz a parte dele: mostra a cobertura, valida a vigencia, e recusa
 * quando a garantia claramente nao vale.
 */
export const COVERAGE_ASSESSMENTS = ['covered', 'not_covered', 'undetermined'] as const;
export type CoverageAssessment = (typeof COVERAGE_ASSESSMENTS)[number];

export const COVERAGE_ASSESSMENT_LABEL: Record<CoverageAssessment, string> = {
  covered: 'Coberto pela garantia',
  not_covered: 'Fora da cobertura',
  undetermined: 'A avaliar pelo tecnico',
};

export function isKnownCoverageAssessment(value: string): value is CoverageAssessment {
  return (COVERAGE_ASSESSMENTS as readonly string[]).includes(value);
}

/**
 * SO retorno COBERTO de garantia interna VIGENTE gera OS de garantia (item 23).
 *
 * `undetermined` de proposito NAO gera: um retorno que ainda precisa de
 * parecer nao e um compromisso de conserto gratuito, e transformar duvida em
 * garantia aceita e exatamente o que faz a loja pagar pelo que nao prometeu.
 */
export function shouldCreateWarrantyServiceOrder(input: {
  warrantyType: string;
  enforceable: boolean;
  assessment: string;
}): boolean {
  return (
    originatesInternalWarrantyService(input.warrantyType) &&
    input.enforceable &&
    input.assessment === 'covered'
  );
}

// ---------------------------------------------------------------------------
// Classificacao da OS (itens 27, 28 e 110)
// ---------------------------------------------------------------------------

/**
 * A NATUREZA da Ordem de Servico. NAO e o estado dela (item 28).
 *
 * "Garantia Interna" descreve POR QUE a OS existe; `status` descreve ONDE ela
 * esta. Uma OS de garantia passa por Aguardando Conserto, Reparo Concluido e
 * Finalizada como qualquer outra — e continua sendo de garantia o tempo todo.
 * Usar status para classificar destruiria as duas informacoes de uma vez.
 */
export const SERVICE_ORDER_CLASSIFICATIONS = ['standard', 'warranty_internal'] as const;
export type ServiceOrderClassification = (typeof SERVICE_ORDER_CLASSIFICATIONS)[number];

export const SERVICE_ORDER_CLASSIFICATION_LABEL: Record<ServiceOrderClassification, string> = {
  standard: 'Atendimento normal',
  warranty_internal: 'Garantia Interna',
};

export const DEFAULT_SERVICE_ORDER_CLASSIFICATION: ServiceOrderClassification = 'standard';

export function isKnownClassification(value: string): value is ServiceOrderClassification {
  return (SERVICE_ORDER_CLASSIFICATIONS as readonly string[]).includes(value);
}

export function classificationLabel(value: string): string {
  return isKnownClassification(value) ? SERVICE_ORDER_CLASSIFICATION_LABEL[value] : value;
}

/** A OS nasceu de um retorno em garantia? Usado pela etiqueta (itens 84 e 85). */
export function isWarrantyClassification(value: string): boolean {
  return value === 'warranty_internal';
}

// ---------------------------------------------------------------------------
// Reclassificacao (itens 29 a 32)
// ---------------------------------------------------------------------------

export const RECLASSIFY_REASON_MIN = 15;
export const RECLASSIFY_REASON_MAX = 1000;

/**
 * A justificativa TECNICA da reclassificacao (item 31).
 *
 * O minimo de 15 caracteres nao e capricho: "nao coberto" nao explica nada
 * para quem ler daqui a seis meses, nem para o cliente que vai receber a
 * cobranca. O que se exige e a razao tecnica — "oxidacao por liquido na
 * regiao do conector, posterior ao reparo da fonte".
 */
export function normalizeReclassificationReason(raw: string): string {
  const texto = raw.trim().replace(/\s+/g, ' ');
  if (texto.length < RECLASSIFY_REASON_MIN) {
    throw new RangeError(
      `Explique tecnicamente por que o defeito nao esta coberto (ao menos ${RECLASSIFY_REASON_MIN} caracteres).`,
    );
  }
  if (texto.length > RECLASSIFY_REASON_MAX) {
    throw new RangeError('Justificativa muito longa.');
  }
  return texto;
}

/** So OS de garantia se reclassifica: reclassificar atendimento normal e no-op. */
export function canReclassify(classification: string): boolean {
  return classification === 'warranty_internal';
}

// ---------------------------------------------------------------------------
// Motivos de cancelamento e revogacao (item 62)
// ---------------------------------------------------------------------------

export const WARRANTY_REASON_MIN = 10;
export const WARRANTY_REASON_MAX = 1000;

export function normalizeWarrantyReason(raw: string, what: string): string {
  const texto = raw.trim().replace(/\s+/g, ' ');
  if (texto.length < WARRANTY_REASON_MIN) {
    throw new RangeError(`Informe o motivo ${what} (ao menos ${WARRANTY_REASON_MIN} caracteres).`);
  }
  if (texto.length > WARRANTY_REASON_MAX) throw new RangeError('Motivo muito longo.');
  return texto;
}

/**
 * CANCELAR e REVOGAR nao sao a mesma coisa (item 62).
 *
 *   cancelar  -> a garantia nao deveria existir: emitida por engano, na OS
 *                errada, em duplicidade. Antes de produzir efeito.
 *   revogar   -> a cobertura existia e deixou de valer por um fato posterior:
 *                violacao de lacre, intervencao de terceiro.
 *
 * As duas param a garantia; a diferenca e o que a historia conta. Apagar essa
 * distincao faria "emiti errado" e "o cliente abriu o aparelho" virarem o
 * mesmo registro.
 */
export function canCancel(status: string): boolean {
  return status === 'draft' || status === 'active';
}

export function canRevoke(status: string): boolean {
  return status === 'active';
}

// ---------------------------------------------------------------------------
// Numeracao (item 13)
// ---------------------------------------------------------------------------

export const WARRANTY_NUMBER_PREFIX = 'GAR';
export const WARRANTY_NUMBER_PADDING = 6;

export function formatWarrantyNumber(value: number): string {
  return `${WARRANTY_NUMBER_PREFIX} ${String(value).padStart(WARRANTY_NUMBER_PADDING, '0')}`;
}

// ---------------------------------------------------------------------------
// Custos (itens 44 a 46 e 70)
// ---------------------------------------------------------------------------

/**
 * O que o atendimento em garantia CUSTOU a loja.
 *
 * CUSTO NAO E PAGAMENTO (item 44). Registrar que uma garantia consumiu R$ 80
 * de peca nao cria titulo, nao movimenta caixa e nao toca o razao — e o
 * Financeiro continua sem saber que isso aconteceu, porque nao aconteceu nada
 * financeiro. O que existe e a medida do que a garantia custou.
 */
export const COST_KINDS = ['labor', 'part', 'outsourced', 'freight', 'other'] as const;
export type CostKind = (typeof COST_KINDS)[number];

export const COST_KIND_LABEL: Record<CostKind, string> = {
  labor: 'Mao de obra',
  part: 'Peca',
  outsourced: 'Servico terceirizado',
  freight: 'Frete',
  other: 'Outro',
};

export function isKnownCostKind(value: string): value is CostKind {
  return (COST_KINDS as readonly string[]).includes(value);
}

export const COST_DESCRIPTION_MAX = 200;

// ---------------------------------------------------------------------------
// Certificado (itens 18 a 21 e 55)
// ---------------------------------------------------------------------------

export const CERTIFICATE_FORMATS = ['html'] as const;
export type CertificateFormat = (typeof CERTIFICATE_FORMATS)[number];

/**
 * A REFERENCIA OPACA do certificado (item 21).
 *
 * O QR e o link carregam este token, e nada mais. Nunca CPF, telefone,
 * endereco, e-mail, serial completo nem o id do cliente: um QR e uma imagem
 * que qualquer pessoa na fila do balcao consegue fotografar, e o que estiver
 * dentro dele vazou no instante em que foi impresso.
 *
 * O token tambem nao e enumeravel — nao e "certificado 124" — porque uma
 * referencia sequencial convida a varrer a faixa inteira.
 */
export const CERTIFICATE_TOKEN_BYTES = 24;

/** O QR carrega o token; quem resolve o token e o servidor, com autorizacao. */
export function certificatePathFor(token: string): string {
  return `/garantias/certificado/${token}`;
}

// ---------------------------------------------------------------------------
// Permissoes (item 68)
// ---------------------------------------------------------------------------

export const WARRANTY_VIEW = PERMISSIONS.WARRANTIES_VIEW;

/**
 * A permissao para EMITIR nao e a de CRIAR, e nenhuma das duas e a de ver.
 *
 * Criar rascunho e trabalho de balcao; emitir e o ato que passa a valer contra
 * a loja. Reclassificar exige autoridade tecnica (item 69) e por isso tem
 * chave propria — nunca o nome textual do cargo.
 */
export function reclassificationPermission(): PermissionKey {
  return PERMISSIONS.WARRANTIES_RECLASSIFY;
}

// ---------------------------------------------------------------------------
// Linha do tempo (item 65)
// ---------------------------------------------------------------------------

export const WARRANTY_TIMELINE_KINDS = {
  CREATED: 'created',
  ACTIVATED: 'activated',
  CERTIFICATE_ISSUED: 'certificate_issued',
  /** Prompt 13.1: a PRIMEIRA geracao do arquivo. Retry nao repete o fato. */
  CERTIFICATE_PDF_GENERATED: 'certificate_pdf_generated',
  RETURN_REGISTERED: 'return_registered',
  RETURN_ORDER_CREATED: 'return_order_created',
  RECLASSIFIED: 'reclassified',
  CANCELLED: 'cancelled',
  REVOKED: 'revoked',
  COST_RECORDED: 'cost_recorded',
} as const;

export type WarrantyTimelineKind =
  (typeof WARRANTY_TIMELINE_KINDS)[keyof typeof WARRANTY_TIMELINE_KINDS];

export const WARRANTY_TIMELINE_LABEL: Readonly<Record<string, string>> = {
  created: 'Garantia criada',
  activated: 'Garantia emitida',
  certificate_issued: 'Certificado gerado',
  certificate_pdf_generated: 'Certificado em PDF gerado',
  return_registered: 'Retorno registrado',
  return_order_created: 'Ordem de Servico de garantia criada',
  reclassified: 'Reclassificada para orcamento',
  cancelled: 'Garantia cancelada',
  revoked: 'Garantia revogada',
  cost_recorded: 'Custo registrado',
};

export function warrantyTimelineLabel(kind: string): string {
  return WARRANTY_TIMELINE_LABEL[kind] ?? kind;
}

// ---------------------------------------------------------------------------
// Reincidencia (item 87)
// ---------------------------------------------------------------------------

/**
 * A DEFINICAO, escrita antes de qualquer numero ser exibido (item 87).
 *
 * Reincidencia = um equipamento que VOLTOU sob uma Garantia Interna VIGENTE
 * ligada a uma OS anterior, com o retorno avaliado como COBERTO.
 *
 * O que NAO e reincidencia, e que um KPI descuidado contaria como se fosse:
 *   - o mesmo cliente trazendo outro aparelho;
 *   - o mesmo aparelho voltando por defeito diferente, fora da cobertura;
 *   - o mesmo aparelho voltando depois de vencida a garantia;
 *   - um retorno registrado e avaliado como fora da cobertura.
 *
 * Sem essa definicao escrita, "taxa de reincidencia" vira um numero que cada
 * pessoa interpreta de um jeito — e que acaba usado para cobrar do tecnico.
 */
export function countsAsRecurrence(input: {
  warrantyType: string;
  enforceableAtReturn: boolean;
  assessment: string;
}): boolean {
  /**
   * Os campos sao remapeados explicitamente, sem `as`.
   *
   * A primeira versao repassava o objeto inteiro com uma coercao de tipo, e o
   * nome diferente (`enforceableAtReturn` aqui, `enforceable` la) chegava como
   * `undefined`: TODO retorno contava como reincidencia. A coercao nao
   * consertava nada — so calava o compilador, que estava certo.
   */
  return shouldCreateWarrantyServiceOrder({
    warrantyType: input.warrantyType,
    enforceable: input.enforceableAtReturn,
    assessment: input.assessment,
  });
}

// ---------------------------------------------------------------------------
// Datas de referencia
// ---------------------------------------------------------------------------

/**
 * A data que decide a vigencia (item 34).
 *
 * SEMPRE do servidor, no fuso da EMPRESA. O navegador nao e autoridade: um
 * celular com a data adiantada transformaria garantia vencida em vigente.
 */
export function referenceDateFor(timeZone: string, now: Date = new Date()): string {
  return todayIn(timeZone, now);
}
