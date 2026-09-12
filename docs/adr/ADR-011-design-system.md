# ADR-011 — Design System e identidade

**Status:** Aceito · **Data:** Prompt 01

## Decisão

- **Tokens centralizados** em `src/app/globals.css`, via `@theme` do Tailwind 4
  — tipografia, cores, espaçamento, raio, sombras, breakpoints, z-index e
  estados. Nenhum componente define valor visual próprio.
- **Paleta institucional** exatamente como a Constituição define:
  `#0066FF`, `#101828`, `#FFFFFF`, `#F2F4F7`. Escalas derivadas (`brand-*`,
  `ink-*`) e cores semânticas são **tokens funcionais**, não cores
  institucionais novas.
- **Tipografia**: Sora (600/700) em títulos e destaques; Inter (400/500/600)
  em interface. DejaVu Sans não faz parte da identidade.
- **Carregamento de fontes**: `next/font/google`, que baixa no build e serve do
  próprio domínio — sem requisição a terceiros em runtime, sem CLS,
  `font-display: swap`, apenas os pesos previstos. Ambas são SIL OFL.
- **Logo**: não foi fornecida. `BrandMark` exibe um marcador neutro **sem
  lettering** e troca para o SVG oficial quando `BRAND_ASSETS_AVAILABLE` for
  ligado. A logo **não** é reconstruída com Sora, Inter ou qualquer fonte.
- **Componentes**: apenas os usados por login e shell. Nada de biblioteca
  completa antes de haver uso real.

## Alternativas consideradas

| Alternativa                  | Por que não                                                                                |
| ---------------------------- | ------------------------------------------------------------------------------------------ |
| shadcn/ui, MUI, Chakra       | Trazem identidade própria e peso; a Constituição exige Design System único e próprio.      |
| Self-hosting manual de WOFF2 | Exigiria versionar arquivos de fonte não fornecidos; `next/font` já auto-hospeda no build. |
| CSS-in-JS                    | Custo de runtime sem ganho; tokens em CSS são mais simples de auditar.                     |

## Consequências

- Enquanto os ativos oficiais não chegarem, login e topbar mostram o marcador
  neutro. Documentado em `public/brand/README.md`.
- O build precisa de acesso à rede para baixar as fontes na primeira vez
  (verificado: funciona). Em ambiente sem rede seria necessário versionar as
  fontes — registrado como risco no README.
