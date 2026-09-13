# Tokens

Arquivo único: **`src/app/globals.css`**. Todo valor visual do produto nasce
aqui, dentro de `@theme` (consumido pelas utilitárias do Tailwind 4) ou de
`:root` (consumido diretamente por CSS).

Nenhum componente inventa `#hex`, `12px` ou `0 2px 6px rgba(...)`. Se um valor
não existe como token, a decisão é acrescentá-lo aqui — não escrevê-lo solto.

## Grupos implementados

| Grupo                   | Tokens                                                                                                                             | Observação                                                     |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Famílias                | `--font-heading`, `--font-body`                                                                                                    | Sora e Inter, com fallback sans-serif                          |
| Escala tipográfica      | `--text-display`, `--text-h1`…`--text-h6`, `--text-body-lg`, `--text-body`, `--text-ui`, `--text-small`                            | Cada um com `--line-height` e, quando cabe, `--letter-spacing` |
| Escala mobile           | os mesmos `--text-*` redefinidos abaixo de 768px                                                                                   | Títulos encolhem; interface **não**                            |
| Marca                   | `--color-brand-50`…`--color-brand-900`                                                                                             | Derivados de `#0066FF`                                         |
| Neutros                 | `--color-ink-25`…`--color-ink-900`                                                                                                 | Derivados de `#101828`                                         |
| Funcionais              | `--color-success-*`, `--color-warning-*`, `--color-danger-*`, `--color-info-*`                                                     | Semânticos, subordinados à identidade                          |
| Papéis de superfície    | `--surface-page`, `--surface-raised`, `--surface-sunken`, `--surface-inverted`, `--overlay-scrim`                                  | Nomeados pelo papel, não pela cor                              |
| Bordas e texto auxiliar | `--border-default`, `--border-strong`, `--text-muted`, `--text-disabled`                                                           |                                                                |
| Espaçamento             | `--spacing-3xs`…`--spacing-2xl`                                                                                                    | Equivale a 2/4/8/12/16/24/32/48                                |
| Raio                    | `--radius-xs` (4) … `--radius-xl` (16), `--radius-full`                                                                            | Nem tudo arredondado                                           |
| Sombra                  | `--shadow-xs`…`--shadow-lg`                                                                                                        | Discretas, empilhamento proibido                               |
| Espessura de borda      | `--border-width-thin`, `--border-width-thick`                                                                                      |                                                                |
| Breakpoints             | `--breakpoint-sm` 640 · `md` 768 · `lg` 1024 · `xl` 1280 · `2xl` 1536                                                              | Poucos e documentados                                          |
| Camadas (z-index)       | `--z-base` 0 · `sticky` 100 · `drawer` 200 · `overlay` 300 · `modal` 400 · `toast` 500                                             |                                                                |
| Animação                | `--duration-instant` 80ms · `fast` 140ms · `base` 200ms · `slow` 320ms                                                             |                                                                |
| Estados                 | `--state-hover-overlay`, `--state-focus-ring`, `--state-focus-ring-width`, `--state-focus-ring-offset`, `--state-disabled-opacity` |                                                                |

## Por que a escala mobile vive numa media query

As utilitárias do Tailwind 4 referenciam a variável (`font-size: var(--text-h1)`),
não o valor. Redefinir `--text-h1` abaixo de 768px muda **todos** os títulos de
uma vez, sem variante `md:` espalhada por dezenas de arquivos — e sem o risco de
alguém esquecer uma tela. Verificado no CSS gerado pelo build.

## O que NÃO é token

Largura de coluna de tabela, altura de cartão específico, posição de um ícone
numa tela: isso é layout daquela tela, não vocabulário do sistema. Token é o que
se repete.
