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

| Chave                   | Capacidade                    |
| ----------------------- | ----------------------------- |
| `service_orders.view`   | consultar a lista e a ficha   |
| `service_orders.create` | abrir uma ordem               |
| `service_orders.update` | corrigir os dados de abertura |

Três **capacidades de negócio**, não uma por botão. As ações de workflow —
orçar, encomendar peça, concluir — chegam com o Prompt 08; criar permissões para
elas agora seria declarar poder sobre o que ainda não existe.

Verificado por teste: abrir não implica corrigir; **receber equipamento não
implica abrir Ordem de Serviço**.

## Escopo: as primeiras permissões de unidade que importam

A OS é da unidade, então a autorização é avaliada **dentro dela**
(`requireUnitAuthorization`), e não no escopo tenant. Isso faz valer tanto o
papel de nível tenant quanto o papel concedido só naquela loja — usar o guard de
tenant negaria acesso justamente a quem opera o balcão com um papel de unidade.

Consequências, todas cobertas por teste:

- quem opera só a Unidade Norte **não vê** a ordem da Unidade principal na
  listagem, **não abre** a ficha com o UUID em mãos e **não corrige**;
- trocar a unidade ativa muda o que a listagem mostra;
- a ordem mantém a unidade histórica quando a pessoa troca de unidade;
- papel de unidade não vale na outra unidade;
- papel de tenant vale nas unidades que a pessoa acessa, e só nelas.

Ordem de outra empresa ou de outra unidade responde **"não encontrada"** — não
"sem permissão", que confirmaria a existência.

## Auditoria

Registrada **dentro da transação** da escrita.

| Ação                                    | Quando                                         |
| --------------------------------------- | ---------------------------------------------- |
| `service_order.created`                 | abertura                                       |
| `service_order.customer_report_updated` | relato corrigido — guarda o texto **anterior** |
| `service_order.updated`                 | observações internas corrigidas                |

A auditoria de abertura guarda `customerReportLength`, **não o relato**. Há teste
que abre uma ordem com uma frase reconhecível e falha se ela aparecer na trilha.

## Eventos

`SERVICE_ORDER_CREATED` e `SERVICE_ORDER_UPDATED`, publicados pelo outbox
existente na mesma transação. **Nenhuma automação foi implementada** — os
eventos só preparam o futuro Rule Engine.

## Segurança — resumo

| Risco                                            | Onde é barrado                            |
| ------------------------------------------------ | ----------------------------------------- |
| OS ligada a cliente/equipamento de outra empresa | FK composta no banco                      |
| OS carimbada em unidade de outra empresa         | FK composta no banco                      |
| Recebimento da unidade A virando OS na unidade B | FK composta `(intake_id, unit_id)`        |
| `unitId` forjado no formulário                   | serviço usa `context.activeUnitId`        |
| `customerId` forjado no formulário               | cliente derivado do equipamento           |
| Acesso a OS de outra unidade pelo UUID           | consulta escopada + "não encontrada"      |
| Duas ordens pelo mesmo comando                   | UNIQUE de idempotência                    |
| Duas ordens para o mesmo recebimento             | UNIQUE de recebimento                     |
| Número repetido na empresa                       | UNIQUE `(tenant_id, number)`              |
| Autor de outra empresa                           | FK composta                               |
| Relato do cliente em log                         | log registra operação, nunca o formulário |
