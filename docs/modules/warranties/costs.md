# Custos de garantia

Conserto em garantia válida é **gratuito para o cliente por definição**. Não é
gratuito para a loja: a peça saiu do estoque, o técnico gastou horas, o
laboratório terceirizado cobrou.

`warranty_costs` mede esse gasto — e **nada mais**.

## O que ele não faz

Não cria título. Não cria movimento no razão. Não cria cobrança. O módulo de
Garantias **não escreve** em `financial_titles`, `financial_movements` nem em
nenhuma tabela do Financeiro, e isso é verificado por teste de fronteira.

Ver [ADR-071](../../adr/ADR-071-custo-de-garantia-nao-toca-o-financeiro.md).

## Por que não gerar título a receber

Porque criar cobrança sobre garantia válida é cobrar exatamente quem tem direito
a não pagar. Bastaria um retorno mal avaliado para a loja emitir cobrança
indevida — e o constrangimento seria descoberto no balcão.

## Por que não gerar título a pagar

Porque a despesa real já nasce onde acontece: peça consumida é movimento de
Estoque; compra do fornecedor é conta a pagar (ADR-058). Um título aqui contaria
o mesmo gasto duas vezes.

## Campos

| Coluna               | Nota                                              |
| -------------------- | ------------------------------------------------- |
| `kind`               | `labor`, `part`, `outsourced`, `freight`, `other` |
| `description`        | até 200 caracteres                                |
| `amount`             | decimal, `CHECK (amount >= 0)`                    |
| `warranty_return_id` | opcional — liga o custo ao atendimento            |
| `service_order_id`   | opcional                                          |

## Permissão separada de propósito

`warranties.costs.view` e `warranties.costs.manage` são distintas de
`warranties.view`.

O atendente precisa saber se a cobertura vale; ele **não** precisa saber a
margem da loja. `listWarrantyCosts` autoriza por conta própria — a ficha só
consulta quando a pessoa tem a chave, para que a página inteira não quebre para
quem não tem.

## Soma

`sumWarrantyCosts(context, period)` soma **no banco**, com
`COALESCE(SUM(...), 0)` — nunca em JavaScript sobre uma página de resultados.
