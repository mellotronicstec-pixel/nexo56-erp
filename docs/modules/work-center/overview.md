# Central de Trabalho — visão geral

**Prompt 15.** Módulo **OPCIONAL** (`operations.work_center`), dependente
apenas de `core.service_orders`.

## A pergunta que o módulo responde

> Por onde eu começo hoje?

Sete módulos depois, descobrir trabalho pendente exigia abrir módulo por
módulo. A Central reúne o que exige atenção em uma tela e leva rapidamente ao
contexto certo.

## O que ela é — e o que ela não é

| É                     | Não é                    |
| --------------------- | ------------------------ |
| Read model calculado  | Banco paralelo           |
| Filtros e priorização | Workflow engine          |
| Contexto e deep links | Cópia da OS ou da Agenda |
| Leitura               | Fonte de verdade         |

**Nenhuma tabela foi criada. Nenhuma migration existe no Prompt 15.** As filas
são consultas; os sinais de atenção são derivados na leitura
([ADR-077](../../adr/ADR-077-central-de-trabalho-e-leitura-sem-autoridade.md)).

## As sete filas

São exatamente os estados **não terminais** do Prompt 08, com os rótulos vindos
da fonte oficial:

Aguardando Parecer Técnico · Aguardando Aprovação · Aguardando Conserto ·
Aguardando Peça · Reparo Concluído · Aguardando Preparação para Entrega ·
Aguardando Cliente Retirar

Finalizada e Cancelada ficam fora do trabalho ativo — não exigem ação de
ninguém. Continuam acessíveis pelo módulo de OS.

**Nenhum estado novo foi inventado.** "Urgente", "Parada" e "Na bancada" não
existem: viraram flags e filtros.

## Os quatro sinais de atenção

| Sinal                   | Fato que o origina                            |
| ----------------------- | --------------------------------------------- |
| Acompanhamento atrasado | `service_orders.follow_up_at` < hoje          |
| Acompanhar hoje         | `follow_up_at` = hoje                         |
| Tarefa atrasada         | tarefa de fluxo ou da Agenda aberta e vencida |
| Sem responsável         | `assigned_technician_id` é nulo               |

Todos **derivados**, nenhum persistido. Cada um é também um filtro.

## As duas visões

**Minha visão** é vínculo **real**: as OS em que a pessoa é a técnica
atribuída. Não inclui "tudo que está sem responsável" — trabalho de ninguém
não é trabalho meu, e fingir esse vínculo encheria a tela de itens que a pessoa
não reconhece como seus.

**Unidade** é o trabalho operacional que a pessoa já tem permissão de ver.

## Unidade

A Central usa a **unidade ativa**, trocada pelo seletor que já existe no
cabeçalho. Ela **não aceita unidade pela URL** — um caminho a menos para errar,
e a forma mais forte de nunca tratar entrada do cliente como autoridade.

## A Agenda não é dependência

Com `operations.agenda` desligada, a Central continua inteira: filas,
acompanhamento e tarefas de fluxo são **CORE** do Prompt 08. Some apenas o que
era da Agenda — tarefas gerais deixam de contar como atraso e o atalho para
`/agenda` desaparece. **Provado por teste.**

## Leitura relacionada

- [ADR-077](../../adr/ADR-077-central-de-trabalho-e-leitura-sem-autoridade.md) — leitura sem autoridade
- [read model e prioridade](read-model.md) · [permissões](permissions.md) · [performance](performance.md) · [limites](future.md)
