# Central — read model e prioridade

## `WorkCenterItem`

Projeção, **não entidade**. Nada disto é gravado.

| Campo                                | Origem                                            |
| ------------------------------------ | ------------------------------------------------- |
| `serviceOrderId`, `number`, `status` | `service_orders`                                  |
| `unitId`, `unitName`                 | `units`                                           |
| `customerName`                       | `customers`                                       |
| `equipmentSummary`                   | `equipmentTitle()` do Prompt 06                   |
| `assigneeId`, `assigneeName`         | `service_orders.assigned_technician_id` + `users` |
| `followUpAt`                         | `service_orders.follow_up_at`                     |
| `openTaskCount`                      | `service_order_tasks` abertas, agregadas          |
| `classification`                     | `service_orders.classification`                   |
| `flags`, `urgency`                   | **derivados na leitura**                          |

## A precedência da ordenação

Declarada, determinística, sem score e sem ponto flutuante:

1. **Urgência temporal** — acompanhamento atrasado (0) → tarefa atrasada (1) →
   acompanhar hoje (2) → nada (3).
2. **Data de referência** — a mais antiga primeiro; sem data vai para o fim.
3. **Número da OS** — chave estável, ordem total entre páginas.

O rank é **posição**, não peso: zero vem primeiro.

"Sem responsável" **não participa** da precedência. É badge e filtro.

## A mesma regra, dois lugares

O `ORDER BY` do SQL e `compareWorkCenterItems` implementam a mesma precedência.
São dois porque:

- o SQL precisa ordenar **antes** de paginar, senão a página 2 traria itens que
  deveriam estar na 1;
- a função pura permite testar a regra exaustivamente sem banco.

Um teste de integração prova que as duas ordens coincidem.

## Contagens

Duas consultas agregadas para o bloco inteiro do topo — não uma por cartão:

- filas: `GROUP BY status`
- atenção: quatro `SUM(condição)` na mesma varredura

**Cartão e lista usam a mesma condição base**, num único lugar do código. Se um
dissesse 8 e o outro mostrasse 5, a Central perderia a única coisa que promete.
