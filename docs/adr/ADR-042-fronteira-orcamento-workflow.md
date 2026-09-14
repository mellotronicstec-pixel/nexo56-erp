# ADR-042 — O orçamento move a OS pelo workflow, na mesma transação

**Status:** Aceito · **Data:** Prompt 09

## Contexto

O Prompt 08 estabeleceu que **`service_orders.status` muda num lugar só**. O
Prompt 09 é o primeiro módulo a precisar mover a Ordem de Serviço: enviar um
orçamento leva a OS para Aguardando Aprovação; aprovar leva para Aguardando
Conserto.

`transitionServiceOrder` abria a própria transação. Usá-lo do orçamento daria
duas transações:

```
T1: orçamento -> sent
T2: OS -> awaiting_approval
```

Entre as duas existe um intervalo. Se T2 falhar — permissão ausente, estado
incompatível, queda de rede — sobra uma proposta "enviada" com a OS parada.
Ninguém sabe qual das duas verdades vale, e o conserto espera um estado que
nunca vai chegar.

A saída fácil seria o orçamento gravar `status` ele mesmo, numa transação só.
É exatamente o que o Prompt 08 existe para impedir.

## Decisão

`transitionServiceOrder` foi **dividido em duas metades**, sem mudar o
comportamento público:

| Função                   | O que faz                                            |
| ------------------------ | ---------------------------------------------------- |
| `planTransition`         | valida a matriz e **autoriza** — não grava nada      |
| `applyTransition`        | grava, na transação **de quem chamou**               |
| `transitionServiceOrder` | as duas, em transação própria — a porta da interface |

O orçamento chama `planTransition` **antes** de abrir sua transação, e
`applyTransition` **dentro** dela.

`applyTransition` continua sendo o único lugar do sistema que escreve
`service_orders.status`.

## Motivo

**Por que não deixar o orçamento escrever o status.** Dois donos do mesmo campo
significa duas regras possíveis para a mesma pergunta, e a divergência só
aparece quando alguém já gravou o estado errado.

**Por que planejar antes de gravar.** A autorização e a regra de workflow
precisam ser respondidas **antes** de o orçamento mudar de situação. Assim, uma
OS em estado incompatível ou uma pessoa sem `service_orders.transition` produzem
recusa limpa, sem meio caminho andado.

**Por que não eventos.** O orçamento poderia publicar `QUOTE_SENT` e um handler
mover a OS. Isso desacopla, mas introduz uma janela em que a proposta está
enviada e a OS não se moveu — e nesse intervalo a tela mostra um estado que
contradiz o outro. Efeito que precisa ser atômico não pode depender de entrega.

**Por que exigir também `service_orders.transition`.** Enviar o orçamento **move
a OS**. Quem não pode conduzir o atendimento não deve provocar essa mudança por
um caminho lateral. A permissão descreve o que de fato acontece.

## Consequências

- Uma transação por ação: ou o orçamento muda **e** a OS se move, ou nada
  acontece.
- Quem envia orçamento precisa de duas permissões — documentado, e verificado
  por teste.
- Já estar no estado de destino **não é erro**: depois de uma recusa a OS segue
  em Aguardando Aprovação, e enviar a revisão pula a transição em vez de repetir
  o fato na linha do tempo.
- `transitionServiceOrder` continua igual para a interface: os 54 testes do
  Prompt 08 passaram sem alteração após o refactor.
- Existe um **teste arquitetural** varrendo `src/` que falha se qualquer arquivo
  fora do `workflow-service.ts` escrever `status` — por `update(serviceOrders)`
  ou por SQL cru.

## Alternativas descartadas

**Transação distribuída / saga com compensação.** Complexidade desproporcional
para duas escritas no mesmo banco.

**Handler de evento movendo a OS.** Janela de inconsistência visível na tela.

**Deixar o orçamento escrever `status` e confiar em revisão de código.** É a
regra que o Prompt 08 criou para não depender de disciplina.
