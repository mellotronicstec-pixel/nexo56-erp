# Permissões, auditoria e eventos

## Feature

| Chave                 | Tipo     | Depende de                         |
| --------------------- | -------- | ---------------------------------- |
| `core.service_orders` | **CORE** | `core.customers`, `core.equipment` |

**CORE** porque a Ordem de Serviço é a espinha dorsal de uma assistência
técnica: uma empresa que a desativasse não estaria usando um Nexo56 com menos
módulos — estaria usando outro produto. CORE não é desativável pelo tenant, e há
teste verificando que a tentativa é recusada.

As duas dependências são declaradas explicitamente, mesmo sendo Equipamentos já
dependente de Clientes: a OS referencia **ambos diretamente**, e o grafo deve
dizer isso sem que ninguém precise deduzir.

A unidade não entra como dependência de feature porque não é opcional — todo
tenant tem ao menos uma, e o contexto de unidade é infraestrutura.

## Permissões

| Chave                              | Capacidade                        | Prompt |
| ---------------------------------- | --------------------------------- | ------ |
| `service_orders.view`              | consultar a lista e a ficha       | 07     |
| `service_orders.create`            | abrir uma ordem                   | 07     |
| `service_orders.update`            | corrigir os dados de abertura     | 07     |
| `service_orders.transition`        | mover a ordem pelo fluxo          | 08     |
| `service_orders.complete`          | **finalizar** a ordem             | 08     |
| `service_orders.cancel`            | **cancelar** a ordem              | 08     |
| `service_orders.assign_technician` | definir o técnico responsável     | 08     |
| `service_orders.manage_follow_up`  | reagendar o acompanhamento        | 08     |
| `service_orders.manage_tasks`      | criar e concluir tarefas do fluxo | 08     |

**Capacidades de negócio, não uma permissão por botão.** As cinco ações de
workflow da etapa (atribuir, acompanhar, tarefas, informar disponível, buscar
peça) se resolvem com três permissões, porque descrevem três responsabilidades
distintas de quem opera a bancada.

Finalizar e cancelar têm permissão **própria** porque são irreversíveis: quem
move o trabalho pela bancada não necessariamente encerra o atendimento.

Verificado por teste: abrir não implica corrigir; **receber equipamento não
implica abrir Ordem de Serviço**; quem move a ordem não finaliza nem cancela;
quem cuida de tarefas não move a ordem.

Permissões de orçamento, peça, financeiro e garantia **não existem** — criá-las
agora seria declarar poder sobre o que ainda não existe.

## Escopo: as primeiras permissões de unidade que importam

A OS é da unidade, então a autorização é avaliada **dentro dela**, e não no
escopo tenant. Isso faz valer tanto o papel de nível tenant quanto o papel
concedido só naquela loja — usar o guard de tenant negaria acesso justamente a
quem opera o balcão com um papel de unidade.

Abertura e correção usam `requireUnitAuthorization`, que exige **unidade ativa**.
As ações de workflow usam `authorize(context, { …, unitId: order.unitId })`: a
permissão é avaliada na unidade **da ordem**, não na unidade ativa da sessão.

A diferença tem consequência real: alguém com acesso a duas lojas não deve
conseguir mover o trabalho da loja B por estar com a loja A selecionada no
seletor. Coberto por teste — um papel de transição concedido só no Norte, com o
Norte ativo, é recusado numa ordem da outra unidade.

Consequências, todas cobertas por teste:

- quem opera só a Unidade Norte **não vê** a ordem da Unidade principal na
  listagem, **não abre** a ficha com o UUID em mãos e **não corrige**;
- trocar a unidade ativa muda o que a listagem mostra;
- a ordem mantém a unidade histórica quando a pessoa troca de unidade;
- papel de unidade não vale na outra unidade;
- papel de tenant vale nas unidades que a pessoa acessa, e só nelas.

Ordem de outra empresa ou de outra unidade responde **"não encontrada"** — não
"sem permissão", que confirmaria a existência.

## Empresas que já existiam ganham as permissões novas

O perfil **Administrador** significa "acesso administrativo completo". Quando um
prompt acrescenta permissões ao catálogo, `syncCatalog` as concede aos
Administradores existentes — idempotente, e sem nunca remover permissão
concedida à mão.

Sem isso, um tenant criado antes do Prompt 08 ficaria com um Administrador que
não consegue mover nenhuma Ordem de Serviço, e o produto teria dois tipos de
administrador dependendo da data de cadastro. A interface esconderia os botões
e ninguém saberia por quê.

Confirmado nesta etapa em ambiente real: o tenant de desenvolvimento, criado no
Prompt 07, tinha só as três permissões antigas até `npm run db:seed` rodar — e
os botões de workflow, corretamente, não apareciam. Depois da sincronização, as
nove estão concedidas.

