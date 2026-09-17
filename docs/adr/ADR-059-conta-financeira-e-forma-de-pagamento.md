# ADR-059 — Conta financeira, forma de pagamento e categoria são três coisas

**Status:** Aceito
**Data:** Prompt 12 — Financeiro
**Itens atendidos:** 14, 15, 16, 17, 18, 19, 20, 50, 51, 52

## Contexto

O erro mais caro deste módulo, e o mais fácil de cometer, é tratar "PIX" como
uma conta. Ele aparece em sistema de verdade, e o sintoma é sempre o mesmo:
quatro saldos — "Dinheiro", "PIX", "Cartão", "Banco" — e nenhum deles bate com
o extrato bancário, porque o PIX **cai na conta do banco**, não numa conta
chamada PIX.

## Decisão

Três cadastros, três perguntas diferentes:

| Cadastro               | Pergunta                   | Tem saldo? | Exemplo                                  |
| ---------------------- | -------------------------- | ---------- | ---------------------------------------- |
| `financial_accounts`   | **ONDE** o dinheiro fica   | **Sim**    | Caixa da loja, Banco Itaú, Mercado Pago  |
| `payment_methods`      | **COMO** ele se moveu      | Não        | Dinheiro, PIX, Cartão de crédito, Boleto |
| `financial_categories` | **POR QUE** entrou ou saiu | Não        | Venda de serviço, Aluguel, Energia       |

Um recebimento de R$ 300 por PIX é: **conta** = Banco Itaú, **forma** = PIX,
**categoria** = Venda de serviço. O saldo que sobe é o do banco.

## A conta nasce zerada, sempre

Não existe campo "saldo inicial". Saldo não se digita: é a consequência dos
movimentos do razão (ADR-054). Uma conta que nascesse com R$ 800 teria um saldo
que nenhum extrato explica, e a primeira conciliação do mês travaria sem que
ninguém descobrisse o porquê.

Para colocar dinheiro numa conta há o caminho honesto: abrir o caixa com valor
inicial, ou registrar um suprimento — os dois geram movimento no razão.

## O tipo congela quando há movimento

`updateFinancialAccount()` recusa mudar `kind` quando `current_balance != 0`.
Transformar um caixa em conta bancária no meio do mês reinterpretaria
retroativamente todo o extrato.

## Nada se exclui

Uma forma de pagamento usada em 400 liquidações não pode sumir: o extrato de
março viraria uma lista de lançamentos sem forma. Existe apenas **desativar** —
ela some dos formulários novos e continua explicando o passado.

`ACCOUNT_STATUSES` e os `status` de forma e categoria têm dois valores: `active`
e `inactive`. Não há `deleted`.

## Conta compartilhada × conta da unidade

`financial_accounts.unit_id` é **nullable**:

- **com unidade** — serve só aquela loja. É o caso do caixa da gaveta;
- **sem unidade** — compartilhada pela empresa. É a conta bancária da matriz.

`accountServesUnit()` decide, e o serviço de liquidação confere no servidor:
liquidar um título da loja B numa conta exclusiva da loja A é recusado.

## Cartão parcelado é registro, não integração

`financial_settlements.card_installments` guarda o que foi combinado na
maquininha. **O Nexo56 não fala com a adquirente**, não sabe a data do repasse e
não cria recebíveis de cartão. A tela diz isso em voz alta, e há teste de
componente que falha se a palavra "adquirente" sair de lá.

**Não armazenamos** número de cartão, CVV, senha ou token bancário — proibição
do item 109, com teste de componente que varre os `name` dos campos.

## Consequências

**Ganhamos:** saldo por conta que bate com extrato de verdade, e um vocabulário
que o balcão entende sem treinamento.

**Pagamos:** a liquidação pede dois campos em vez de um. São dois cliques que
evitam o saldo impossível de conciliar.
