# Responsividade

Mobile-first. Cinco breakpoints, todos documentados:

| Token  | Largura | O que muda                                                    |
| ------ | ------- | ------------------------------------------------------------- |
| (base) | < 640   | uma coluna, gaveta no lugar da sidebar, tabelas viram cartões |
| `sm`   | 640     | segunda coluna em formulários curtos                          |
| `md`   | **768** | **sidebar fixa aparece; tabelas aparecem**                    |
| `lg`   | 1024    | seletor de unidade na topbar; grades de três colunas          |
| `xl`   | 1280    | respiro lateral maior                                         |
| `2xl`  | 1536    | limite de leitura preservado (`max-w-5xl`)                    |

## As três regras

1. **A sidebar não é comprimida.** Abaixo de 768px ela vira uma gaveta acionada
   pela topbar — com foco preso, Esc, e foco devolvido ao botão.
2. **Tabela não é espremida.** Abaixo de 768px, cartões com os mesmos dados.
   Comprimir colunas até o texto quebrar letra a letra é o que torna ERP
   inutilizável no balcão.
3. **A página nunca rola na horizontal.** Só tabelas e diagramas rolam, cada um
   dentro do próprio contêiner.

## QA executada

Verificação automatizada em navegador real (Chromium), build de **produção**,
nas rotas `/`, `/administracao/usuarios`, `/administracao/perfis` e
`/minha-conta`:

| Largura | Rolagem horizontal | Sidebar | Tabela  | Cartões  |
| ------- | ------------------ | ------- | ------- | -------- |
| 360     | ✅ nenhuma         | gaveta  | oculta  | visíveis |
| 390     | ✅ nenhuma         | gaveta  | oculta  | visíveis |
| 768     | ✅ nenhuma         | fixa    | visível | ocultos  |
| 1024    | ✅ nenhuma         | fixa    | visível | ocultos  |
| 1280    | ✅ nenhuma         | fixa    | visível | ocultos  |
| 1440    | ✅ nenhuma         | fixa    | visível | ocultos  |
| 1920    | ✅ nenhuma         | fixa    | visível | ocultos  |

Também verificado: gaveta abre com a navegação completa, o seletor de unidade
aparece nela, alvos de toque com 44px, Esc fecha, foco entra e volta.

## Um defeito real encontrado aqui

Em 768px a página ganhava barra de rolagem horizontal. A causa não era a tabela:
era um texto `sr-only` dentro das células. Como `sr-only` é
`position: absolute` e nenhum ancestral tinha `position: relative`, o bloco de
contenção virava o viewport — o elemento **escapava do recorte** do contêiner de
rolagem e esticava a largura do documento.

Correção: `relative` no contêiner de rolagem da `Table`. O sintoma aparecia a
140px de distância da causa; sem a verificação automatizada por largura, teria
passado.

## Toque e zoom

Alvos de 44px em telas pequenas (`.touch-target`). `viewport` sem
`maximum-scale`, então o zoom do sistema funciona — bloquear zoom é barreira de
acessibilidade, não refinamento visual.
