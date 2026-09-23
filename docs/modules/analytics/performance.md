# Performance do Painel

## Metodologia

Fixture: 4.000 Ordens de Serviço em um único tenant/unidade (distribuição
quase uniforme pelas 9 situações oficiais, `opened_at` espalhado em até 120
dias, `status_changed_at` das terminais até 15 dias depois da abertura).
Volume escolhido para ficar na mesma ordem de grandeza da fixture já usada
pelo Prompt 15 (4.000 OS) — comparável, não inventado.

Consultas medidas via `EXPLAIN` mais execução real (script de verificação
`tests/_e2e_analytics_explain.test.ts`, **criado, executado e apagado nesta
sessão** — nunca commitado, seguindo a convenção já estabelecida no
repositório para scripts de verificação ad hoc).

## EXPLAIN das 5 consultas de Ordens de Serviço

Nenhuma delas faz full scan (`type: ALL`); todas usam índice já existente —
**nenhum índice novo foi necessário**.

| Consulta                 | `type`        | Índice usado                                                      | `rows` estimadas | Observação                             |
| ------------------------ | ------------- | ----------------------------------------------------------------- | ---------------- | -------------------------------------- |
| `os.status_distribution` | `ref`         | `ix_service_order_unit_status`                                    | 2.000            | Cobertura total (`Using index`)        |
| `os.created_in_period`   | `range`       | `ix_service_order_tenant_unit_opened`                             | 1.065            | Cobertura total (`Using index`)        |
| `os.completed_in_period` | `index_merge` | `ix_service_order_tenant_status` + `fk_service_order_unit_tenant` | 222              | Intersecção de dois índices existentes |
| `os.backlog_aging`       | `ref`         | `ix_service_order_tenant_status`                                  | 2.445            | `Using index condition`                |
| `os.cycle_time`          | `index_merge` | mesmos dois índices de `completed_in_period`                      | 222              | idem                                   |

`os.completed_in_period` e `os.cycle_time` usam `index_merge` em vez de um
único índice cobrindo tudo, porque nenhum índice atual combina `status` +
`unit_id` + `status_changed_at` nesta ordem. Isso é aceitável no volume
medido (`rows` estimadas: 222, sub-milissegundo na prática) e **não
justifica um índice composto novo agora** — ver "Quando um índice novo
seria justificado" abaixo.

## Tempo de execução real

| Chamada                                                        | Tempo observado |
| -------------------------------------------------------------- | --------------- |
| `loadServiceOrderMetrics` (as 6 consultas em paralelo)         | 23ms            |
| `loadDashboard` (a página `/painel` inteira, só OS habilitado) | 17ms            |

(`loadDashboard` mediu mais rápido que a chamada isolada por reaproveitar
conexões já aquecidas do pool na mesma execução — a ordem de grandeza é a
mesma; nenhuma das duas caracteriza latência perceptível pela pessoa
usando o Painel.)

## Quantas consultas a página principal executa (item 113)

Sem nenhum domínio opcional habilitado: **1 consulta de Effective Access**
(`checkManyAccess`, um único snapshot para todos os 7 domínios opcionais)
**+ 6 consultas paralelas de Ordens de Serviço** (`Promise.all` em
`loadServiceOrderMetrics`) **= 7 consultas** para carregar `/painel`
inteiro. Cada domínio opcional adicional habilitado soma suas próprias
consultas (Orçamentos: 3; Financeiro: reaproveita `loadFinanceOverview`,
que já é medido pela suíte do próprio módulo Financeiro; Estoque: 1;
Compras: 2; Garantias: 2; Agenda: 2; Comunicação: 2) — sempre em paralelo
entre domínios (`Promise.all` em `dashboard-query-service.ts`), nunca em
série.

## Por que nenhum índice novo foi criado (item 110)

A regra do prompt é "crie índice somente quando `EXPLAIN`/consulta
justificar". Nenhuma das 5 consultas fez full scan, e o pior caso medido
(`index_merge`, 222 linhas estimadas) já responde em milissegundos no
volume testado. Criar um índice composto especulativo
(`tenant_id, unit_id, status, status_changed_at`) sem uma consulta lenta
medida seria "indexar todos os campos" na prática — o item 110 proíbe
exatamente isso.

## Quando um índice novo seria justificado

Se um tenant real acumular uma ordem de grandeza muito maior de OS
finalizadas/canceladas por unidade (dezenas de milhares), o
`index_merge` de `os.completed_in_period`/`os.cycle_time` deixaria de ser
sub-milissegundo. Nesse caso, um índice composto
`(tenant_id, unit_id, status, status_changed_at)` resolveria as duas
consultas de uma vez — documentado aqui como gatilho objetivo, não
implementado sem evidência (item 98).

## Limitações desta medição

- Fixture com um único tenant e uma única unidade recebendo todo o volume;
  não mede contenção entre tenants nem entre unidades diferentes do mesmo
  tenant (o índice já inclui `tenant_id`/`unit_id` como prefixo, então o
  comportamento esperado é o mesmo, mas não foi medido com múltiplos
  tenants simultâneos).
- Não mede os demais 6 domínios opcionais sob volume comparável — cada um
  reaproveita um padrão de índice já existente e testado pela suíte do
  próprio módulo (ex.: `ix_comm_message_unit_created`, coberto pela suíte
  de Comunicação), mas não foi objeto de um `EXPLAIN` dedicado neste
  prompt.
- Medição feita em ambiente de desenvolvimento de sessão (container), não
  em hardware de produção — os números absolutos servem para comparar
  `type`/`rows` do plano de execução, não como SLA.
