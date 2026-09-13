# ADR-038 — Concorrência na Ordem de Serviço é resolvida por versão, não por último a gravar

**Status:** Aceito · **Data:** Prompt 08

## Contexto

A Ordem de Serviço é o primeiro registro do Nexo56 em que **duas pessoas mexem
ao mesmo tempo, de propósito**. O técnico na bancada marca "falta peça"; o
atendente no balcão, olhando a mesma OS aberta há dez minutos, marca "reparo
concluído".

Sem trava, a segunda gravação apaga a primeira **em silêncio**. Pior: as duas
entram na linha do tempo, então o histórico registra que ambas aconteceram, e
ninguém consegue explicar, uma semana depois, por que o aparelho foi para o
balcão sem a peça.

O mesmo vale para o duplo clique — no celular, com conexão instável, o botão de
transição é apertado duas vezes com frequência.

## Decisão

A coluna `service_orders.version` (inteiro, começa em 1) sobe a cada transição.

A tela envia no formulário a **versão que leu**. A gravação é um
compare-and-swap:

```sql
UPDATE service_orders
   SET status = :novo, version = :versao + 1, …
 WHERE tenant_id = :tenant AND id = :id
   AND status  = :lido            -- o estado que a pessoa viu
   AND version = :esperada        -- a versão que a pessoa viu
```

Zero linhas afetadas significa que alguém gravou no intervalo. A transação
inteira volta atrás — nenhum evento publicado, nenhuma linha na linha do tempo,
nenhuma tarefa criada — e a pessoa recebe:

> Esta Ordem de Serviço foi alterada por outra pessoa enquanto você trabalhava
> nela. Recarregue a página e tente de novo.

`expectedVersion` é **opcional**. Chamadas de sistema — um job, a futura API —
não têm tela para ler versão e aceitam o estado atual; nesses casos o `WHERE`
usa a versão lida no próprio pedido, o que ainda barra a corrida contra uma
gravação concorrente.

As tarefas usam a mesma ideia em forma menor: `WHERE status = 'open'` no
`UPDATE` de conclusão, para que dois cliques não produzam duas conclusões.

## Motivo

**Por que não `updated_at`.** Comparar timestamps exige confiar na precisão do
relógio e falha quando duas gravações caem no mesmo milissegundo — que é
exatamente o caso do duplo clique. Um inteiro que só sobe é exato e não depende
de relógio nenhum.

**Por que não bloqueio pessimista (`SELECT … FOR UPDATE` mantido enquanto a tela
está aberta).** Travaria a linha por minutos, com uma pessoa segurando a OS
enquanto atende o telefone. Numa assistência isso para a bancada.

**Por que não "último a gravar vence".** É o comportamento padrão, e é o
problema — perda silenciosa de decisão.

**Por que a condição inclui o `status` além da `version`.** Redundante em
teoria, barato na prática, e protege contra qualquer caminho futuro que mexa em
`version` sem passar pela transição.

## Consequências

- Todo formulário de transição carrega `expectedVersion` num campo oculto.
- Conflito é uma mensagem em português, não um erro técnico nem um 500.
- Coberto por teste com duas transições **realmente simultâneas** a partir do
  mesmo estado: exatamente uma vence, uma única entrada aparece na linha do
  tempo e a versão sobe uma vez só.
- A leitura de "linhas afetadas" foi centralizada em
  [`src/core/db/affected-rows.ts`](../../src/core/db/affected-rows.ts): o driver
  devolve `[ResultSetHeader, FieldPacket[]]`, e ler `.affectedRows` sem o `[0]`
  devolve `undefined` — que, tratado como zero, faz a trava recusar **todas** as
  gravações, inclusive as legítimas. O erro não aparece em typecheck; foi
  encontrado por teste nesta etapa e agora mora num lugar só, com teste próprio.

## Alternativas descartadas

**Versão por campo (uma coluna por atributo).** Precisão que ninguém pediu, ao
custo de uma coluna nova a cada campo editável.

**Merge automático das duas gravações.** "Falta peça" e "reparo concluído" são
afirmações contraditórias sobre o mesmo aparelho; combiná-las produziria um
estado que ninguém escolheu.

**Travar só a transição, deixando atribuição e follow-up livres.** Foi o que se
fez, e é deliberado: atribuir técnico e reagendar acompanhamento não são
mutuamente exclusivos — duas pessoas fazendo as duas coisas ao mesmo tempo não
produzem contradição, e exigir versão ali só criaria conflito onde não há.
