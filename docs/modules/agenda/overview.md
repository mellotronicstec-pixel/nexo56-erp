# Agenda e Tarefas — visão geral

**Prompt 14.** Módulo **OPCIONAL** (`operations.agenda`), **sem dependência**
de Ordens de Serviço.

## A pergunta que o módulo responde

> Nenhuma Ordem de Serviço importante deve ser esquecida.

E, ao lado dela, a que o Prompt 08 não respondia: _"conferir a documentação do
fornecedor"_ é trabalho real e não tem OS nenhuma.

## O que é cada coisa

O módulo separa formalmente cinco conceitos que costumam virar um só:

| Conceito            | O que é                                                                  | Onde mora                                 |
| ------------------- | ------------------------------------------------------------------------ | ----------------------------------------- |
| **Tarefa**          | Trabalho que uma pessoa precisa fazer, com prazo e responsável opcionais | `agenda_tasks`                            |
| **Compromisso**     | Hora reservada: das 14h às 15h, ou o dia 12 inteiro                      | `agenda_appointments`                     |
| **Tarefa de fluxo** | Consequência de uma transição da OS (preparação, busca de peça)          | `service_order_tasks` (Prompt 08)         |
| **Follow-up**       | O próximo momento em que alguém precisa olhar para a OS                  | `service_orders.follow_up_at` (Prompt 08) |
| **Ação da OS**      | Movimento de estado                                                      | máquina de estados (Prompt 08)            |

**Tarefa ≠ Follow-up.** O follow-up não tem responsável, não se conclui e não
é trabalho: é um lembrete de olhar. O que se faz com ele é **reagendar**.

## As três telas, e por que são três

| Tela              | Pergunta                         | Origens                            |
| ----------------- | -------------------------------- | ---------------------------------- |
| `/agenda`         | "O que tem para esta semana?"    | as quatro                          |
| `/minhas-tarefas` | "O que eu devo?"                 | tarefa, tarefa de fluxo, follow-up |
| `/tarefas`        | "O que a unidade tem em aberto?" | só `agenda_tasks`                  |

`/tarefas` mostra só `agenda_tasks` de propósito: é a tela que **edita,
atribui e cancela**, e nenhuma dessas ações se aplica a um registro de outro
módulo — oferecer "cancelar" para um follow-up seria oferecer um botão sem o
que fazer.

`/minhas-tarefas` **não tem recorte de período**: o que venceu há um mês e o
que não tem prazo aparecem, porque são exatamente os que ninguém lembra
sozinho.

**Janela padrão e teto são _defaults_, não regra de negócio.**
`DEFAULT_AGENDA_RANGE_DAYS = 7` e `MAX_AGENDA_RANGE_DAYS = 92` existem para a
agenda não virar varredura de histórico. São números de produto, passíveis de
virar configuração por empresa quando a operação pedir — nada no domínio
depende deles serem esses.

## Nada é copiado

A Agenda **lê** quatro origens e **escreve** em duas:

| Origem                        | Escrita pela Agenda?          |
| ----------------------------- | ----------------------------- |
| `agenda_tasks`                | sim                           |
| `agenda_appointments`         | sim                           |
| `service_order_tasks`         | **não** — delega ao Prompt 08 |
| `service_orders.follow_up_at` | **não**                       |

Copiar a tarefa de preparação para `agenda_tasks` criaria **duas verdades
sobre o mesmo trabalho**: concluir a cópia deixaria a original aberta, e a OS
ficaria esperando para sempre uma preparação que alguém já fez.

A deduplicação é **por construção**: cada registro sai de exatamente uma
tabela.

## Desligar a Agenda não apaga nada

`operations.agenda` governa **as telas**. Com ele desligado:

- os três itens somem do menu e as rotas recusam acesso;
- a seção "Tarefas da Agenda" some da ficha da OS;
- **o `follow_up_at` continua sendo marcado**, a varredura continua rodando e
  a tarefa de preparação continua sendo criada — porque essas coisas são do
  núcleo e nunca dependeram daqui.

É por isso que o follow-up não virou Task: uma rede de segurança que some
quando se desliga um módulo opcional não é rede de segurança.

## Leitura relacionada

- [ADR-073](../../adr/ADR-073-uma-arquitetura-de-tarefas-com-dois-papeis.md) — por que duas tabelas e não uma
- [ADR-074](../../adr/ADR-074-atraso-e-derivado-e-prazo-e-dia.md) — "atrasada" derivado, prazo civil
- [ADR-075](../../adr/ADR-075-compatibilidade-com-o-follow-up-historico.md) — o follow-up histórico e o texto oficial
- [modelo](model.md) · [permissões](permissions.md) · [concorrência](concurrency.md) · [limites](future.md)
