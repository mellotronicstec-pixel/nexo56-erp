# ADR-014 — Representação monetária

**Status:** Aceito · **Data:** Prompt 02

## Contexto

`0.1 + 0.2 === 0.30000000000000004`. Em ERP isso vira centavo errado em
orçamento, pagamento e fechamento — e erro monetário destrói confiança de forma
desproporcional ao tamanho do bug.

## Decisão

**No banco:**

| Uso                                          | Tipo                              |
| -------------------------------------------- | --------------------------------- |
| Valor final (preço, pagamento, total)        | `DECIMAL(14,2)`                   |
| Valor intermediário (custo unitário, rateio) | `DECIMAL(14,4)`                   |
| Quantidade                                   | `DECIMAL(14,4)`                   |
| Moeda                                        | `CHAR(3)` ISO 4217, `BRL` inicial |

Nunca `FLOAT`/`DOUBLE`.

**No código:** classe `Money` (`src/core/money`), com representação interna em
**centavos inteiros (`bigint`)**. O `DECIMAL` chega do driver como string e é
convertido sem passar por `number`; volta para string ao gravar.

Arredondamento **half-up** (2,345 → 2,35), a convenção comercial brasileira,
aplicado uma única vez no valor final.

`toString()` devolve valor técnico (`"1234.56"`), sem `R$` e sem separador de
milhar. Formatação pertence à apresentação.

## Motivo

- `DECIMAL(14,2)` cobre até 999.999.999.999,99 — folgado para o domínio, e
  exato por construção.
- `DECIMAL(14,4)` para intermediários evita que arredondar cedo demais acumule
  erro em cálculos como `quantidade × custo unitário`.
- **Quantidade não é dinheiro**: é decimal porque estoque pode ser fracionário
  (metros de cabo, gramas de pasta térmica). Inteiro universal travaria isso.
- `bigint` em centavos elimina ponto flutuante do ciclo inteiro e suporta
  valores acima do limite seguro de inteiro do JavaScript.
- `Money.parse` aceita string e **rejeita** `number` justamente para impedir que
  um float impreciso entre disfarçado.

## Alternativas consideradas

| Alternativa                             | Por que não                                                                                                         |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `number` com arredondamento             | É exatamente o bug que se quer evitar                                                                               |
| Biblioteca decimal (decimal.js, big.js) | Dependência a mais para o que 150 linhas resolvem com `bigint` nativo; pode ser adotada depois sem mudar o contrato |
| Inteiro de centavos sem classe          | Perde a checagem de moeda e espalha aritmética crua pelo domínio                                                    |
| Guardar sempre em `DECIMAL(14,4)`       | Induz a exibir valor com 4 casas e confunde valor final com intermediário                                           |

## Consequências

- Toda leitura de coluna monetária passa por `Money.parse`. `parseFloat` em
  coluna monetária é defeito de revisão.
- Operar moedas diferentes lança erro em vez de somar errado.
- Multi-moeda não está implementada, mas a coluna `currency` e a checagem já
  existem — habilitar depois não exige migração de dados.
