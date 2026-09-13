# Design System e identidade

> **Prompt 04:** a documentação completa do Design System — tokens, tipografia,
> cores, componentes, padrões, responsividade, acessibilidade e navegação —
> passou a viver em [docs/design-system/](../design-system/overview.md). Esta
> página guarda o registro da fundação visual do Prompt 01.

Decisões: [ADR-011](../adr/ADR-011-design-system.md).

## Tokens

Fonte única: `src/app/globals.css`, bloco `@theme`.

| Grupo                | Conteúdo                                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Tipografia           | `--font-heading` (Sora), `--font-body` (Inter), escala `--text-h1`…`--text-small` com line-height e letter-spacing |
| Cores institucionais | `#0066FF`, `#101828`, `#FFFFFF`, `#F2F4F7`                                                                         |
| Escalas derivadas    | `brand-50…900`, `ink-25…900`                                                                                       |
| Semânticas           | `success`, `warning`, `danger`, `info`                                                                             |
| Espaçamento          | `3xs` … `2xl`                                                                                                      |
| Raio                 | `xs` (4px) … `full`                                                                                                |
| Sombras              | `xs` … `lg` — discretas                                                                                            |
| Breakpoints          | 640 / 768 / 1024 / 1280                                                                                            |
| z-index              | base, sticky, drawer, overlay, modal, toast                                                                        |
| Estados              | overlay de hover, cor do anel de foco, opacidade de desabilitado                                                   |

## Tipografia

| Uso                              | Fonte | Peso |
| -------------------------------- | ----- | ---- |
| H1                               | Sora  | 700  |
| H2–H6, títulos de card, números  | Sora  | 600  |
| Corpo, campos, tabelas, legendas | Inter | 400  |
| Rótulos, menu                    | Inter | 500  |
| Botões, menu ativo               | Inter | 600  |

Escala desktop e mobile seguem os itens 78 e 79 da Constituição. Nada de texto
operacional abaixo de 12px.

**Carregamento:** `next/font/google` — baixa no build, serve do próprio
domínio, `font-display: swap`, apenas os pesos acima. Ambas SIL OFL.

## Componentes

Apenas o necessário para login e shell (Prompt 01, item 53):

`Button` · `Input` · `Label` · `Field` · `Card` (+`CardHeader`/`CardBody`) ·
`Alert` · `Badge` · `Avatar` · `Spinner` · `Skeleton` · `EmptyState` ·
`BrandMark`

Estados cobertos: default, hover, focus-visible, active, disabled, loading,
erro, vazio.

## Acessibilidade

- HTML semântico (`nav`, `main`, `header`, `aside`, `table` com `th scope`).
- Foco visível nunca removido (`:focus-visible` com anel de 2px).
- `Field` liga rótulo, campo e erro por `htmlFor` e `aria-describedby`.
- `Alert` usa `role="alert"` só para erro; `role="status"` nos demais.
- Alvos de toque de 44px na navegação mobile (`.touch-target`).
- Gaveta mobile: `role="dialog"`, `aria-modal`, fecha com Esc e no overlay.
- `prefers-reduced-motion` respeitado.

## Identidade da marca

Os ativos oficiais **não** foram fornecidos. `BrandMark` exibe um marcador
neutro **sem lettering** e passa a usar o SVG oficial quando
`BRAND_ASSETS_AVAILABLE` for ligado em `src/design-system/brand.ts`.

A logo NEXO56 **não** é recriada com Sora, Inter ou qualquer fonte. Instruções
em `public/brand/README.md`.

## Responsividade

| Faixa   | Comportamento                                                                     |
| ------- | --------------------------------------------------------------------------------- |
| ≥ 768px | sidebar fixa de 256px + topbar + conteúdo                                         |
| < 768px | sidebar vira **gaveta** acionada pela topbar — não é a sidebar desktop comprimida |
| Tabelas | contêiner com `overflow-x: auto`; a página não rola na horizontal                 |
| Cards   | grade de 2 colunas que passa a 1 no mobile                                        |

Verificado em navegador a 1280×900 e 390×844.
