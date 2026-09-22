# ADR-077 — A Central de Trabalho é leitura; a autoridade fica em cada domínio

**Status:** Aceito
**Data:** Prompt 15 — Central de Trabalho
**Itens atendidos:** 5, 6, 7, 20, 21, 26, 27, 28, 31, 32, 76, 107, 108

## Contexto

Sete módulos depois, encontrar trabalho pendente exige abrir módulo por módulo:
a lista de OS diz quais existem mas não quais estão paradas; o acompanhamento
vive numa coluna da OS; as tarefas estão em duas tabelas; e nenhuma tela
responde "por onde eu começo hoje?".

A tentação óbvia é construir uma tela que _resolva_ isso — com estado próprio,
prioridade própria e ações próprias. É exatamente o que esta ADR recusa.

## Decisão 1: read model calculado, sem persistência

Não existe tabela `work_center_items`. Não existe migration no Prompt 15.

As filas são **consultas**; os sinais de atenção são **derivados na leitura**.
Persistir qualquer um dos dois criaria uma segunda verdade sobre onde a OS
está — e a segunda verdade é sempre a que fica desatualizada primeiro.

Consequência direta: **nenhum job novo**. Não há "atualizar a Central". Se
houvesse, o dia em que ele falhasse seria o dia em que a tela mentiria com
confiança.

Um teste de fronteira falha se aparecer `mysqlTable`, `insert`, `update`,
`delete`, `runInTransaction` ou uma migration `0014` dentro do módulo.

## Decisão 2: a Central não escreve — em lugar nenhum

| A Central faz                     | A Central não faz                |
| --------------------------------- | -------------------------------- |
| Ler `service_orders`              | Escrever `service_orders.status` |
| Ler `service_order_tasks`         | Escrever `service_order_tasks`   |
| Ler `agenda_tasks`                | Escrever `agenda_tasks`          |
| Ler `service_orders.follow_up_at` | Reagendar follow-up              |
| Levar à ficha da OS               | Executar transição               |

A ação primária de cada linha é **"Abrir OS"**. Transicionar exige permissão,
versão e, em alguns casos, motivo escrito — três coisas que a ficha da OS já
faz corretamente. Reimplementá-las na Central criaria uma cópia, e a cópia é
que erra quando a regra muda.

_"Centralizar a atenção não significa centralizar a autoridade."_

## Decisão 3: as filas são os estados oficiais

As sete filas são exatamente os sete estados **não terminais** do Prompt 08,
com os rótulos vindos de `SERVICE_ORDER_STATUS_LABEL` — um mapa só, nunca uma
cópia.

Não existe "Urgente", "Parada", "Na bancada" nem "Prioritária". Esses conceitos
viraram **flags derivadas** e **filtros**, nunca estados. Um teste falha se
alguma dessas palavras aparecer como valor no módulo.

Finalizada e Cancelada ficam fora do trabalho ativo: elas não exigem ação de
ninguém, e somadas ao resto empurrariam para baixo o que precisa acontecer.
Continuam acessíveis pelo módulo de OS.

## Decisão 4: prioridade determinística, com a precedência declarada

Sem score, sem peso arbitrário, sem `float`, sem aleatoriedade:

1. **Urgência temporal** — acompanhamento atrasado → tarefa atrasada →
   acompanhar hoje → nada.
2. **Data de referência** — a mais antiga primeiro; sem data vai para o fim.
3. **Número da OS** — chave estável, garante ordem total entre páginas.

O rank é **posição**, não peso: zero vem primeiro. Isso está escrito porque o
Prompt 14 teve exatamente esse defeito — um rank de posição comparado como peso
invertia a lista inteira, e só um teste de domínio pegou.

"Sem responsável" **não entra na precedência**, de propósito: uma OS sem dono
não é mais urgente que uma atrasada; é um problema de distribuição. Continua
sendo badge e filtro.

A mesma regra existe duas vezes — no `ORDER BY` do SQL e em
`compareWorkCenterItems` — porque ordenar em memória depois de paginar traria a
página errada. Um teste de integração prova que as duas ordens coincidem.

## Decisão 5: a Agenda é camada oportunista, nunca dependência

`operations.work_center` depende **apenas** de `core.service_orders`.

Com a Agenda desligada, a Central continua inteira: as filas aparecem, o
acompanhamento continua sinalizado e as tarefas de fluxo continuam contadas —
porque `follow_up_at` e `service_order_tasks` são **CORE** do Prompt 08. O que
some é só o que era da Agenda: tarefas gerais deixam de contar como "tarefa
atrasada" e o atalho para `/agenda` desaparece.

Fazer o contrário transformaria um módulo opcional em pré-requisito da pergunta
"o que preciso fazer hoje?" — e a promessa de que nenhuma OS importante é
esquecida não é opcional.

## Decisão 6: uma permissão só

`work_center.view` governa a **tela**. O **conteúdo** continua governado pelas
permissões de origem: `service_orders.view` para as filas, `agenda.view` para a
camada da Agenda.

Não existe `work_center.team_view`. Quem pode listar as OS da unidade em
`/ordens-de-servico` já vê os mesmos registros; uma chave extra para a Central
esconderia na cozinha o que já está servido no salão.

## Consequência conhecida: o `filesort` da lista

Medido com `EXPLAIN` em MariaDB com 4.000 OS (2.000 na unidade):

| Consulta             | Plano                                           |
| -------------------- | ----------------------------------------------- |
| Contagem por fila    | `ix_service_order_unit_status`, **Using index** |
| Filtro por fila      | `ix_service_order_unit_status`, **Using index** |
| Minha visão          | `index_merge` técnico ∩ unidade                 |
| **Lista priorizada** | **`Using temporary; Using filesort`**           |

O `ORDER BY` da lista é uma expressão `CASE` — e expressão não usa índice.
Nenhum índice novo resolveria isso, então **nenhum foi criado**: seria índice
especulativo, que custa escrita e não paga leitura.

Na escala atual o custo é irrelevante (ordenar milhares de linhas é trabalho de
milissegundos) e filtrar por fila reduz o conjunto drasticamente, aí sim com
índice de cobertura. A evolução natural, quando e se o volume exigir, é
materializar a projeção — e o read model já está desenhado para isso, porque
nada nele depende de estar sendo calculado agora.
