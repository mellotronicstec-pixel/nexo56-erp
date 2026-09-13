# Follow-ups

> "Nenhuma Ordem de Serviço importante deve ser esquecida."

## O que um follow-up é aqui

Uma **data civil** guardada na própria ordem (`follow_up_at`), no fuso da
empresa. Não é um lembrete, não é uma notificação, não é uma tarefa: é o dia em
que aquela ordem volta a pedir atenção.

## Prazos

| Quando                         | Prazo            |
| ------------------------------ | ---------------- |
| Abertura da OS                 | **+2 dias**      |
| Entrada em Aguardando Conserto | **+3 dias**      |
| Demais estados                 | mantém o vigente |
| Finalizada / Cancelada         | encerra          |

**Dias corridos.** A Constituição fixa +2 e +3 e não menciona dias úteis;
inventar um calendário de feriados seria criar regra que ninguém pediu — e
calendário errado atrasa atendimento de verdade. Fica documentado como escolha
revisável quando houver decisão de negócio.

Onde a regra não define prazo, o vigente é **mantido** em vez de um número
inventado. O prazo continua ajustável à mão por quem acompanha a ordem.

## Por que data civil, e não timestamp

"+2 dias" não é um instante: é um **dia inteiro** no fuso de quem opera. Guardar
como timestamp produz o bug clássico de a data virar para o dia anterior
conforme o servidor — e uma OS que vence "hoje" para o banco e "ontem" para o
atendente perde exatamente o propósito do prazo.

Por isso `follow_up_at` é `VARCHAR(10)` com ISO `YYYY-MM-DD`, e toda conversão
passa pelo fuso do tenant explicitamente ([ADR-017](../../adr/ADR-017-datas-e-timezone.md),
[`src/core/time/civil-date.ts`](../../../src/core/time/civil-date.ts)).

Uma empresa em São Paulo e outra em Manaus viram a data em horas diferentes.
Usar UTC para as duas marcaria uma delas um dia antes ou depois do que o
atendente vê na tela.

## Onde as pendências aparecem

Na listagem de Ordens de Serviço da unidade ativa, como **painel** — nunca modal
bloqueante. Quem abre essa tela costuma ter um cliente na frente, e obrigar a
fechar um aviso antes de buscar a OS dele atrapalha o atendimento.

O painel responde só duas perguntas: **o que venceu** e **o que vence hoje**,
aqui. Não é a Central de Trabalho (Prompt 15): não há priorização, carga por
técnico nem visão multiunidade.

`loadPendingWork` é uma **consulta ao banco**, não uma tabela de alertas
materializada. Alerta materializado sai do ar quando o job atrasa, e a resposta
certa para "o que venceu?" é sempre a que o banco tem agora.

## O job

`service-order.follow-up-sweep`, de hora em hora.

De hora em hora, e não uma vez por dia: empresas em fusos diferentes viram a
data em horas diferentes, e o job precisa alcançar cada uma logo depois da
virada dela. Como é idempotente, as execuções a mais não custam nada.

**O que ele faz:** percorre as empresas ativas, cada uma no seu fuso, e publica
um evento `SERVICE_ORDER_FOLLOW_UP_OVERDUE` por ordem recém-vencida.

**O que ele NÃO faz:** avisar alguém. Não há canal de comunicação no sistema
(Prompt 16) nem central de notificação interna. O evento fica no outbox à espera
de quem um dia vá reagir — inclusive a notificação ao administrador prevista na
Constituição, que **hoje não existe como canal**.

**A visibilidade das pendências não depende dele.** A tela consulta o banco
direto. Se o job parar, a lista continua correta; o que se perde é o evento.

## Idempotência sem tabela de alertas

A ordem guarda `follow_up_alerted_for`: o prazo para o qual o alerta já saiu. O
`UPDATE` que marca a linha carrega a condição no próprio `WHERE`:

```sql
UPDATE service_orders
   SET follow_up_alerted_for = :prazo
 WHERE id = :id AND tenant_id = :tenant
   AND follow_up_at = :prazo
   AND (follow_up_alerted_for IS NULL OR follow_up_alerted_for <> follow_up_at)
```

Duas execuções simultâneas não emitem dois eventos — a segunda não encontra
linha para marcar, e sem linha afetada o evento não é publicado.

Reagendar o follow-up limpa a marca, e um **prazo novo merece um alerta novo**.

Coberto por teste: rodar três vezes seguidas emite um evento; duas execuções
realmente simultâneas emitem um evento; reagendar para outro prazo vencido emite
o segundo.

## A regra vive no código, não no cron

O cron da hospedagem chama um comando só (`npm run jobs:run`). A periodicidade
lógica está declarada em `RECURRING_JOBS`, e o que significa "vencido" está no
job. Cron não é lugar de regra de negócio.

## Migração

A migration 0006 é **aditiva**. Ordens já existentes entram no workflow com
`version = 1`, `follow_up_at` nulo e nenhum follow-up retroativo: uma OS parada
há meses não deve aparecer "vencida" no dia do deploy só porque a coluna passou
a existir. Coberto por teste de upgrade 07 → 08.
