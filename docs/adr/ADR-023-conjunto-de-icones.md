# ADR-023 — Conjunto de ícones próprio, sem biblioteca externa

**Status:** Aceito · **Data:** Prompt 04

## Contexto

A interface precisa de ícones coerentes: menu, navegação, ações de tabela,
estados, campo de busca, visibilidade de senha. A Constituição exige **uma
única** biblioteca coerente (item 62) e proíbe reconstruir o símbolo Nexo56 com
qualquer biblioteca (item 63).

O caminho óbvio seria instalar `lucide-react`, `heroicons` ou equivalente.

## Decisão

Um conjunto **próprio**, em `src/design-system/icons.tsx`: cerca de duas dezenas
de ícones desenhados sob as mesmas regras — grade 24×24, traço 1.5, juntas
arredondadas, `currentColor`, `aria-hidden` por padrão e `role="img"` com
`<title>` quando o ícone carrega informação.

Zero dependência nova.

## Motivo

Três razões, em ordem de peso:

1. **Proporção.** O produto usa cerca de 25 ícones. Uma biblioteca traz milhares
   de arquivos e um passo de tree-shaking para entregar 25 — e a hospedagem
   compartilhada da Hostinger (ADR-012) cobra por peso de build e de instalação.
2. **Coerência real.** Um conjunto pequeno e próprio garante o mesmo traço e a
   mesma grade em todos. Misturar um ícone "que faltava" de outra fonte é como
   o desalinhamento entra — e ele sempre entra.
3. **A marca não vem de biblioteca.** Nenhum pacote conhece o símbolo Nexo56. Ele
   vive em `brand-mark.tsx`, depende do SVG oficial e **nunca** é aproximado por
   um ícone genérico.

O custo é claro e aceito: cada ícone novo é trabalho manual. Para 25 ícones, é
menos trabalho do que auditar e travar uma dependência.

## Alternativas descartadas

| Alternativa                 | Por que não                                             |
| --------------------------- | ------------------------------------------------------- |
| `lucide-react` ou similar   | milhares de arquivos para usar 25; dependência a manter |
| Ícones como fonte (webfont) | problema de acessibilidade e de fallback conhecido      |
| Sprite SVG externo          | requisição extra e complicação de cache, sem ganho aqui |
| Emoji                       | não é identidade visual; varia por sistema operacional  |

## Consequências

- Ícone novo é um componente novo, escrito à mão seguindo as regras da grade.
- Se o conjunto passar de ~60 ícones, a conta vira: reavaliar a biblioteca num
  novo ADR.
- Acessibilidade fica correta por padrão: decorativo é oculto, informativo é
  nomeado — sem depender de quem usa lembrar.
