# Ativos oficiais de marca — Nexo56

Esta pasta recebe os **arquivos oficiais** de logo e ícones do Nexo56,
fornecidos pelo proprietário do produto.

## Estado atual

**Pendente.** Os pacotes oficiais ainda não foram entregues ao projeto.
Nenhum ativo de marca foi inventado, redesenhado ou reconstruído
(Prompt 00, itens 74 e 116).

## Regras (Prompt 00, itens 73, 74 e 116)

1. Preservar os arquivos originais recebidos — eles são os mestres.
2. Não editar os vetores mestres. Derivados técnicos (ex.: PNG para e-mail)
   ficam em pasta separada, nunca por cima do original.
3. Nunca recriar o lettering NEXO56 com Sora, Inter ou qualquer outra fonte.
4. Não deformar, recolorir arbitrariamente, aplicar contorno ou sombra.
5. Priorizar SVG na interface.
6. Documentar qual versão é usada em qual contexto.

## Arquivos esperados

| Arquivo                  | Uso                                               |
| ------------------------ | ------------------------------------------------- |
| `nexo56-logo.svg`        | Logo horizontal sobre fundo claro (topbar, login) |
| `nexo56-logo-branco.svg` | Logo horizontal sobre fundo escuro                |
| `nexo56-simbolo.svg`     | Símbolo isolado (favicon, espaços reduzidos)      |

Os nomes acima são referenciados em `src/design-system/brand.ts`. Se os
arquivos oficiais tiverem outros nomes, ajuste **a constante**, preservando os
arquivos como vieram.

## Como ativar

1. Copie os SVG oficiais para esta pasta.
2. Confira os nomes em `src/design-system/brand.ts` (`BRAND_ASSETS`).
3. Troque `BRAND_ASSETS_AVAILABLE` para `true`.
4. Rode `npm run build` e confira login e topbar em desktop e mobile.

## Favicon temporário

Enquanto o símbolo oficial não chega, `src/app/icon.svg` traz um **marcador
mudo**: um quadrado na cor institucional, sem letra, sem número e sem forma que
imite a marca. Ele não é uma versão da logo — existe só para a aba do navegador
ter um ícone.

O mesmo vale para `public/favicon.ico` (16×16, um quadrado sólido) — ele existe
porque o navegador pede `/favicon.ico` por conta própria, e um 404 a cada
carregamento polui o console.

Ao receber o símbolo oficial: substitua `src/app/icon.svg` e `public/favicon.ico`
pelos arquivos originais,
copie os mestres para esta pasta, e troque `BRAND_ASSETS_AVAILABLE` para `true`
em `src/design-system/brand.ts`.
