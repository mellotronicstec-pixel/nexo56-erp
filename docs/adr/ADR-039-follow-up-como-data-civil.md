# ADR-039 — Follow-up é data civil na própria ordem, e pendência é consulta

**Status:** Aceito · **Data:** Prompt 08

## Contexto

"Nenhuma Ordem de Serviço importante deve ser esquecida." A regra fixa dois
prazos: **+2 dias** na abertura e **+3 dias** ao entrar em Aguardando Conserto.

Três decisões precisavam ser tomadas juntas, porque uma condiciona a outra:

1. **Como guardar o prazo** — instante ou dia?
2. **Onde guardar** — na ordem, ou numa tabela de lembretes?
3. **Como a tela sabe o que venceu** — consultando, ou lendo o que um job
   escreveu?

## Decisão

**O prazo é uma data civil** (`VARCHAR(10)`, ISO `YYYY-MM-DD`), guardada **na
própria ordem** (`follow_up_at`), interpretada no fuso do tenant. Dias
**corridos**.

**As pendências da tela são uma consulta** (`loadPendingWork`), não uma tabela
de alertas materializada.

**O job (`service-order.follow-up-sweep`, de hora em hora) publica evento e nada
mais.** Ele marca `follow_up_alerted_for` e emite
`SERVICE_ORDER_FOLLOW_UP_OVERDUE` uma vez por prazo vencido.

## Motivo

**Data civil, não timestamp.** "+2 dias" não é um instante: é um dia inteiro no
fuso de quem opera. Guardar como timestamp produz o bug clássico de a data virar
para o dia anterior conforme o servidor — e uma OS que vence "hoje" para o banco
e "ontem" para o atendente perde exatamente o propósito do prazo. Uma empresa em
São Paulo e outra em Manaus viram a data em horas diferentes; usar UTC para as
duas marcaria uma delas um dia antes ou depois do que o atendente vê na tela.
Coerente com [ADR-017](ADR-017-datas-e-timezone.md).

**Dias corridos.** A regra fixa +2 e +3 e não menciona dias úteis. Inventar um
calendário de feriados seria criar regra que ninguém pediu — e calendário errado
atrasa atendimento de verdade. Fica documentado como escolha revisável.

**Na ordem, não em tabela de lembretes.** Uma ordem tem **um** próximo
acompanhamento; uma tabela permitiria vários, sem caso de uso, e transformaria
"qual é o prazo?" numa consulta com `ORDER BY`. A coluna também deixa o filtro e
o índice triviais.

**Pendência por consulta.** Alerta materializado sai do ar quando o job atrasa, e
a pergunta "o que venceu?" tem de ter a resposta que o banco tem **agora**. Com
consulta, parar o job não esconde nenhuma ordem da tela — o que se perde é o
evento, não a visibilidade.

**Job de hora em hora, não diário.** Empresas em fusos diferentes viram a data em
horas diferentes, e o job precisa alcançar cada uma logo depois da virada dela.
Como é idempotente, as execuções a mais não custam nada.

**Idempotência sem tabela de alertas.** `follow_up_alerted_for` guarda o prazo
para o qual o alerta já saiu, e a condição vai no próprio `WHERE` do `UPDATE`.
Duas execuções simultâneas não emitem dois eventos: a segunda não encontra linha
para marcar, e sem linha afetada o evento não é publicado. Reagendar limpa a
marca — prazo novo merece alerta novo.

**Onde a regra não define prazo, o vigente é mantido.** Inventar um número para
os demais estados seria criar política de negócio sem pedido.

## Consequências

- A migration é aditiva e **não cria follow-up retroativo**: ordens abertas
  antes do Prompt 08 entram com `follow_up_at` nulo. Uma OS parada há meses não
  deve aparecer "vencida" no dia do deploy só porque a coluna passou a existir.
- Finalizar e cancelar **limpam** o prazo: ordem encerrada não gera mais alerta.
- O painel de pendências é da **unidade ativa**, responde só "venceu / vence
  hoje", e é painel — nunca modal bloqueante. Não é a Central de Trabalho
  (Prompt 15): sem priorização, sem carga por técnico, sem visão multiunidade.
- **Ninguém é notificado.** Não há canal de comunicação (Prompt 16) nem central
  de notificação interna. O evento fica no outbox à espera de quem um dia vá
  reagir — inclusive a notificação ao administrador prevista na Constituição, que
  hoje não existe.
- O cron da hospedagem continua chamando um comando só; a periodicidade lógica
  está declarada em `RECURRING_JOBS`, e o significado de "vencido" mora no job.

## Alternativas descartadas

**`DATE` do MySQL em vez de texto ISO.** Funcionaria, mas o driver devolve
`Date`, e todo caminho de leitura voltaria a passar por fuso — exatamente o que a
decisão evita. Texto ISO compara, ordena e indexa igual, e não tem hora.

**Tabela `service_order_follow_ups` com histórico de prazos.** O histórico já
existe: reagendar entra na linha do tempo. A tabela só acrescentaria uma consulta.

**Tabela de alertas materializada.** Fica desatualizada exatamente quando mais
importa — quando o job está com problema.

**Job diário à meia-noite.** Meia-noite de quem? Com empresas em fusos
diferentes, um horário fixo atende bem uma e mal as outras.

**Dias úteis com calendário de feriados.** Regra que ninguém pediu, e um
calendário errado é pior do que nenhum.
