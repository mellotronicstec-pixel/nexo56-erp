/**
 * Formatacao compartilhada das telas de Agenda e Tarefas.
 *
 * DATA CIVIL NAO E INSTANTE (ADR-017). Prazo de tarefa e follow-up sao dias de
 * calendario guardados como `AAAA-MM-DD`: passar isso por `new Date()` faria o
 * navegador interpretar como meia-noite UTC e, em Sao Paulo, mostrar o dia
 * anterior — uma tarefa que vence dia 31 apareceria vencendo dia 30.
 *
 * Compromisso COM HORARIO e instante de verdade, e ai sim o navegador formata
 * no fuso de quem olha.
 */

export function dataCivil(value: string | null | undefined): string {
  if (!value) return 'Sem prazo';
  const [ano, mes, dia] = value.split('-');
  return ano && mes && dia ? `${dia}/${mes}/${ano}` : value;
}

const horaCurta = new Intl.DateTimeFormat('pt-BR', { timeStyle: 'short' });
const instanteCurto = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

export function hora(value: Date | null | undefined): string {
  return value ? horaCurta.format(value) : '';
}

export function instante(value: Date | null | undefined): string {
  return value ? instanteCurto.format(value) : '—';
}

export function single(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

const DIAS = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];

/**
 * O cabecalho de cada dia da agenda: "Hoje", "Amanha" ou o dia da semana.
 *
 * "Hoje" e calculado com a data civil da EMPRESA, que chega pronta do
 * servidor — nunca com o relogio do navegador. O dono viajando nao pode ver
 * "amanha" onde a loja ve "hoje".
 */
export function tituloDoDia(date: string | null, hoje: string): string {
  if (!date) return 'Sem prazo';
  if (date === hoje) return `Hoje, ${dataCivil(date)}`;

  const [ano, mes, dia] = date.split('-').map(Number);
  const nome =
    ano && mes && dia ? (DIAS[new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay()] ?? '') : '';

  const amanha = new Date(`${hoje}T00:00:00.000Z`);
  amanha.setUTCDate(amanha.getUTCDate() + 1);
  if (date === amanha.toISOString().slice(0, 10)) return `Amanha, ${dataCivil(date)}`;

  return nome ? `${nome[0]?.toUpperCase()}${nome.slice(1)}, ${dataCivil(date)}` : dataCivil(date);
}
