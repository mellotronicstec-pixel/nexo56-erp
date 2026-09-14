# O que ficou preparado, e o que ficou de fora

## Preparado, sem implementar

### Contas a Pagar (Prompt 12)

O recebimento emite `PURCHASE_RECEIPT_CREATED`. **Esse evento não tem
consumidor.** Não há tabela financeira no banco, nenhum título nasce, nenhum
pagamento é registrado.

O que um Financeiro futuro encontrará pronto:

- o identificador do recebimento, do pedido, do fornecedor e da unidade no
  payload do evento;
- número e data do documento fiscal em `purchase_receipts`;
- valor total do pedido congelado em `purchase_orders.total`;
- condições comerciais em `suppliers.commercial_terms`;
- contato de papel `financial` em `supplier_contacts`.

O que ele terá de decidir e **não está decidido aqui**: se o título nasce do
pedido ou do recebimento, como tratar recebimento parcial, como tratar
cancelamento depois de recebido, e o que fazer quando a nota não bate com o
pedido.

### Prazo de entrega real

`purchase_price_history.observed_lead_time_days` já grava a diferença entre
`placed_at` e a chegada. Ninguém ainda **compara** isso com
`suppliers.lead_time_days`; o dado está sendo acumulado para quando alguém
quiser.

### Custo por fornecedor

`supplier_parts` acumula `last_unit_cost` e `last_purchased_at`. É conveniência
de tela. Uma comparação real de fornecedores sai do histórico, não daqui.

## Deliberadamente fora

| Coisa                                                 | Por quê                                                                                                                                                    |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Envio de pedido ao fornecedor (e-mail, WhatsApp, EDI) | O Nexo56 registra o que já foi combinado. Enviar é outro problema, com outro conjunto de falhas.                                                           |
| Rateio de frete no custo da peça                      | Mudaria o custo médio do estoque de um jeito que ninguém no balcão consegue explicar ([ADR-051](../../adr/ADR-051-custo-comercial-e-custo-de-estoque.md)). |
| Necessidade criada automaticamente por estoque baixo  | Um mínimo mal configurado viraria dezenas de linhas que ninguém pediu. A tela **sugere**; a pessoa decide.                                                 |
| Reserva automática depois da compra                   | Receber dá entrada. Reservar é decisão de quem atende a OS.                                                                                                |
| Devolução ao fornecedor como entidade própria         | Hoje é saída de estoque com motivo. Vira entidade quando houver crédito com o fornecedor a controlar.                                                      |
| Cotação / comparação de propostas                     | Precisa de fornecedor, peça e histórico maduros primeiro — e agora eles existem.                                                                           |
| Aprovação por alçada (valor máximo por perfil)        | `purchases.approve` é binária. Alçada por valor exige política configurável, que é um módulo próprio.                                                      |
| Multi-moeda                                           | Toda a aritmética é `DECIMAL(14,2)` em reais.                                                                                                              |
