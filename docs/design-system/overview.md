# Design System do Nexo56 — visão geral

O Nexo56 tem **um** Design System. Todos os módulos — os que existem e os que
virão — usam os mesmos tokens, componentes, tipografia, regras responsivas e
critérios de acessibilidade. Nenhum módulo inventa a própria aparência.

## Índice

- [Tokens](tokens.md)
- [Tipografia](typography.md)
- [Cores](colors.md)
- [Componentes](components.md)
- [Padrões de tela](patterns.md)
- [Responsividade](responsive.md)
- [Acessibilidade](accessibility.md)
- [Navegação e shell](navigation.md)

Decisões e alternativas: [ADR-011](../adr/ADR-011-design-system.md),
[ADR-023](../adr/ADR-023-conjunto-de-icones.md),
[ADR-024](../adr/ADR-024-estrategia-de-tema.md),
[ADR-025](../adr/ADR-025-shell-responsivo.md).

## Onde as coisas moram

```
src/design-system/
  cn.ts                 junção de classes
  brand.ts              ativos oficiais da marca (e o estado deles)
  icons.tsx             conjunto único de ícones
  components/
    index.ts            barril público — todas as telas importam daqui
    button · icon-button · input · password-input · choice · form-field
    label · search-field · filter-bar
    card · metric-card · section · badge · alert · avatar · table · pagination
    page-header · breadcrumb · tabs · menu
    modal · drawer · tooltip · toast · use-dismissable
    empty-state · error-state · skeleton · spinner
src/app/globals.css     TOKENS — fonte única de verdade visual
src/app/design-system/  vitrine interna (não existe em produção)
```

## Regras que não se negociam

| Regra                                                | Por quê                                                   |
| ---------------------------------------------------- | --------------------------------------------------------- |
| Toda tela importa de `@/design-system/components`    | Mover um arquivo não pode quebrar 30 páginas              |
| Nenhum componente define cor, raio ou sombra própria | O token é a fonte única; valor solto vira dívida          |
| A logo **nunca** é reconstruída com fonte            | Constituição, item 74                                     |
| Vermelho só para destrutivo e erro                   | Cor semântica gasta em decoração deixa de comunicar       |
| O Design System não conhece o domínio                | Componente não sabe o que é uma OS — recebe dados prontos |
| Estado nunca depende só de cor                       | Quem não distingue vermelho também precisa entender       |
| O frontend não é barreira de segurança               | O backend revalida sempre (Prompts 01 a 03)               |

## Como ver tudo funcionando

```bash
npm run dev
# abra http://localhost:3000/design-system
```

A vitrine mostra tipografia, cores, botões, campos, etiquetas, avisos, cartões,
tabelas, abas, modal, gaveta, menu, dica, avisos temporários e os estados de
carregando/vazio/erro. **Ela responde 404 em produção** — é referência de quem
constrói, não tela de produto. Os dados nela são demonstrativos e nada toca o
banco.
