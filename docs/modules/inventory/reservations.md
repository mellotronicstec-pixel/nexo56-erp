# Reservas e transferências

Decisões estruturais:
[ADR-045](../../adr/ADR-045-reserva-e-entidade-propria.md) ·
[ADR-046](../../adr/ADR-046-transferencia-imediata.md).

## Reserva é compromisso, não saída

Reservar **não tira nada da prateleira**. Ela responde "esta peça já tem dono",
e o dono é sempre uma Ordem de Serviço da **mesma unidade**.

| Coluna              | Papel                                                 |
| ------------------- | ----------------------------------------------------- |
| `quantity`          | total reservado ao longo da vida da reserva           |
| `consumed_quantity` | quanto virou consumo físico                           |
| `released_quantity` | quanto voltou ao disponível sem ser usado             |
| `status`            | `open` enquanto sobra algo; `closed` quando não sobra |

`remaining = quantity − consumed − released`. A situação **deriva do que
sobrou**, não de qual botão foi clicado: uma reserva de 3 com 1 consumida e 2
liberadas está encerrada pelos dois caminhos.

## Cross-unit é impossível

A FK composta `(service_order_id, unit_id) → service_orders(id, unit_id)` torna
"a OS da unidade A não reserva a prateleira da unidade B" um fato do banco, não
uma promessa da aplicação. A aplicação também verifica, para a pessoa receber
uma frase em português em vez de um erro de constraint.

Para usar peça de outra unidade existe **transferência**, que é processo
explícito.

## Não há reserva automática

Aprovar orçamento **não** reserva (itens 36 a 38). Aprovar três orçamentos do
mesmo modelo de tela esvaziaria o disponível sem ninguém ter pegado nada, e o
quarto cliente ouviria "não temos" com a peça na prateleira.

Um orçamento aprovado com linha PART vinculada a uma peça real **habilita o
botão**. Quem reserva é uma pessoa, com `inventory.reserve`.

## Consumir é uma instrução só

```sql
UPDATE stock_balances
SET on_hand = on_hand - :q, reserved = reserved - :q
WHERE … AND reserved >= :q AND on_hand >= :q;
```

Liberar-e-retirar seriam duas operações, e entre elas a peça volta ao
disponível: outra pessoa pode levá-la, e o consumo legítimo falha com o estoque
"certo" na tela.

O consumo gera movimento `issue` com `reservation_id` e `service_order_id`, e um
fato resumido na linha do tempo da OS. **Não muda a situação da OS.**

## Ciclo completo (item 142), verificado em E2E

```
entrada 5   → on_hand 5   reserved 0   available 5
reservar 2  → on_hand 5   reserved 2   available 3
consumir 1  → on_hand 4   reserved 1   available 3
liberar 1   → on_hand 4   reserved 0   available 4
```

## Transferência

- **Identidade própria** (`stock_transfers`) com número humano `TRF 000012`,
  alocado pela sequência do tenant (`stock_transfer`).
- As **duas movimentações** apontam para o mesmo `transfer_id`. Sem essa linha,
  seriam uma saída e uma entrada que ninguém correlaciona depois.
- **Imediata**: retira da origem e adiciona ao destino na mesma transação.
- O destino recebe pelo **custo médio da origem**.
- Ordem fixa (saída da origem primeiro) evita o abraço mortal entre A→B e B→A
  simultâneos.

### Limitação declarada (item 53)

**Não há estado `in_transit`.** O sistema não acompanha o transporte — não há
conferência no destino nem romaneio. Um `in_transit` que ninguém fecha produz
saldo parado em trânsito para sempre.

A coluna `status` existe e hoje vale sempre `completed`; acrescentar
`in_transit` será aditivo. A própria tela diz ao operador que o sistema não
acompanha o transporte.

### Cross-tenant

Proibido, e não por checagem da aplicação: as FKs compostas
`(from_unit_id, tenant_id)` e `(to_unit_id, tenant_id)` amarram as duas pontas
ao mesmo tenant. O teste tenta o `INSERT` direto no banco e prova a recusa.
