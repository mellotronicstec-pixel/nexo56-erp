# ADR-074 — "Atrasada" é derivado; prazo é dia, compromisso é instante

**Status:** Aceito
**Data:** Prompt 14 — Agenda e Tarefas
**Itens atendidos:** 27, 28, 33, 48, 49, 52, 58, 59, 103

## Decisão 1: `overdue` não é coluna

Uma tarefa está atrasada quando **está aberta** e **o prazo ficou para trás na
data civil da empresa**. As duas coisas já estão gravadas; a terceira é
aritmética.

Persistir `overdue` exigiria um job reescrevendo a carteira inteira à
meia-noite de **cada fuso** — e no dia em que ele falhasse, a tela mostraria
"em dia" para tarefas vencidas, sem nenhum sinal de que algo deu errado. O
erro seria silencioso e apareceria como confiança.

É a mesma decisão já tomada para "vencido" no Financeiro (ADR-055) e para a
vigência de garantia (ADR-064). Três módulos, um princípio: **estado que o
tempo produz sozinho não se grava.**

Consequência prática: nenhum job novo entrou no Prompt 14. Um teste de
fronteira falha se alguém registrar um.

## Decisão 2: prazo é data civil; compromisso com horário é instante

| O que                      | Como é guardado                          | Por quê                  |
| -------------------------- | ---------------------------------------- | ------------------------ |
| Prazo de tarefa            | `VARCHAR(10)`, `AAAA-MM-DD`              | "até sexta" não tem hora |
| `follow_up_at`             | `VARCHAR(10)` (Prompt 08, intocado)      | idem                     |
| Compromisso de dia inteiro | `start_date` / `end_date`, civis         | o dia 12 é o dia 12      |
| Compromisso com horário    | `start_at` / `end_at`, `DATETIME(3)` UTC | 14h é um instante        |

Um evento de dia inteiro **não** é "00:00 às 23:59 UTC": em São Paulo isso
começaria às 21h do dia anterior. Por isso ele mora em colunas próprias,
separadas dos instantes — e nunca os dois pares ao mesmo tempo. Ao reagendar,
o par que deixou de valer vai a `NULL` explicitamente: deixar o antigo intacto
guardaria duas versões do "quando", e a consulta por intervalo encontraria o
mesmo compromisso duas vezes.

Na leitura da agenda, o dia de um compromisso com horário é calculado **no
fuso da empresa**. Agrupar pelo dia UTC jogaria uma visita das 22h para o dia
seguinte na tela de quem a marcou para hoje.

## Decisão 3: "hoje" é da empresa, nunca do navegador

A data civil de referência chega pronta do servidor, em `today`. O dono
viajando não pode ver como atrasada uma tarefa que na loja ainda vence hoje —
e o técnico no fuso da loja não pode ver "amanhã" onde a agenda diz "hoje".

## Decisão 4: a janela da agenda tem teto

`MAX_AGENDA_RANGE_DAYS = 92`. Sem teto, "de 2020 a 2030" vira varredura de
histórico com a tela travada; noventa e dois dias cobrem um trimestre.

O teto tem **um furo deliberado**: o que venceu **antes** do início do período
entra assim mesmo. Uma tarefa que venceu na semana passada não deixa de
existir porque a tela abriu em "hoje" — escondê-la seria exatamente o
esquecimento que este módulo existe para impedir.

E "Minhas tarefas" **não tem janela nenhuma**: ali a pergunta é "o que eu
devo?", e aplicar um recorte esconderia justamente a tarefa mais esquecida.

## O que ficou de fora, e por quê

- **Recorrência.** Uma tarefa que se repete exige decidir o que acontece
  quando uma ocorrência é concluída tarde, o que acontece com o histórico ao
  editar a série, e como a exceção de um dia é representada. É um módulo, não
  um campo.
- **Motor de lembretes.** Criar "ligar para o cliente" não liga para ninguém e
  não avisa ninguém. Comunicação é o Prompt 16.
- **"Realizado" para compromisso.** O tempo passar não prova que a visita
  aconteceu (ADR-073).
