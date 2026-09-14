# Integração com o workflow da Ordem de Serviço

> A regra do Prompt 08: **nenhum módulo escreve `service_orders.status`.** O
> Prompt 09 é o primeiro a precisar mover a OS — e a respeitar isso.

## Como funciona

O módulo de orçamentos **não** tem `update(serviceOrders)` em lugar nenhum. Ele
chama o workflow:

```ts
const plan = await planTransition(context, { serviceOrderId, to, via });
// … na transação do orçamento:
await applyTransition(tx, emit, context, plan, now);
```

## Por que na mesma transação

A forma óbvia seria: gravar o orçamento como enviado numa transação e chamar
`transitionServiceOrder` em outra. Isso cria um intervalo em que existe uma
proposta "enviada" com a OS parada. Se a segunda falhar — permissão, estado
incompatível, queda de rede — ninguém sabe qual das duas verdades vale, e o
conserto para esperando um estado que nunca vai chegar.

Uma transação só: **ou as duas coisas acontecem, ou nenhuma.**

Para isso, o Prompt 09 dividiu `transitionServiceOrder` em duas metades, sem
mudar o comportamento público:

| Função                   | O que faz                                            |
| ------------------------ | ---------------------------------------------------- |
| `planTransition`         | valida a matriz e **autoriza**, sem gravar nada      |
| `applyTransition`        | grava, na transação de quem chamou                   |
| `transitionServiceOrder` | as duas, em transação própria — a porta da interface |

`applyTransition` continua sendo **o único lugar do sistema que escreve
`service_orders.status`**.

## A ordem importa

`planTransition` roda **antes** de qualquer gravação do orçamento. Se a OS
estiver num estado incompatível, ou se a pessoa não puder movê-la, a recusa
chega antes de o orçamento mudar de situação — nada fica pela metade.

Coberto por teste: com a OS em Aguardando Conserto, enviar o orçamento falha, o
orçamento continua `draft`, a OS continua onde estava e nenhum evento é
publicado.

## O mapa

| Ação do orçamento   | OS: de → para                                     | `via`            |
| ------------------- | ------------------------------------------------- | ---------------- |
| Enviar              | Aguardando Parecer Técnico → Aguardando Aprovação | `quote_sent`     |
| Registrar aprovação | Aguardando Aprovação → Aguardando Conserto        | `quote_approved` |
| Registrar recusa    | — não move                                        | —                |
| Cancelar / expirar  | — não move                                        | —                |

O campo `via` fica no payload do evento e no `metadata` da linha do tempo da OS:
meses depois dá para saber que aquela transição veio de um orçamento, e de qual.

## Enviar também exige poder mover a OS

Enviar o orçamento **move** a Ordem de Serviço. Quem não tem
`service_orders.transition` não pode provocar essa mudança por um caminho
lateral — e como a autorização acontece no `planTransition`, a recusa não deixa
meio caminho andado.

Isso significa que quem envia orçamento precisa de **duas** permissões:
`quotes.send` e `service_orders.transition`. É deliberado: a segunda descreve o
que de fato acontece.

## Já estar no destino não é erro

Depois de uma recusa, a OS continua em Aguardando Aprovação. Enviar a revisão
não precisa mover nada — e a transição é **pulada**, não repetida. Repeti-la
geraria um segundo fato idêntico na linha do tempo do aparelho.

## O que aparece na ficha da OS

Um **fato resumido**, não o extrato do orçamento:

> Orçamento ORC #000045 enviado (309.90)

O detalhe — quais itens, quanto cada um — vive na linha do tempo do orçamento.
Copiar cada alteração de item para a ficha da OS transformaria o histórico do
aparelho num registro de digitação. Coberto por teste: a descrição dos itens
**não** aparece na timeline da OS.

## A trava arquitetural

`tests/unit/quote-workflow-boundary.test.ts` varre `src/` inteiro e falha se:

- qualquer arquivo fora do `workflow-service.ts` fizer `update(serviceOrders)`
  com `status`;
- qualquer SQL cru fora dele alterar `service_orders.status`;
- o módulo de orçamentos tocar na tabela de OS para escrita;
- o `quote-service.ts` deixar de usar `planTransition`/`applyTransition`;
- o job de expiração encostar na OS.

Um teste de comportamento prova que o caminho feliz respeita a regra. Este
impede que, daqui a seis meses, alguém resolva um bug com um `UPDATE` direto.
