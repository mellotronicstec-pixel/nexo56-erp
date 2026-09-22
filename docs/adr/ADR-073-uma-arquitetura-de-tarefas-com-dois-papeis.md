# ADR-073 — Uma arquitetura de tarefas com dois papéis, não dois sistemas de tarefas

**Status:** Aceito
**Data:** Prompt 14 — Agenda e Tarefas
**Itens atendidos:** 1, 5, 12, 17, 43, 44, 55, 56, 57, 68, 106, 156, 187

## Contexto

O Prompt 08 já havia criado `service_order_tasks`, e o comentário do próprio
schema dizia, sobre a coluna `kind`: _"Texto, para o Prompt 14 crescer."_ O
Prompt 14 pede tarefas e agenda. A pergunta óbvia — e que **precisa** de
resposta antes de qualquer linha de UI — é: a tarefa da Agenda é a mesma coisa
que a tarefa da OS?

Se for, evoluir `service_order_tasks` é o caminho. Se não for, criar uma
segunda tabela é o caminho. O que não é aceitável é ter **dois sistemas
genéricos de tarefa** concorrendo, cada um com sua tela e sua regra.

## Comparação formal

| Dimensão                | `service_order_tasks` (Prompt 08)                | `agenda_tasks` (Prompt 14)                                    |
| ----------------------- | ------------------------------------------------ | ------------------------------------------------------------- |
| Quem cria               | A máquina de estados, ao transicionar a OS       | Uma pessoa, digitando                                         |
| Texto                   | Fixo, vem de constante do domínio                | Livre, escrito por quem cria                                  |
| `service_order_id`      | `NOT NULL` — a tarefa não existe sem a OS        | Anulável — "conferir a documentação do fornecedor" não tem OS |
| Identidade              | `(service_order_id, kind, open_marker)`          | `(tenant_id, idempotency_key)`                                |
| Cardinalidade           | Uma ABERTA por `kind` por OS                     | Quantas a operação precisar                                   |
| Conjunto de tipos       | Fechado: `delivery_preparation`, `part_pickup`   | Não há tipo; há prioridade                                    |
| Encerramento automático | Sim: `cancelOpenTasks` ao concluir/cancelar a OS | Não: tarefa de pessoa só encerra por decisão de pessoa        |
| Prioridade              | Não existe                                       | `low`/`normal`/`high`/`urgent`                                |
| Módulo                  | **CORE** — não pode ser desligado                | **OPCIONAL** — `operations.agenda`                            |

As duas primeiras linhas já decidem. Uma tabela cujo texto vem de constante e
cuja existência é consequência de uma transição de estado **não é** a mesma
coisa que uma tabela onde uma pessoa escreve o que quiser, sem OS nenhuma.

## Alternativa avaliada e recusada: fundir na tabela existente

Fundir exigiria, sobre uma tabela do Prompt 08 já com dados:

1. tornar `service_order_id` anulável — `ALTER ... MODIFY`, reescrita de tabela;
2. conviver com duas famílias de invariantes disjuntas na mesma linha
   (`open_marker` para uma, `idempotency_key` para a outra);
3. fazer `cancelOpenTasks` distinguir, no encerramento da OS, as tarefas que
   ele pode fechar das que ele não pode — **e é exatamente aí que um erro
   apagaria trabalho de uma pessoa**;
4. fazer o CORE (a máquina de estados) escrever numa tabela cujo dono é um
   módulo OPCIONAL.

O item 4 é o que sela a decisão. `operations.agenda` pode ser desligado. Se a
criação da tarefa de preparação dependesse do schema da Agenda, desligar a
Agenda colocaria em risco a garantia central do Prompt 14 — _"nenhuma Ordem de
Serviço importante deve ser esquecida"_. Uma rede de segurança que some quando
se desliga uma funcionalidade opcional não é rede de segurança.

## Decisão

**Duas tabelas, dois papéis, uma arquitetura.**

- `service_order_tasks` é **tarefa de fluxo**: pertence à máquina de estados,
  tem conjunto fechado de tipos, uma aberta por tipo por OS. Permanece
  **intocada** pelo Prompt 14 — nenhuma coluna nova, nenhuma regra nova.
- `agenda_tasks` é **tarefa operacional**: pertence a uma pessoa, texto livre,
  com ou sem OS.

Não há segundo sistema _genérico_: existe **um** sistema genérico
(`agenda_tasks`) e **um** mecanismo de fluxo (`service_order_tasks`).

Para que isso seja arquitetura única e não duas ilhas, valem três amarras:

1. **Vocabulário compartilhado.** `agenda_tasks.status` usa `open`/`done`/
   `cancelled` — as mesmas palavras do Prompt 08, inclusive mantendo as colunas
   `completed_at`/`completed_by` com o nome que aquela tabela já usava.
2. **Projeção comum.** As duas — e mais o follow-up — chegam à tela como
   `AgendaItem`, com `type` dizendo de onde vieram.
3. **Uma ação, um dono.** Concluir uma tarefa de fluxo pela Agenda **delega**
   ao serviço do Prompt 08. A Agenda não reimplementa a transição.

## Consequência mais importante: nada é copiado

A Agenda **lê** quatro origens e **não escreve em três delas**:

| Origem               | Tabela                        | Escrita pela Agenda?      |
| -------------------- | ----------------------------- | ------------------------- |
| `task`               | `agenda_tasks`                | Sim                       |
| `appointment`        | `agenda_appointments`         | Sim                       |
| `service_order_task` | `service_order_tasks`         | Não — delega ao Prompt 08 |
| `follow_up`          | `service_orders.follow_up_at` | Não                       |

Copiar a tarefa de preparação para `agenda_tasks` para "aparecer na agenda"
criaria **duas verdades sobre o mesmo trabalho**: concluir a cópia deixaria a
original aberta, e a OS ficaria esperando para sempre uma preparação que
alguém já fez.

Por isso a deduplicação é **por construção** (item 57): cada registro sai de
exatamente uma tabela. Não existe caminho por onde o mesmo trabalho apareça
duas vezes, porque não existe registro projetado em dois lugares.

E por isso, também, **nenhuma Task espelho é criada para o follow-up**. Ele é
projetado como `type: 'follow_up'` direto da coluna onde sempre esteve.
