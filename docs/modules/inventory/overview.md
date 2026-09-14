# Estoque e Peças — visão geral

**Prompt 10.** Feature: `operations.inventory` (OPTIONAL).

## O que este módulo resolve

Uma assistência técnica precisa saber três coisas sobre uma peça, e elas são
diferentes entre si:

- **o que a peça é** — nome, código, fabricante, referência. Vale para a
  empresa inteira;
- **quanto existe** — e isso tem lugar: a loja do centro tem 4, a do bairro tem
  zero;
- **o que aconteceu** — quando entrou, quanto custou, quem levou, para qual
  Ordem de Serviço.

## As seis separações que o módulo existe para manter

| Conceito                    | É                                | Não é        |
| --------------------------- | -------------------------------- | ------------ |
| **Peça**                    | o que a coisa é                  | quantidade   |
| **Localização**             | posição física dentro da unidade | a unidade    |
| **Saldo**                   | quanto existe naquela unidade    | histórico    |
| **Movimentação**            | o que aconteceu, append-only     | saldo        |
| **Reserva**                 | compromisso com uma OS           | saída física |
| **Linha PART do orçamento** | o que foi proposto ao cliente    | consumo      |

Colapsar qualquer par disso numa tabela `products` com um campo `quantity` é
como o erro começa: no dia em que duas unidades têm a mesma peça, ou em que
alguém pergunta "por que o saldo mudou ontem à noite?", a resposta deixa de
existir.

## Modelo de dados

| Tabela               | Ownership                             | Guarda                                                               |
| -------------------- | ------------------------------------- | -------------------------------------------------------------------- |
| `parts`              | **TENANT**                            | catálogo: identificação, unidade de medida, preço sugerido, situação |
| `stock_locations`    | **UNIDADE**                           | prateleira, gaveta, bancada — nome que a loja escolheu               |
| `stock_balances`     | **UNIDADE**                           | `on_hand`, `reserved`, `minimum_quantity`, `average_cost`            |
| `stock_movements`    | **UNIDADE**                           | ledger append-only, quantidade com sinal, saldo resultante           |
| `stock_reservations` | **UNIDADE**                           | compromisso com uma OS: reservado, consumido, liberado               |
| `stock_transfers`    | **TENANT** (origem e destino UNIDADE) | identidade da transferência, número humano                           |

A peça é do tenant porque o catálogo é um **vocabulário da empresa**: cadastrar
"Tela LCD iPhone 11" três vezes, uma por loja, criaria três peças que o
relatório não soma e que a busca mostra em duplicata. O saldo é da unidade
porque quantidade tem lugar.

## Fronteiras que este módulo não atravessa

- **Estoque nunca escreve `service_orders.status`.** Consumir peça não move a
  Ordem de Serviço; quem decide que o conserto começou é quem conserta, pelo
  painel de workflow do Prompt 08. Garantido por teste de arquitetura.
- **Salvar, enviar ou aprovar orçamento não movimenta nem consome estoque.**
  Reservar e consumir são ações explícitas de uma pessoa com permissão.
- **Peça sem saldo não vira pedido de compra.** Fornecedores e Compras são o
  Prompt 11; aqui existe apenas o evento que eles vão consumir.

## Documentos deste módulo

| Arquivo                            | Assunto                                                            |
| ---------------------------------- | ------------------------------------------------------------------ |
| [catalog.md](catalog.md)           | catálogo, identificação, códigos, unidades de medida, localizações |
| [ledger.md](ledger.md)             | movimentações, saldos, ajustes, custo, estoque mínimo              |
| [concurrency.md](concurrency.md)   | concorrência e idempotência                                        |
| [reservations.md](reservations.md) | reservas e transferências                                          |
| [integrations.md](integrations.md) | integração com Ordem de Serviço e com Orçamento                    |
| [permissions.md](permissions.md)   | permissões e escopo                                                |
| [modularity.md](modularity.md)     | classificação, desativação e as 12 perguntas                       |
| [security.md](security.md)         | isolamento, integridade do ledger, auditoria                       |
| [future.md](future.md)             | o que Compras e a Nexo56 AI vão encontrar pronto                   |
