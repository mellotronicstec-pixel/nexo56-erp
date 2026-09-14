# Modularidade

`operations.purchasing` é **OPTIONAL** e depende de `operations.inventory`.

Assistência que compra no balcão da loja ao lado não registra pedido: dá entrada
manual no estoque e pronto. Para ela, o módulo fica desligado e o sistema
continua inteiro.

## A dependência é de mão única

Compras depende de Estoque porque **receber é dar entrada**: sem catálogo de
peças e sem saldo, um recebimento não teria onde chegar.

Estoque **não** depende de Compras. Desligar Compras não afeta o Estoque em
nada.

## O que acontece com o módulo desligado

| Coisa                                                              | Com Compras desligado                                         |
| ------------------------------------------------------------------ | ------------------------------------------------------------- |
| Itens "Fornecedores" e "Compras" no menu                           | **somem**                                                     |
| Cadastrar fornecedor, abrir pedido, registrar necessidade, receber | recusado com `AuthorizationError`, mesmo para o administrador |
| Fornecedores, pedidos, recebimentos e histórico no banco           | **permanecem**, nada é apagado                                |
| Movimentos de estoque originados por compra                        | continuam no ledger                                           |
| "Compra PC 000037" na ficha da peça                                | **continua legível** — é texto no próprio movimento           |
| Histórico de preços na ficha da peça                               | some (é seção de Compras)                                     |
| Entrada, saída, ajuste, reserva, transferência                     | funcionam normalmente                                         |
| Ordem de Serviço                                                   | inteira; só o atalho "Registrar necessidade" some             |
| Orçamento                                                          | inteiro                                                       |

O teste de integração liga o módulo, faz uma compra completa, desliga o módulo e
verifica cada linha dessa tabela.

## Por que o dado não é apagado

Porque desligar um módulo é uma decisão comercial reversível, e apagar dado não
é. Uma empresa que desliga Compras por três meses e volta atrás precisa
encontrar seus fornecedores onde os deixou.

## Como o menu decide

`NAV_SECTIONS` declara, por item, a feature e a permissão. A visibilidade sai do
Effective Access — nunca de `isAdmin ? tudo : nada`. São **dois** itens de menu
porque são duas permissões: quem cuida do cadastro do distribuidor não é
necessariamente quem autoriza a despesa.
