# ADR-071 — Custo de garantia mede gasto; não gera lançamento

**Status:** Aceito
**Data:** Prompt 13 — Garantias
**Itens atendidos:** 45, 46, 47, 48, 70, 90, 104

## Contexto

Conserto em garantia válida é **gratuito para o cliente por definição**. Mas não
é gratuito para a loja: a peça saiu do estoque, o técnico gastou duas horas, o
laboratório terceirizado cobrou.

A loja precisa saber quanto isso custou. A tentação é registrar esse custo como
um título financeiro — afinal, "é dinheiro". Seria um erro em duas frentes.

## Decisão

**`warranty_costs` é um registro de medição interna. Ele não cria título, não
cria movimento no razão e não cria cobrança.**

O módulo de Garantias **não escreve** em `financial_titles`,
`financial_movements` nem em nenhuma tabela do Financeiro. Nenhum caminho de
código o permite, e isso é verificado por teste de fronteira.

## Por que não gerar título a receber

Porque criar cobrança sobre garantia válida é cobrar **exatamente quem tem
direito a não pagar**. Bastaria um retorno mal avaliado para a loja emitir uma
cobrança indevida a um cliente que voltou com razão — e o constrangimento seria
descoberto no balcão, não no relatório.

## Por que não gerar título a pagar

Porque a despesa real já nasce onde ela acontece: a peça consumida é movimento
de Estoque; a compra do fornecedor é conta a pagar do módulo de Compras
(ADR-058). Um título duplicado aqui contaria o mesmo gasto duas vezes.

## Permissão separada de propósito

`warranties.costs.view` e `warranties.costs.manage` são distintas de
`warranties.view`. O atendente precisa saber se a cobertura vale; ele **não**
precisa saber a margem da loja. A ficha da garantia carrega os custos apenas
para quem tem a chave, e a consulta recusa por conta própria — a tela esconder é
conveniência.

## O que fica preparado, e não implementado

O somatório por período (`sumWarrantyCosts`) existe e roda **no banco**, não em
JavaScript. Ele sustenta uma visão futura de custo de garantia por período. Não
há DRE, não há "margem", não há indicador de qualidade — números com nome errado
são piores que número nenhum.

## Consequências

**Ganhamos:** a loja mede o que a garantia custa sem que um único centavo
apareça no extrato como se tivesse entrado ou saído.

**Pagamos:** o custo de garantia não aparece automaticamente em nenhum relatório
financeiro. É deliberado: quando aparecer, será por uma decisão explícita de um
prompt futuro, com a definição escrita antes do número.
