/**
 * Formatacao compartilhada das telas do Portal — mesmas regras de
 * `(app)/garantias/format.ts` (ADR-017): data civil nunca passa por
 * `new Date()` direto, sob pena de mostrar o dia errado por fuso.
 */

export function dataCivil(value: string | null | undefined): string {
  if (!value) return '—';
  const [ano, mes, dia] = value.split('-');
  return ano && mes && dia ? `${dia}/${mes}/${ano}` : value;
}

const dataHoraCurta = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

export function dataHora(value: Date | null | undefined): string {
  return value ? dataHoraCurta.format(value) : '—';
}
