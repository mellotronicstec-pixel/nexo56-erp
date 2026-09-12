/**
 * Concatenacao condicional de classes.
 * Mantida minima de proposito: nao vale adicionar dependencia para isto.
 * Aceita qualquer valor e mantem apenas strings nao vazias, para permitir
 * expressoes como `cn(base, isActive && 'ativo')`.
 */
export function cn(...values: unknown[]): string {
  return values
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join(' ');
}
