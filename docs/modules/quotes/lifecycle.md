# Ciclo de vida do orçamento

## As sete situações

| Chave        | Rótulo      | Proposta viva? | Terminal? |
| ------------ | ----------- | -------------- | --------- |
| `draft`      | Rascunho    | **sim**        | não       |
| `sent`       | Enviado     | **sim**        | não       |
| `approved`   | Aprovado    | não            | **sim**   |
| `rejected`   | Recusado    | não            | **sim**   |
| `expired`    | Expirado    | não            | **sim**   |
| `superseded` | Substituído | não            | **sim**   |
| `cancelled`  | Cancelado   | não            | **sim**   |

Todo orçamento nasce **Rascunho**. Criar um orçamento **não** muda a situação da
Ordem de Serviço: rascunho é trabalho interno.

## Situação do orçamento ≠ situação da OS

São duas máquinas de estado distintas, sobre duas entidades distintas:

```
Orçamento: ENVIADO          Ordem de Serviço: AGUARDANDO APROVAÇÃO
Orçamento: APROVADO         Ordem de Serviço: AGUARDANDO CONSERTO
Orçamento: RECUSADO         Ordem de Serviço: AGUARDANDO APROVAÇÃO  ← não mudou
```

Uma OS pode não ter orçamento nenhum. Há teste que falha se um estado de OS
aparecer na lista de situações de orçamento.

## A matriz

Tudo que não está aqui é proibido.

```
draft ──enviar────────> sent
      └─descartar─────> cancelled

sent  ──aprovar───────> approved
      ├─recusar───────> rejected      (motivo obrigatório)
      ├─cancelar──────> cancelled     (motivo obrigatório)
      └─(prazo vence)─> expired       (só o job)

(revisão nascendo)────> superseded    (consequência, não decisão)
```

`superseded` **não é destino de botão nenhum**: ninguém "substitui" um
orçamento à mão — quem o produz é `reviseQuote`. `expired` também não aparece
como botão: quem expira é o prazo.

Descartar um rascunho que ninguém viu não exige motivo. Retirar uma proposta que
o cliente já recebeu, sim.

## Enviar

**Formaliza** a proposta. Exige ao menos um item — enviar proposta vazia não é
caso de uso, é clique antes da hora.

O que acontece, numa transação só:

1. o orçamento passa a `sent`, com `sent_at` e `sent_by`;
2. a OS vai para Aguardando Aprovação, **pelo workflow do Prompt 08**;
3. linha do tempo do orçamento + fato resumido na OS + auditoria;
4. evento `QUOTE_SENT` com `delivered: false`.

**Nenhuma mensagem é enviada.** Ver [overview](overview.md).

Se a OS **já** estiver em Aguardando Aprovação — o caso de enviar uma revisão
depois de uma recusa — a transição é pulada. Repeti-la geraria um segundo fato
idêntico na linha do tempo.

Se a OS estiver num estado **incompatível** (Aguardando Conserto, por exemplo),
o envio é recusado com erro de domínio em português e **nada é gravado**: o
orçamento não fica "enviado" com a OS parada.

## Aprovar

Registra a decisão do cliente e leva a OS para Aguardando Conserto, pelo
workflow. Grava `decided_at`, `decided_by` e `decision_source = internal`.

O total aprovado fica **congelado**: os itens e os valores daquela versão não
mudam mais. Ver [revisions](revisions.md).

## Recusar

Registra a recusa com **motivo obrigatório**, que fica visível no histórico.

**A Ordem de Serviço não é cancelada.** Recusar o orçamento é uma decisão
comercial; o que fazer com o aparelho — devolver, propor outro valor, encerrar —
é outra, e não existe regra oficial ligando as duas. Um cancelamento automático
encerraria atendimentos que a loja ainda estava negociando.

A OS segue em Aguardando Aprovação, esperando uma revisão ou uma decisão humana.

## Cancelar o orçamento ≠ cancelar a OS

São entidades diferentes. Cancelar a proposta não tira o aparelho da bancada, e
a OS não muda de situação.

## Validade e expiração

`valid_until` é uma **data civil** no fuso da empresa, e é **opcional**. Não há
prazo padrão: inventar um seria criar regra que ninguém pediu. A interface diz
"Opcional. Não há prazo padrão definido."

O job `quote.expire-overdue` roda de hora em hora — de hora em hora, e não uma
vez por dia, porque empresas em fusos diferentes viram a data em horas
diferentes.

**O que ele faz:** um orçamento `sent` cujo prazo passou vira `expired`,
liberando o lugar de proposta viva para uma revisão. Publica `QUOTE_EXPIRED`.

**O que ele não faz:**

- não cancela nem move a Ordem de Serviço — o prazo comercial venceu, o aparelho
  continua na bancada;
- não avisa ninguém — não há canal (Prompt 16);
- não toca em orçamento sem validade, em rascunho, nem em proposta já decidida.

"Vence hoje" ainda não venceu: o prazo vale o dia inteiro.

**Idempotente:** a condição `status = 'sent'` vai no próprio `WHERE` do
`UPDATE`. Duas execuções simultâneas produzem um evento só, e se alguém aprovou
entre a leitura e a gravação, a decisão da pessoa vence a do relógio.

## Concorrência

Coluna `version` + compare-and-swap, mesmo padrão da OS (Prompt 08, ADR-038):

```sql
UPDATE quotes SET … WHERE id = ? AND status = ? AND version = ?
```

Zero linhas afetadas ⇒ alguém gravou no intervalo ⇒ a transação inteira volta
atrás e a pessoa recebe:

> Este orçamento foi alterado por outra pessoa enquanto você trabalhava nele.
> Recarregue a página e tente de novo.

Coberto por teste com **duas aprovações simultâneas**: exatamente uma vence, a
OS se move uma vez só, e um único fato aparece na linha do tempo.
