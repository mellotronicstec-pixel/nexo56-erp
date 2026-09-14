# Integração com Ordem de Serviço e com Orçamento

## Ordem de Serviço

### A regra crítica

**Estoque nunca escreve `service_orders.status`.** Não há, em nenhum arquivo do
módulo, um `update(serviceOrders)` com `status`, nem chamada a
`planTransition` / `applyTransition` / `transitionServiceOrder`.

Isso é verificado por teste de arquitetura (`inventory-boundary.test.ts`), que
percorre todo `src/` e falha se aparecer.

**Nem sequer pelo caminho "certo".** O Prompt 09 usa `planTransition` porque
enviar um orçamento _é_ uma decisão comercial que move o atendimento. Pegar uma
peça na prateleira não é: o técnico pode estar só testando. Deduzir a transição
do consumo faria a OS andar sozinha (item 49).

### O que o estoque escreve na OS

Fatos **resumidos** na linha do tempo (item 69):

| Tipo                        | Quando                                                 |
| --------------------------- | ------------------------------------------------------ |
| `part_reserved`             | peça reservada para a OS                               |
| `part_reservation_released` | reserva liberada                                       |
| `part_consumed`             | peça consumida (saída vinculada ou consumo de reserva) |

A ficha da OS mostra "2 un. de Tela LCD reservadas"; quem quer a movimentação
com custo, localização e ator abre a ficha da peça. Espelhar o ledger inteiro
transformaria o histórico do atendimento num extrato de almoxarifado.

### "Buscar Peça" continua sendo tarefa de workflow

A ação `part_pickup` do Prompt 08 **não** virou movimentação de estoque (item
48). São coisas diferentes: encomendar/buscar a peça é trabalho; dar entrada
dela é estoque.

### Disponibilidade não é instalação

Ter a peça em estoque **não** declara que a peça correta foi instalada (item
49). Quem diz isso é quem conserta, pelo workflow.

## Orçamento

Decisão estrutural:
[ADR-047](../../adr/ADR-047-snapshot-do-orcamento-e-catalogo.md).

### Linha PART manual continua válida para sempre

`quote_items.part_id` é **aditiva e anulável**. Nulo é o estado normal e
permanente de uma linha escrita à mão. Todas as linhas existentes continuam
válidas com vínculo nulo (item 130), e o editor funciona igual quando o módulo
de Estoque está desligado.

### O vínculo é conveniência, não acoplamento

Escolher a peça no editor preenche descrição e valor **no momento da escolha**.
Dali em diante o orçamento guarda os próprios números:

- renomear a peça **não** muda a proposta;
- trocar o código **não** muda a proposta;
- reajustar o preço sugerido **não** muda a proposta.

Verificado em integração: peça renomeada e reprecificada depois de um orçamento
**aprovado**, e o snapshot (descrição, quantidade, valor unitário, total)
permanece idêntico.

### Nenhum movimento por causa de orçamento

Salvar, enviar e aprovar **não** movimentam e **não** consomem estoque. O teste
conta movimentações e reservas antes e depois do ciclo completo e exige que os
números não mudem.

Depois da aprovação, **reservar continua sendo um ato explícito**.

### Direção da dependência

```
quotes/infrastructure/schema.ts ──FK──► inventory (parts)
quotes/application/*            ──✗──► inventory      (proibido, testado)
inventory/*                     ──✗──► quotes         (proibido, testado)
```

A feature `core.quotes` **não** depende de `operations.inventory`. O grafo
continua acíclico (item 85).
