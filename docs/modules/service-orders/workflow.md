# Workflow da Ordem de Serviço

> Prompt 08. O Prompt 07 definiu **o que a OS é**; esta etapa define **como ela
> muda de estado** — e, principalmente, **quem decide isso**.

A autoridade é um arquivo só:
[`src/modules/service-orders/domain/workflow.ts`](../../../src/modules/service-orders/domain/workflow.ts).
Nenhuma página, server action, componente, job ou repositório decide se uma
transição pode acontecer. Todos perguntam ali.

## A separação formal que o módulo preserva

| Conceito           | Onde vive                              | Exemplo                        |
| ------------------ | -------------------------------------- | ------------------------------ |
| **Entity**         | Prompt 07                              | a Ordem de Serviço             |
| **State**          | `domain/workflow.ts`                   | Aguardando Peça                |
| **Classification** | Prompt 13 (não existe)                 | garantia, retorno              |
| **Action**         | `application/service-order-actions.ts` | Buscar Peça                    |
| **Event**          | outbox                                 | `SERVICE_ORDER_STATUS_CHANGED` |
| **Rule**           | `domain/workflow.ts`                   | de onde se sai e para onde     |
| **Permission**     | access-control                         | `service_orders.transition`    |
| **Automation**     | Prompt 19 (não existe)                 | —                              |

**Ação não é estado.** "Buscar Peça" e "Informar Ordem Disponível" são ações.
Transformá-las em estado significaria que uma ordem só pode buscar uma peça por
vez, que buscar a segunda apaga o registro da primeira, e que a lista de estados
cresce toda vez que alguém inventa um verbo novo.

Uma ação pode causar transição ("Informar Ordem Disponível" leva a Aguardando
Cliente Retirar) ou não causar nenhuma (Buscar Peça cria tarefa e a ordem
continua em Aguardando Peça).

## Os nove estados

| Chave                           | Rótulo em tela                     | Terminal |
| ------------------------------- | ---------------------------------- | -------- |
| `awaiting_technical_opinion`    | Aguardando Parecer Técnico         | não      |
| `awaiting_approval`             | Aguardando Aprovação               | não      |
| `awaiting_repair`               | Aguardando Conserto                | não      |
| `awaiting_part`                 | Aguardando Peça                    | não      |
| `repair_completed`              | Reparo Concluído                   | não      |
| `awaiting_delivery_preparation` | Aguardando Preparação para Entrega | não      |
| `awaiting_customer_pickup`      | Aguardando Cliente Retirar         | não      |
| `completed`                     | Finalizada                         | **sim**  |
| `cancelled`                     | Cancelada                          | **sim**  |

Toda OS comum nasce em **Aguardando Parecer Técnico**.

**Reparo Concluído não é o fim.** É conclusão _técnica_: o aparelho ainda não
está pronto para entrega. Confundir os dois entrega o aparelho sujo e sem
conferência — por isso há um estado inteiro entre os dois.

## A matriz

Tudo que não está aqui é **proibido**.

```
awaiting_technical_opinion ──> awaiting_repair
                           └─> awaiting_approval

awaiting_approval          ──> awaiting_repair

awaiting_repair            ──> awaiting_part
                           └─> repair_completed

awaiting_part              ──> awaiting_repair

repair_completed           ──> awaiting_delivery_preparation

awaiting_delivery_preparation ──> awaiting_customer_pickup   (SÓ pela ação)

awaiting_customer_pickup   ──> completed

qualquer não-terminal      ──> cancelled                     (exige motivo)
```

Não existe "qualquer estado vira qualquer outro". Cada linha foi escolhida
porque descreve algo que acontece de verdade numa assistência.

**`repair_completed → awaiting_delivery_preparation` não é automática.** Reparo
concluído é o fim do trabalho do técnico; a preparação é de outra pessoa, e
pular esse passo levaria o aparelho ao balcão sem limpeza nem conferência.

**`awaiting_delivery_preparation → awaiting_customer_pickup` é `actionOnly`.**
Ela não aparece no seletor genérico de situação: só a ação "Informar Ordem
Disponível" chega lá, e só depois que a preparação estiver concluída.

## A única porta

