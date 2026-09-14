# Segurança

## Isolamento por empresa (TENANT)

Toda tabela de Compras tem `tenant_id`, e a proteção é **de banco**, não de
consulta:

- UNIQUE composta `(id, tenant_id)` em `suppliers` e `purchase_orders`;
- FKs compostas que carregam `tenant_id` no relacionamento — uma linha de pedido
  não consegue apontar para uma peça de outra empresa nem que a aplicação tente;
- `purchase_receipt_items.stock_movement_id` → `stock_movements(id, tenant_id)`.

Um filtro de tela não é isolamento. Aqui o banco recusa.

**O que os testes provam:** pedido de outra empresa devolve `NotFoundError` ao
carregar, `null` na ficha, e recusa no recebimento; peça de outra empresa não
entra em pedido; fornecedor de outra empresa não pode ser renomeado por id; a
numeração é independente entre empresas.

## Isolamento por unidade

`purchase_orders`, `purchase_needs`, `purchase_receipts` e
`purchase_price_history` têm `unit_id`, com UNIQUE `(id, unit_id)` e FKs
compostas onde o vínculo precisa ser da mesma unidade — em especial
`(service_order_id, unit_id)` na necessidade.

A verificação de acesso usa `context.authorizedUnitIds`, e a permissão de
receber é conferida **na unidade do pedido** (item 47).

**O que os testes provam:** quem só enxerga a unidade Norte não carrega nem
recebe pedido da principal; a entrada acontece na unidade do pedido mesmo quando
a sessão está com outra unidade ativa; papel concedido só na unidade Norte não
autoriza receber na principal.

## Não encontrado, e não "sem permissão"

Quem não alcança a unidade recebe `NotFoundError`. A diferença importa: "sem
permissão" confirmaria que o registro existe.

## Dado pessoal

`supplier_contacts` guarda **pessoas físicas** (nome, telefone, e-mail do
vendedor) dentro de um cadastro de empresa. Vale a mesma política de Clientes:

- os **payloads de evento não carregam dado pessoal** — só chaves técnicas.
  `SUPPLIER_CREATED` leva `supplierId` e `kind`, e nada mais;
- a auditoria grava `name` no `after` do cadastro, que é o mínimo para alguém
  entender o que mudou;
- o log estruturado não recebe nome, telefone nem e-mail.

## Rastreabilidade

Cada passo grava auditoria **dentro da transação** do fato, e cada pedido tem
`purchase_order_timeline` — a história do pedido, em português, para quem abrir
daqui a seis meses.

`purchase_price_history` é **append-only**: nenhum arquivo executa `UPDATE` ou
`DELETE` nela, e o teste de fronteira falha se algum passar a executar.

## O que o módulo não faz, por decisão

- **Não envia mensagem externa.** Nenhum `fetch`, SMTP, WhatsApp ou webhook.
  O teste de fronteira falha se alguma biblioteca de mensageria aparecer no
  módulo.
- **Não implementa IA.** Nenhuma sugestão automática de fornecedor, preço ou
  quantidade.
- **Não cria automação genérica.** Nada dispara compra a partir de evento.
