# ADR-075 — O follow-up histórico permanece onde está; o texto oficial é corrigido

**Status:** Aceito
**Data:** Prompt 14 — Agenda e Tarefas
**Itens atendidos:** 17, 20, 63, 68, 145, 156

## Contexto: uma premissa do prompt não correspondia ao código

O Prompt 14 assumia a existência de uma tabela `service_order_follow_ups`, com
instruções de backfill e migração a partir dela.

**Essa tabela nunca existiu.** A inspeção do código mostrou que o mecanismo
histórico real, entregue pelo Prompt 08, é:

- `service_orders.follow_up_at` — data civil do próximo ponto de atenção;
- `service_orders.follow_up_alerted_for` — a data já alertada, que é o que
  torna a varredura idempotente;
- `sweepOverdueFollowUps`, que emite `SERVICE_ORDER_FOLLOW_UP_OVERDUE`;
- as regras `+2 dias` na criação e `+3 dias` na entrada em Aguardando Conserto.

## Decisão 1: não criar a tabela que o prompt supunha

Nenhuma tabela `service_order_follow_ups` foi criada. Não há backfill, porque
**não há o que migrar**: nenhuma linha muda de lugar.

Criar a tabela para satisfazer o texto do prompt produziria um esquema vazio,
um backfill fictício e duas fontes de verdade sobre a mesma data.

## Decisão 2: o follow-up não vira Task

Converter `follow_up_at` em linha de `agenda_tasks` faria a varredura — que é
**CORE** e é o que hoje impede a OS parada de sumir — passar a depender de um
módulo **OPCIONAL**. Desligar `operations.agenda` apagaria a rede de segurança
que a empresa já tem.

Além disso, Task ≠ Follow-up conceitualmente, e o próprio Prompt 14 exige essa
separação. O follow-up é um **atributo da OS**: o próximo momento em que
alguém precisa olhar para ela. Não tem responsável próprio, não se conclui —
ele é **reagendado** ou some quando a OS anda.

A Agenda projeta o follow-up no read model como item do tipo `follow_up`,
lendo direto da coluna. **Nenhuma Task espelho é criada** — o que evita, de
uma vez, a duplicidade visual e a duplicidade de verdade.

As regras temporais do Prompt 08 ficam exatamente como estavam:

| Evento                         | `follow_up_at` |
| ------------------------------ | -------------- |
| OS criada                      | hoje + 2 dias  |
| Entrada em Aguardando Conserto | hoje + 3 dias  |

## Decisão 3: o texto oficial da preparação é o acentuado

O Prompt 08 gravou:

> Realizar limpeza final, conferencia estetica e preparacao do equipamento para entrega ao cliente.

A especificação — Constituição do Nexo56 e Prompt 14 — sempre definiu:

> Realizar limpeza final, conferência estética e preparação do equipamento para entrega ao cliente.

A versão sem acentos foi **empobrecimento acidental**, não decisão. O fato de
já estar no código não a promove a especificação. A partir daqui, o texto
oficial é o acentuado, e `DELIVERY_PREPARATION_TASK_DESCRIPTION` é a exceção
deliberada à convenção de escrever sem acentos no código: ela não é comentário
nem rótulo montado ali, é texto normativo que aparece na bancada do técnico.

### Por que corrigir o texto é seguro

**Porque a identidade da tarefa sistêmica nunca dependeu dele.**

`createWorkflowTask` decide se a tarefa já existe por
`(tenant_id, service_order_id, kind, status = 'open')`, e o banco sela isso com
`UNIQUE uq_so_task_open (service_order_id, kind, open_marker)`. Título e
descrição não participam de nenhuma comparação, em nenhum ponto do código.

Logo: trocar a redação não cria segunda tarefa, não reabre tarefa concluída,
não quebra `open_marker` e não altera `service_orders.status`.

### O backfill: recortado por estrutura, travado por texto

A migration 0013 corrige as linhas antigas com:

```sql
UPDATE service_order_tasks
   SET description = '<texto oficial>'
 WHERE kind = 'delivery_preparation'
   AND description = '<redação antiga>';
```

A **identificação** é `kind` — e `delivery_preparation` só é escrito pela
máquina de estados, nunca por uma pessoa. A comparação com a redação antiga
**não é** a identificação: é uma trava adicional, para que uma descrição que
alguém tenha editado à mão continue como ela a deixou.

Linhas concluídas e canceladas também são corrigidas, de propósito: o
histórico deve mostrar o texto certo do trabalho que foi feito.

O que o backfill **não** faz: não insere linha, não apaga linha, não toca em
`status`, `open_marker`, `completed_at`, `completed_by` nem em qualquer coluna
de `service_orders`.

### Cenário de upgrade coberto por teste

Um banco do Prompt 13.1 com OS aberta (`follow_up_at` + `follow_up_alerted_for`
preenchidos), tarefa de preparação aberta na forma legada, tarefa de preparação
concluída na forma legada, tarefa de preparação editada à mão e uma tarefa
`part_pickup`, ao subir para o Prompt 14:

- as duas legadas passam a ter o texto oficial, **mesmos ids, mesmo status,
  mesmo `open_marker`**;
- a editada à mão fica como estava;
- `part_pickup` fica como estava;
- continua havendo **uma** tarefa aberta de preparação por OS;
- `follow_up_at`, `follow_up_alerted_for`, `status` e `version` das OS não
  mudam;
- `agenda_tasks` nasce **vazia** — nada foi espelhado.

O fluxo, por sua vez, **respeita a linha legada que encontrar aberta**: ele não
reescreve texto de linha existente. Quem corrige redação antiga é a migration,
uma vez; o fluxo só decide se cria ou não cria.
