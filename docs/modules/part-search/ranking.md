# Ranking

Comparador **puro e lexicográfico** (`domain/ranking.ts`) — nenhuma nota
numérica opaca. A ordenação É, literalmente, a prioridade oficial:

```
1. classe de compatibilidade      (Confirmada < ... < Incompativel)
2. exatidao                       (tem exact_part_number/exact_model?)
3. confiabilidade de identificacao (quantas categorias de evidencia
                                    nao-IA distintas apoiam o resultado)
4. disponibilidade                (em estoque < disponivel < desconhecida < indisponivel)
5. prazo de entrega                (conhecido, menor primeiro; desconhecido por ultimo)
6. custo total                     (preco+frete quando ambos conhecidos; senao desconhecido)
7. preco                           (menor primeiro; desconhecido por ultimo)
8. desempate deterministico final  (id do candidate)
```

Cada critério só desempata o anterior — **preço nunca é sequer olhado**
se a compatibilidade já decidiu.

## Prova numérica (fixtures, `tests/unit/part-search-ranking.test.ts`)

| #   | Cenário                                                   | Resultado                                                                      |
| --- | --------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 1   | Peça A R$50 Não Verificada vs. Peça B R$120 Confirmada    | B primeiro (teste literal do item 46)                                          |
| 2   | Confirmada cara vs. Não Verificada barata                 | Confirmada primeiro                                                            |
| 3   | Alta Probabilidade disponível vs. Confirmada indisponível | Confirmada primeiro (compatibilidade > disponibilidade)                        |
| 4   | Mesma compatibilidade, uma com `exact_part_number`        | A com código exato primeiro                                                    |
| 5   | Mesma exatidão, mais categorias de evidência              | A com mais evidência primeiro                                                  |
| 6   | Mesma confiabilidade, disponibilidade diferente           | Em estoque primeiro                                                            |
| 7   | Mesma disponibilidade, prazo diferente                    | Menor prazo primeiro; desconhecido por último                                  |
| 8   | Mesmo prazo, custo total diferente                        | Menor custo total primeiro                                                     |
| 9   | Custo total desconhecido vs. conhecido pior               | O **conhecido** vence — dado faltante nunca é "melhor valor" (item 179)        |
| 10  | Tudo igual até preço                                      | Menor preço primeiro; desconhecido por último; desempate final por id, estável |

## Disponibilidade: como o estoque interno é considerado

`in_stock` (saldo > 0 na unidade) < `available` (fonte externa confirmou)
< `unknown` (nada informado) < `unavailable`. O estoque interno só ganha
vantagem nesta camada — nunca sobrepõe uma classe de compatibilidade
melhor de outro candidate (item 181).

## Custo total

Só existe quando preço **e** frete são ambos conhecidos
(`computeTotalCostCents`). Frete desconhecido nunca vira zero; "frete
grátis" só quando a fonte declarou explicitamente (item 184) — o chamador
passaria `freightCents = 0n`, nunca `null` interpretado como grátis.

## Estabilidade

`Array.prototype.sort` (V8) já é estável, e o desempate final por `id`
garante ordem determinística mesmo quando todos os critérios anteriores
empatam — duas chamadas com a mesma entrada sempre produzem a mesma
ordem (item 180).
