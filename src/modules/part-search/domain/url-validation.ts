/**
 * VALIDACAO DE URL EXTERNA (Prompt 21, itens 33, 119, 120, 168, 206 a 211).
 *
 * Toda URL de resultado externo e dado NAO CONFIAVEL vindo do provedor —
 * este e o UNICO portao antes dela virar um link clicavel na tela. So
 * `http:`/`https:` sao aceitos; qualquer outro esquema (`javascript:`,
 * `data:`, `file:`, `vbscript:`, etc.) e uma URL sem host sao rejeitados.
 *
 * O BACKEND NUNCA BUSCA (`fetch`) NENHUMA DESSAS URLS (item 119/120): elas
 * so existem para o NAVEGADOR do usuario abrir, numa nova aba, depois desta
 * validacao — o risco de SSRF simplesmente nao existe porque o servidor
 * nunca faz a requisicao. Ver o teste de arquitetura
 * `part-search-boundaries.test.ts`.
 */
export function isSafeExternalUrl(candidate: string | null | undefined): boolean {
  if (!candidate || candidate.trim().length === 0) return false;

  let parsed: URL;
  try {
    parsed = new URL(candidate.trim());
  } catch {
    return false;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  if (!parsed.hostname) return false;

  return true;
}

/** Devolve a URL somente se segura; caso contrario `null` — nunca lanca. */
export function sanitizeExternalUrl(candidate: string | null | undefined): string | null {
  return isSafeExternalUrl(candidate) ? (candidate as string).trim() : null;
}
