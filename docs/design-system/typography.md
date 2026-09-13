# Tipografia

Duas famílias, papéis separados e sem sobreposição:

| Família   | Onde                                                                         | Pesos carregados |
| --------- | ---------------------------------------------------------------------------- | ---------------- |
| **Sora**  | títulos, headings, destaque institucional, números de KPI, títulos de cartão | 600, 700         |
| **Inter** | corpo, menus, botões, campos, tabelas, filtros, rótulos, legendas, navegação | 400, 500, 600    |

Nenhum outro peso é baixado. **DejaVu Sans não faz parte da identidade** e não
aparece em lugar algum.

## Escala — desktop (≥ 768px)

| Token          | Família       | Tamanho / entrelinha |
| -------------- | ------------- | -------------------- |
| `text-display` | Sora 700      | 48 / 56              |
| `text-h1`      | Sora 700      | 32 / 40              |
| `text-h2`      | Sora 600      | 24 / 32              |
| `text-h3`      | Sora 600      | 20 / 28              |
| `text-h4`      | Sora 600      | 18 / 26              |
| `text-h5`      | Sora 600      | 16 / 24              |
| `text-h6`      | Sora 600      | 14 / 20              |
| `text-body-lg` | Inter 400     | 18 / 28              |
| `text-body`    | Inter 400     | 16 / 24              |
| `text-ui`      | Inter 400/500 | 14 / 20              |
| `text-small`   | Inter 400/500 | 12 / 18              |

## Escala — mobile (< 768px)

| Token                 | Tamanho / entrelinha |
| --------------------- | -------------------- |
| `text-display`        | 36 / 44              |
| `text-h1`             | 28 / 36              |
| `text-h2`             | 22 / 30              |
| `text-h3`             | 18 / 26              |
| `text-h4`             | 16 / 24              |
| `text-h5` / `text-h6` | 14 / 20              |

O texto de **interface não encolhe**. Reduzir corpo em tela pequena é o erro que
torna um ERP ilegível no balcão — e quem opera no celular costuma estar em pé,
com pressa e sob luz ruim. Nada operacional fica abaixo de 12px.

## Hierarquia de cabeçalhos

Um `<h1>` por página, sempre vindo do `PageHeader`. Seções usam `<h2>` via
`Section`; cartões dentro de uma seção usam `<h3>` (`CardHeader headingLevel={3}`).

A hierarquia não é estética: é o índice que quem usa leitor de tela percorre
para se situar na página. Verificado em navegador (um único `h1` por tela).

## Carregamento das fontes

`next/font/google` baixa Sora e Inter **no build** e as serve do próprio domínio
— sem requisição a terceiros em runtime, sem CLS, com `font-display: swap`.

**Consequência assumida:** o build precisa de rede para buscar as fontes. Num
ambiente de build offline isso falha. A alternativa (versionar os WOFF2 no
repositório) está descrita em [ADR-025](../adr/ADR-025-shell-responsivo.md) e
segue como evolução — hoje o projeto **não** faz self-host.