`status` muda em **um lugar só**:
[`transitionServiceOrder`](../../../src/modules/service-orders/application/workflow-service.ts).

Não existe, em lugar nenhum do sistema, um `update(serviceOrders).set({ status })`
fora daquele arquivo. A ordem das verificações importa:

1. o estado de destino existe?
2. a ordem existe e está numa unidade que esta pessoa acessa?
3. a transição existe na matriz? (se não: recusa explicada em português)
4. a transição é `actionOnly` e veio pela ação correspondente?
5. exige motivo e o motivo veio?
6. a pessoa tem a permissão **na unidade da ordem**?

Só então abre a transação, que faz tudo ou nada:

```
UPDATE … WHERE status = <lido> AND version = <esperada>   (compare-and-swap)
INSERT  service_order_timeline                            (status_changed)
recordAudit(…, tx)                                        (service_order.status_changed)
efeitos de entrar no estado                               (tarefas)
emit(SERVICE_ORDER_STATUS_CHANGED)                        (outbox)
```

Autorizar antes de saber se a transição existe faria o sistema responder "sem
permissão" para algo que simplesmente não é possível.

## Concorrência

Duas pessoas abrem a mesma OS. Uma marca "falta peça", a outra marca "reparo
concluído". Sem trava, a segunda gravação apagaria a primeira **em silêncio** — e
o histórico registraria as duas como se ambas tivessem acontecido.

A coluna `version` resolve. A tela envia a versão que leu; o `UPDATE` carrega
estado **e** versão no `WHERE`. Quem perde a corrida não afeta linha nenhuma, a
transação inteira volta atrás e a pessoa recebe:

> Esta Ordem de Serviço foi alterada por outra pessoa enquanto você trabalhava
> nela. Recarregue a página e tente de novo.

Coberto por teste com duas transições **realmente simultâneas** a partir do mesmo
estado: exatamente uma vence, uma única entrada aparece na linha do tempo e a
versão sobe uma vez só.

Chamadas de sistema (um job, a futura API) podem omitir `expectedVersion`: elas
não têm tela para ler versão, e aceitam o estado atual.

## Permissões

| Permissão                          | Autoriza                          |
| ---------------------------------- | --------------------------------- |
| `service_orders.transition`        | mover a ordem pelo fluxo          |
| `service_orders.complete`          | **finalizar** (permissão própria) |
| `service_orders.cancel`            | **cancelar** (permissão própria)  |
| `service_orders.assign_technician` | definir o responsável             |
| `service_orders.manage_follow_up`  | reagendar o acompanhamento        |
| `service_orders.manage_tasks`      | criar e concluir tarefas do fluxo |

Finalizar e cancelar têm permissão própria porque são **irreversíveis**: quem
move o trabalho pela bancada não necessariamente encerra o atendimento.

**A permissão é avaliada na unidade da ORDEM**, não na unidade ativa da sessão.
Alguém com acesso a duas lojas não move o trabalho da loja B por estar com a
loja A selecionada no seletor. Coberto por teste.

## Recusa explicada

`explainRefusal(from, to)` devolve o motivo em português, e é o que a interface
mostra. Nada de "transição inválida" nem código de erro:

- _"Esta Ordem de Serviço está Finalizada e não pode mais mudar de situação."_
- _"Esta Ordem de Serviço não pode ir de Aguardando Peça diretamente para Reparo
  Concluído."_
- _"A situação Aguardando Cliente Retirar só pode ser alcançada pela ação
  correspondente."_

## O que a interface mostra

A ficha pergunta à máquina de estados quais transições existem a partir da
situação atual e pergunta ao controle de acesso quais delas esta pessoa pode
executar na unidade da ordem. **O que não é possível não aparece** — botão
desabilitado e mudo ensina a equipe a ignorar a interface. O que depende de uma
condição aparece com a condição escrita:

> Conclua a preparação para entrega antes de informar o cliente.

Mudar de situação exige **confirmação explícita**: no celular um `select` solto
muda o estado com um toque errado. O diálogo diz o que vai acontecer e exige uma
segunda ação.

A cor **nunca** carrega a informação sozinha: o rótulo em texto acompanha o tom
em toda superfície.
