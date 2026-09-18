/**
 * Formatacao compartilhada das telas de Garantias.
 *
 * DATA CIVIL NAO E INSTANTE (ADR-017). Vigencia e dia de calendario guardado
 * como `AAAA-MM-DD`: passar isso por `new Date()` faria o navegador
 * interpretar como meia-noite UTC e, em Sao Paulo, mostrar o dia anterior —
 * um certificado que termina dia 31 apareceria terminando dia 30.
 */

export function dataCivil(value: string | null | undefined): string {
  if (!value) return '—';
  const [ano, mes, dia] = value.split('-');
  return ano && mes && dia ? `${dia}/${mes}/${ano}` : value;
}

const instanteCurto = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

export function instante(value: Date | null | undefined): string {
  return value ? instanteCurto.format(value) : '—';
}

export function single(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}
