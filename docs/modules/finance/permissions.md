# Permissões do Financeiro

Dez chaves, todas sob a feature `finance.core`. A granularidade não é
burocracia: numa loja de três pessoas, quem consulta um título não é
necessariamente quem tem autoridade para estornar um recebimento.

| Chave                        | O que libera                                                                                              |
| ---------------------------- | --------------------------------------------------------------------------------------------------------- |
| `finance.view`               | ver listas, ficha do título, extrato e as seções financeiras na OS, no pedido, no cliente e no fornecedor |
| `finance.receivables.manage` | criar, editar e cancelar contas a receber; gerar a cobrança de uma OS                                     |
| `finance.payables.manage`    | criar, editar e cancelar contas a pagar; gerar a conta de um recebimento de compra                        |
| `finance.receive`            | registrar recebimento                                                                                     |
| `finance.pay`                | registrar pagamento                                                                                       |
| `finance.reverse`            | estornar um lançamento                                                                                    |
| `finance.cash.open`          | abrir o caixa                                                                                             |
| `finance.cash.close`         | fechar o caixa                                                                                            |
| `finance.cash.adjust`        | suprimento e sangria                                                                                      |
| `finance.settings.manage`    | contas financeiras, formas de pagamento e categorias                                                      |

## Por que criar e liquidar são permissões diferentes

Criar um título é **decisão comercial** — quanto cobrar, em quantas vezes, para
quando. Liquidar é **registro de fato** — o dinheiro entrou.

O atendente do balcão recebe e dá baixa o dia inteiro, e não deveria poder
emitir uma cobrança de R$ 5.000. O dono emite a cobrança e raramente opera a
gaveta. Uma permissão só obrigaria a dar as duas para todo mundo.

## Autorização na unidade DO TÍTULO

Sempre — nunca na unidade ativa da sessão.

Quem acessa duas lojas pode abrir um título da loja B enquanto navega na loja A.
A permissão conferida é a daquela unidade, e a conta usada na liquidação precisa
servir aquela unidade.

`authorizeInUnit(context, title.unitId, permission)` é a única porta.

## A interface esconde, o servidor recusa

O que a pessoa não pode fazer **não aparece** — em vez de aparecer desabilitado.
Um botão cinza que ninguém explica gera chamado no suporte.

Esconder é **cortesia**. A recusa de verdade acontece no caso de uso, e os 14
testes de `finance-authorization.test.ts` chamam os serviços diretamente, sem
passar pela tela.

## Por que `finance.*` não está em HIGH_RISK_PERMISSIONS

`HIGH_RISK_PERMISSIONS` é a lista que exige confirmação extra na atribuição de
papel — hoje ela guarda coisas como gestão de usuários e de permissões, cujo
estrago é **irreversível e silencioso**.

As permissões financeiras são de alto impacto, mas de estrago **rastreável**:
todo lançamento tem autor, data, motivo (quando destrutivo) e contrapartida no
razão append-only. Um estorno indevido aparece no extrato. Uma permissão de
administração concedida por engano, não.

A nota está registrada no próprio `permissions.ts` para que a ausência não seja
lida como esquecimento.