Os perfis **Técnico** e **Atendente** continuam sem permissões e sem
`is_system`: atribuir capacidades de workflow a eles seria escolher a estrutura
organizacional da empresa no lugar dela.

## Auditoria

Registrada **dentro da transação** da escrita.

| Ação                                            | Quando                                             |
| ----------------------------------------------- | -------------------------------------------------- |
| `service_order.created`                         | abertura                                           |
| `service_order.customer_report_updated`         | relato corrigido — guarda o texto **anterior**     |
| `service_order.updated`                         | observações internas corrigidas                    |
| `service_order.status_changed`                  | transição — guarda estado e versão, antes e depois |
| `service_order.technician_assigned`             | responsável definido ou removido                   |
| `service_order.follow_up_rescheduled`           | acompanhamento reagendado ou encerrado             |
| `service_order_task.created`                    | tarefa de fluxo criada                             |
| `service_order_task.completed`                  | tarefa concluída                                   |
| `service_order_task.cancelled`                  | tarefa encerrada junto com a ordem                 |
| `service_order.customer_notification_requested` | "Informar Ordem Disponível" — `delivered: false`   |

A auditoria de abertura guarda `customerReportLength`, **não o relato**. Há teste
que abre uma ordem com uma frase reconhecível e falha se ela aparecer na trilha.

## Eventos

Publicados pelo outbox existente, **na mesma transação** da escrita.

| Evento                                          | Publicado quando                                  |
| ----------------------------------------------- | ------------------------------------------------- |
| `SERVICE_ORDER_CREATED`                         | abertura                                          |
| `SERVICE_ORDER_UPDATED`                         | correção dos dados de abertura                    |
| `SERVICE_ORDER_STATUS_CHANGED`                  | toda transição, com `from`, `to` e `via`          |
| `SERVICE_ORDER_TECHNICIAN_ASSIGNED`             | responsável definido ou removido                  |
| `SERVICE_ORDER_TASK_CREATED`                    | tarefa de fluxo criada                            |
| `SERVICE_ORDER_TASK_COMPLETED`                  | tarefa concluída                                  |
| `SERVICE_ORDER_CUSTOMER_NOTIFICATION_REQUESTED` | intenção de avisar o cliente (`delivered: false`) |
| `SERVICE_ORDER_FOLLOW_UP_OVERDUE`               | job de varredura, uma vez por prazo vencido       |

**Nenhuma automação foi implementada** e **nenhum evento é consumido**: não há
handler, não há Rule Engine, não há canal de comunicação. Os eventos ficam no
outbox preparando os Prompts 16 e 19.

Payload mínimo e **sem PII**: chaves técnicas, ids e datas. Há teste que faz uma
transição numa OS com relato e nome reconhecíveis e falha se qualquer um dos
dois aparecer no payload.

O evento de notificação carrega `delivered: false` porque é exatamente isso que
aconteceu: a intenção foi registrada, nada foi enviado.

## Segurança — resumo

| Risco                                            | Onde é barrado                                 |
| ------------------------------------------------ | ---------------------------------------------- |
| OS ligada a cliente/equipamento de outra empresa | FK composta no banco                           |
| OS carimbada em unidade de outra empresa         | FK composta no banco                           |
| Recebimento da unidade A virando OS na unidade B | FK composta `(intake_id, unit_id)`             |
| `unitId` forjado no formulário                   | serviço usa `context.activeUnitId`             |
| `customerId` forjado no formulário               | cliente derivado do equipamento                |
| Acesso a OS de outra unidade pelo UUID           | consulta escopada + "não encontrada"           |
| Duas ordens pelo mesmo comando                   | UNIQUE de idempotência                         |
| Duas ordens para o mesmo recebimento             | UNIQUE de recebimento                          |
| Número repetido na empresa                       | UNIQUE `(tenant_id, number)`                   |
| Autor de outra empresa                           | FK composta                                    |
| Relato do cliente em log                         | log registra operação, nunca o formulário      |
| Transição de OS de outra unidade                 | autorização na unidade **da ordem**            |
| `status` escrito fora do workflow                | uma porta só: `transitionServiceOrder`         |
| Gravação concorrente sobrescrevendo a anterior   | `version` + compare-and-swap                   |
| Transição não prevista na matriz                 | `findTransition` recusa e explica              |
| Técnico de outra empresa ou sem acesso à unidade | consulta de vínculo + FK composta              |
| Duas tarefas abertas do mesmo tipo               | UNIQUE `(service_order_id, kind, open_marker)` |
| Evento de follow-up duplicado                    | `follow_up_alerted_for` no `WHERE` do `UPDATE` |
| Tarefa de outra unidade concluída pelo UUID      | escopo + "não encontrada"                      |
