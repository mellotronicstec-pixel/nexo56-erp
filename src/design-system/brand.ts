/**
 * Ativos oficiais de marca (Prompt 00, itens 73/74/116; Prompt 01, item 50).
 *
 * ESTADO ATUAL: os pacotes oficiais de logos e icones vetorizados Nexo56 NAO
 * foram fornecidos a esta sessao. Conforme a Constituicao, a logo NAO pode ser
 * reconstruida — nem redesenhada, nem redigitada com Sora ou Inter.
 *
 * Enquanto os arquivos nao chegam, `BrandMark` exibe um marcador neutro sem
 * lettering (um bloco na cor institucional), que e apenas um espaco reservado,
 * nunca uma versao da marca.
 *
 * COMO ATIVAR quando os arquivos oficiais chegarem:
 *   1. copie os SVG originais para `public/brand/` preservando os mestres;
 *   2. confira os nomes abaixo em BRAND_ASSETS;
 *   3. troque BRAND_ASSETS_AVAILABLE para true;
 *   4. registre em docs/architecture/design-system.md qual versao foi usada
 *      em qual contexto.
 */

export const BRAND_ASSETS_AVAILABLE = false;

export const BRAND_ASSETS = {
  /** Logo horizontal para fundo claro (topbar, login). */
  logoLight: '/brand/nexo56-logo.svg',
  /** Logo horizontal para fundo escuro. */
  logoDark: '/brand/nexo56-logo-branco.svg',
  /** Simbolo isolado (favicon, avatar, espacos reduzidos). */
  symbol: '/brand/nexo56-simbolo.svg',
} as const;

export const PRODUCT_NAME = 'Nexo56 ERP';
