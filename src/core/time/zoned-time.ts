/**
 * HORARIO CIVIL <-> INSTANTE, com o fuso DITO EXPLICITAMENTE.
 *
 * O PROBLEMA QUE ISTO RESOLVE. Um campo `datetime-local` no navegador devolve
 * "2026-09-22T14:00" — quatorze horas, sem fuso nenhum. Se o proprio navegador
 * converter isso com `new Date(...)`, o instante gravado passa a depender de
 * onde a pessoa estava: o dono viajando marca uma visita "as 14h" e a loja ve
 * 10h. O navegador vira, em silencio, a autoridade temporal do dominio.
 *
 * Aqui o fuso e PARAMETRO OBRIGATORIO. Quem chama diz em que fuso aquelas
 * quatorze horas foram ditas, e a conversao acontece no servidor.
 *
 * COMO A CONVERSAO FUNCIONA. Nao da para somar um deslocamento fixo: o
 * deslocamento depende do proprio instante que se quer descobrir (horario de
 * verao). Entao o calculo e iterativo: chuta que o horario civil e UTC,
 * descobre o deslocamento real do fuso naquele momento, corrige, e repete. Dois
 * passos bastam porque a segunda correcao so muda algo exatamente nas bordas
 * de mudanca de horario — e e para elas que existem as funcoes abaixo.
 */

/** Horario civil aceito: `AAAA-MM-DDTHH:mm` (segundos opcionais). */
const CIVIL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

export function isCivilDateTime(value: string): boolean {
  return CIVIL_DATE_TIME.test(value.trim());
}

/**
 * Deslocamento do fuso, em milissegundos, NAQUELE instante.
 *
 * Positivo a leste de Greenwich. Sao Paulo devolve -10800000 (tres horas).
 */
export function zoneOffsetAt(instant: Date, timeZone: string): number {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);

  const campo = (tipo: string): number => {
    const achado = partes.find((parte) => parte.type === tipo);
    return achado ? Number(achado.value) : 0;
  };

  /**
   * `hour` pode vir como 24 em algumas implementacoes para meia-noite; o
   * modulo evita um dia inteiro de erro numa borda rara.
   */
  const comoSeFosseUtc = Date.UTC(
    campo('year'),
    campo('month') - 1,
    campo('day'),
    campo('hour') % 24,
    campo('minute'),
    campo('second'),
  );

  return comoSeFosseUtc - instant.getTime();
}

export interface ZonedConversion {
  instant: Date;
  /**
   * `gap` — o horario civil NAO EXISTE naquele fuso: e a hora pulada quando o
   * relogio adianta. `ambiguous` — ele existe DUAS vezes, quando o relogio
   * atrasa. Em ambos os casos `instant` traz a escolha documentada abaixo, e
   * cabe a quem chamou decidir se avisa a pessoa.
   */
  kind: 'exact' | 'gap' | 'ambiguous';
}

/**
 * Horario civil dito NAQUELE fuso -> instante absoluto.
 *
 * COMO AS BORDAS SAO DETECTADAS. Um horario civil vira instante somando o
 * deslocamento do fuso — mas nas viradas de horario de verao existem DOIS
 * deslocamentos possiveis. Entao o calculo monta os dois candidatos, usando o
 * deslocamento bem antes e bem depois da virada, e pergunta a cada um: "voltando
 * para civil, voce devolve o horario que me pediram?".
 *
 *   os dois respondem que sim  -> a hora acontece DUAS vezes (`ambiguous`)
 *   nenhum responde que sim    -> a hora NAO EXISTE (`gap`)
 *   exatamente um responde sim -> hora comum (`exact`)
 *
 * Tentar resolver isso iterando o deslocamento nao funciona: numa hora
 * repetida a iteracao converge para uma das duas ocorrencias sem perceber que
 * havia escolha, e o resultado fica certo por acidente.
 *
 * O QUE CADA BORDA DEVOLVE:
 *
 *   `gap` (relogio adianta): o instante logo apos a virada. Recusar seria
 *   defensavel, mas deixaria a pessoa presa num formulario sem entender o
 *   motivo; empurrar para depois da virada e o que agenda de verdade faz.
 *
 *   `ambiguous` (relogio atrasa): a PRIMEIRA ocorrencia. Escolher a segunda
 *   adiaria o compromisso em uma hora sem que ninguem tivesse pedido.
 */
export function zonedCivilToInstant(civil: string, timeZone: string): ZonedConversion {
  const texto = civil.trim();
  const partes = CIVIL_DATE_TIME.exec(texto);
  if (!partes) throw new Error(`Horario civil invalido: ${civil}`);

  const [, ano, mes, dia, hora, minuto, segundo] = partes;

  /** O horario civil lido como se fosse UTC: a base da aritmetica. */
  const comoSeFosseUtc = Date.UTC(
    Number(ano),
    Number(mes) - 1,
    Number(dia),
    Number(hora),
    Number(minuto),
    Number(segundo ?? '0'),
  );

  const UM_DIA = 86_400_000;
  const deslocamentoAntes = zoneOffsetAt(new Date(comoSeFosseUtc - UM_DIA), timeZone);
  const deslocamentoDepois = zoneOffsetAt(new Date(comoSeFosseUtc + UM_DIA), timeZone);

  /** Quanto menor o deslocamento, mais tarde o instante — dai a ordem. */
  const candidatoCedo = comoSeFosseUtc - deslocamentoAntes;
  const candidatoTarde = comoSeFosseUtc - deslocamentoDepois;

  const alvo = normalizeCivil(texto);
  const cedoConfere = instantToZonedCivil(new Date(candidatoCedo), timeZone) === alvo;
  const tardeConfere = instantToZonedCivil(new Date(candidatoTarde), timeZone) === alvo;

  if (cedoConfere && tardeConfere && candidatoCedo !== candidatoTarde) {
    return {
      instant: new Date(Math.min(candidatoCedo, candidatoTarde)),
      kind: 'ambiguous',
    };
  }

  if (cedoConfere) return { instant: new Date(candidatoCedo), kind: 'exact' };
  if (tardeConfere) return { instant: new Date(candidatoTarde), kind: 'exact' };

  /**
   * Nenhum dos dois devolve o horario pedido: ele foi pulado pelo relogio. O
   * candidato construido com o deslocamento ANTERIOR cai depois da virada, que
   * e para onde a hora inexistente e empurrada.
   */
  return { instant: new Date(candidatoCedo), kind: 'gap' };
}

/** `AAAA-MM-DDTHH:mm` a partir de um instante, no fuso indicado. */
export function instantToZonedCivil(instant: Date, timeZone: string): string {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(instant);

  const campo = (tipo: string): string =>
    partes.find((parte) => parte.type === tipo)?.value ?? '00';

  const hora = String(Number(campo('hour')) % 24).padStart(2, '0');
  return `${campo('year')}-${campo('month')}-${campo('day')}T${hora}:${campo('minute')}`;
}

/** Descarta os segundos, para comparar com o que `instantToZonedCivil` produz. */
function normalizeCivil(civil: string): string {
  return civil.slice(0, 16);
}

/** Hora do dia (`HH:mm`) de um instante, no fuso indicado. */
export function formatZonedTime(instant: Date, timeZone: string): string {
  return instantToZonedCivil(instant, timeZone).slice(11);
}
