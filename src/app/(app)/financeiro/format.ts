import { todayIn } from '@/core/time/civil-date';

/**
 * Formatacao compartilhada das telas do Financeiro (Prompt 12, item 62).
 *
 * DATA CIVIL NAO E INSTANTE (ADR-017). Vencimento e competencia sao dia de
 * calendario guardado como `AAAA-MM-DD`: passar isso por `new Date()` faria o
 * navegador interpretar como meia-noite UTC e, em Sao Paulo, mostrar o dia
 * anterior. Por isso a conversao aqui e string, sem `Date` no meio.
 */

/** `2026-03-15` -> `15/03/2026`. Sem `Date`, sem fuso, sem vespera. */
export function dataCivil(value: string | null | undefined): string {
  if (!value) return '—';
  const [ano, mes, dia] = value.split('-');
  return ano && mes && dia ? `${dia}/${mes}/${ano}` : value;
}

const instanteCurto = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
});

const dataCurta = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' });

/** Instante (quando algo foi registrado) no fuso de quem le. */
export function instante(value: Date | null | undefined): string {
  return value ? instanteCurto.format(value) : '—';
}

export function dataDeInstante(value: Date | null | undefined): string {
  return value ? dataCurta.format(value) : '—';
}

/**
 * Periodo padrao das telas de visao geral: o mes corrente NO FUSO DA EMPRESA.
 *
 * Nao e "os ultimos 30 dias": quem fecha o mes pergunta pelo mes, e um periodo
 * deslizante daria um numero diferente a cada visita, impossivel de conferir
 * com o extrato.
 */
export function periodoDoMes(timeZone: string, referencia?: string): { from: string; to: string } {
  const hoje = referencia ?? todayIn(timeZone);
  const [anoTexto, mesTexto] = hoje.split('-');
  const ano = Number(anoTexto);
  const mes = Number(mesTexto);

  const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const doisDigitos = (valor: number) => String(valor).padStart(2, '0');

  return {
    from: `${anoTexto}-${doisDigitos(mes)}-01`,
    to: `${anoTexto}-${doisDigitos(mes)}-${doisDigitos(ultimoDia)}`,
  };
}

/** Um unico valor da query string, ja aparado. */
export function single(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}
