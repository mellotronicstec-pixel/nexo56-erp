# ADR-025 — Shell responsivo: gaveta no lugar de sidebar comprimida

**Status:** Aceito · **Data:** Prompt 04

## Contexto

Um ERP de assistência técnica é usado em duas situações muito diferentes: o
administrativo, num monitor, e o balcão ou a bancada, no celular — em pé, com
pressa, às vezes com uma mão só.

O caminho barato é uma sidebar que encolhe: 256px no desktop, 64px só com
ícones no tablet, e some no celular. Ele é barato porque é uma média query.

## Decisão

**Duas apresentações, não uma comprimida.**

| Faixa   | Navegação                                       | Listas                      |
| ------- | ----------------------------------------------- | --------------------------- |
| ≥ 768px | sidebar fixa de 256px, rótulo + ícone           | tabela                      |
| < 768px | gaveta acionada pela topbar, navegação completa | cartões com os mesmos dados |

A gaveta e o modal compartilham o mesmo comportamento (`useDismissable`): foco
entra, circula dentro, Esc fecha, clique fora fecha, foco volta ao gatilho.
Alvos de toque de 44px abaixo de 768px.

O shell é Client Component (rota atual, gaveta, menu), mas **não carrega dados e
não decide acesso**: recebe do layout, que é Server Component.

## Motivo

Sidebar só de ícones obriga a decorar símbolos. Num sistema com Ordens de
Serviço, Estoque, Compras, Financeiro e Garantias, seis ícones parecidos viram
um jogo de adivinhação — e o custo cai justamente sobre quem usa menos o
sistema. A gaveta mostra o rótulo inteiro e some depois.

Tabela comprimida é o mesmo erro na listagem: colunas espremidas até o texto
quebrar letra a letra. O cartão mostra o que importa e leva à ficha.

Manter uma única fonte de dados com duas apresentações (`hidden md:block` e
`md:hidden`) evita o pior dos mundos: duas telas que divergem com o tempo.

## Alternativas descartadas

| Alternativa                                | Por que não                                          |
| ------------------------------------------ | ---------------------------------------------------- |
| Sidebar comprimida só com ícones           | obriga a decorar símbolos; piora para quem usa menos |
| Tabela com rolagem horizontal no celular   | rolagem lateral em lista é hostil; some informação   |
| Menu inferior fixo (padrão de app)         | não acomoda seções nem crescimento para 12+ módulos  |
| Renderizar só uma das apresentações por JS | flash de conteúdo errado e quebra sem JavaScript     |

## Consequências

- Cada listagem escreve duas apresentações. É repetição deliberada, com os
  mesmos dados, e as primitivas (`Table` / `CardList`) mantêm o padrão.
- A gaveta precisa de JavaScript. Sem ele, a navegação some no celular — aceito
  porque o resto da aplicação funciona por formulário (Server Actions), e o
  login e as ações continuam funcionando.
- Um defeito real surgiu desse desenho e foi corrigido: texto `sr-only` dentro
  da tabela escapava do contêiner de rolagem (por ser `position: absolute` sem
  bloco de contenção próximo) e dava rolagem horizontal à página em 768px. A
  `Table` passou a ser `relative`.
- Verificado em navegador real em 360, 390, 768, 1024, 1280, 1440 e 1920.
