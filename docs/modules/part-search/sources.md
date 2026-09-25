# Fontes de Busca

| Fonte                                                                         | Tipo                      | Interno/Externo | Dados retornados                                                                              | Preço atual?                                         | Disponibilidade?                         | Compatibilidade?                                                                                  | Produção disponível?                                                 |
| ----------------------------------------------------------------------------- | ------------------------- | --------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Catálogo (`parts`)                                                            | Estrutural, tenant-wide   | Interno         | título, código, part number, marca                                                            | Sim (`suggestedPrice`, quando cadastrado)            | Via saldo de estoque da unidade          | Só se o código bater exatamente com o termo/OS (`exact_part_number`) — nunca inventada            | Sim, sempre                                                          |
| Saldo de estoque (`stock_balances`, via `loadBalance`)                        | Estrutural, por unidade   | Interno         | onHand > 0 ⇒ "em estoque"                                                                     | — (preço vem do catálogo)                            | Sim, real, por unidade autorizada        | —                                                                                                 | Sim, sempre                                                          |
| Histórico de compra (`purchase_price_history`, via `listPriceHistoryForPart`) | Histórico, append-only    | Interno         | fornecedor, quantidade, custo unitário, prazo observado                                       | **Não** — sempre rotulado "Última compra registrada" | Nunca inferida de um histórico           | —                                                                                                 | Sim, sempre                                                          |
| `PartSearchProvider` (externo)                                                | Estruturado, por contrato | Externo         | título, part number, fabricante, preço, disponibilidade, prazo, URL, sinal de compatibilidade | Sim, quando a fonte informa (sempre temporal)        | Só quando a fonte informa explicitamente | Só como sinal (`provider_exact_fit_signal`/`explicit_incompatibility`) — nunca autoridade sozinho | **Não nesta V1** — nenhum provedor real decidido; ver `providers.md` |

## Internal: por que não existe "mapeamento peça↔modelo" hoje

O Estoque (Prompt 10) não guarda uma relação "esta peça serve para este
modelo de equipamento" — só nome, marca, código e part number. Por isso a
única evidência honesta que a busca interna pode gerar é
`exact_part_number` (o código bate, caractere a caractere, com o termo
digitado ou com o código da OS). Qualquer coisa além disso seria uma
inferência inventada por coincidência de nome — item 114 proíbe
explicitamente. Uma peça interna sem código batendo fica **Não
Verificada**, honestamente, não um erro.

## Deduplicação

Um `part_id` só gera UM candidate por sessão; ofertas do estoque e do
histórico de compra do mesmo `part_id` são anexadas ao MESMO candidate
(a peça é a mesma identidade técnica, só a condição comercial muda).
Candidatos externos deduplicam por part number normalizado quando existe;
sem part number, por título+fabricante normalizados — nunca só pelo
título (item 54/55/56).
