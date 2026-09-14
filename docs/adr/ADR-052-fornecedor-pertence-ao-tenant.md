# ADR-052 — Fornecedor pertence à empresa; o pedido pertence à unidade

**Status:** Aceito
**Data:** Prompt 11 — Fornecedores e Compras
**Itens atendidos:** 3.1, 3.2, 4, 5, 6, 47, 79

## Contexto

O Prompt 11 trouxe duas entidades novas com donos diferentes, e confundir os
dois donos estragaria as duas.

## Decisão

**`suppliers` é do TENANT. `purchase_orders`, `purchase_needs`,
`purchase_receipts` e `purchase_price_history` são da UNIDADE.**

O fornecedor é do tenant porque **a empresa negocia com o distribuidor**, não a
loja. Duplicar o cadastro por unidade criaria três fornecedores que nenhum
relatório soma e que a busca mostra em triplicata. A tabela `suppliers`
**não tem coluna `unit_id`**, e o teste de integração verifica isso lendo o
`information_schema`.

O pedido é da unidade porque **a mercadoria chega em um endereço**. Pedido sem
destino não existe: alguém precisa receber a caixa, e o saldo sobe naquela
loja e só naquela.

## Consequências operacionais

- **A permissão de receber é verificada na unidade DO PEDIDO**, e não na unidade
  ativa da sessão (item 47). Quem recebe cria saldo naquela unidade; autorizar
  pela unidade ativa deixaria alguém dar entrada numa loja em que não opera.
- A ficha do fornecedor lista **apenas os pedidos das unidades que a pessoa
  opera**: o fornecedor é da empresa, mas o pedido tem dono.
- A numeração do pedido (`PC 000037`) é **por tenant**, sobre
  `tenant_sequences` (ADR-034): duas empresas começam do 1, e dentro da mesma
  empresa não há buraco nem repetição, nem com cinco pedidos nascendo ao mesmo
  tempo.

## Documento é opcional, mas validado

`SUPPLIER_DOCUMENT_REQUIRED = false`. O balcão compra parafuso da loja da
esquina, e exigir CNPJ faria alguém inventar um — o que é pior do que não ter.

Quando informado, o documento é **validado de verdade** (dígitos, não máscara) e
é **único por empresa**, com a UNIQUE `(tenant_id, document_digits)`. A
validação é a mesma de Clientes, que subiu para `src/core/document/` quando
Compras precisou dela — fornecedor **não é** cliente, mas CPF e CNPJ são os
mesmos em qualquer contexto.
