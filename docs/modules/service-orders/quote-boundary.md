# Fronteira com o Prompt 09 — Orçamentos

```
Prompt 08 = como a Ordem de Serviço muda de ESTADO.
Prompt 09 = quanto custa, o que o cliente APROVA, e o que isso faz com o estado.
```

## O que existe hoje, e é só isso

**O estado `awaiting_approval`, e nada mais.**

```ts
{
  from: 'awaiting_technical_opinion',
  to: 'awaiting_approval',
  label: 'Enviar para aprovacao',
  permission: PERMISSIONS.SERVICE_ORDERS_TRANSITION,
  hint: 'O cliente precisa aprovar antes do conserto.',
}
```

O estado existe porque o fluxo de uma assistência passa por ele — o técnico dá
o parecer, há custo, o cliente decide. **O orçamento em si não existe**: não há
tabela de itens, não há valor, não há aprovação registrada, não há link para o
cliente, não há histórico de versões do orçamento.

"Registrar aprovação" hoje é uma transição manual de `awaiting_approval` para
`awaiting_repair`, executada por quem falou com o cliente. Ela registra **que**
foi aprovado, não **o que** foi aprovado.

## O que o Prompt 09 encontra pronto

| Precisa de                               | Já existe                                                       |
| ---------------------------------------- | --------------------------------------------------------------- |
| Estado de espera pela decisão do cliente | `awaiting_approval`, com entrada e saída na matriz              |
| Único ponto onde o estado muda           | `transitionServiceOrder`                                        |
| Concorrência protegida                   | `version` + compare-and-swap                                    |
| Linha do tempo com `kind` livre          | `service_order_timeline`                                        |
| Motivo textual em transições             | `service_order_timeline.reason`                                 |
| Eventos no outbox                        | `SERVICE_ORDER_STATUS_CHANGED` com `from`/`to`/`via`            |
| Auditoria transacional                   | `recordAudit(…, tx)`                                            |
| Autorização na unidade da ordem          | `authorize(…, { unitId: order.unitId })`                        |
| Tarefas operacionais ligadas à OS        | `service_order_tasks`, `kind` livre                             |
| Follow-up para cobrar o cliente          | `follow_up_at` + job de varredura                               |
| Tipo de dinheiro                         | [ADR-014](../../adr/ADR-014-dinheiro.md) — inteiros em centavos |
| Numeração humana por tenant              | `tenant_sequences` (aceita um novo `sequence_type`)             |

## O que o Prompt 09 vai precisar acrescentar

- a entidade Orçamento (itens, valores, versão, validade);
- a aprovação como fato registrado, com quem aprovou e por qual canal;
- a **recusa** do orçamento, que hoje não tem estado: uma OS recusada
  provavelmente vai para cancelamento ou para devolução sem conserto, e essa
  decisão é do Prompt 09;
- a ação que dispara a transição `awaiting_approval → awaiting_repair` a partir
  de uma aprovação real, substituindo a transição manual;
- possivelmente marcar essa transição como `actionOnly`, do mesmo jeito que
  "Informar Ordem Disponível" — é a mudança mais provável na matriz, e ela é uma
  linha de código.

## O que NÃO foi antecipado — e por quê

| Não existe                      | Por quê                                                     |
| ------------------------------- | ----------------------------------------------------------- |
| Tabela de orçamento ou de itens | Prompt 09                                                   |
| Qualquer valor monetário na OS  | Prompt 09; nem coluna vazia                                 |
| Aprovação/recusa como registro  | Prompt 09                                                   |
| Peça como entidade              | Prompt 10 — "Buscar Peça" guarda **texto livre**            |
| Fornecedor, local de retirada   | Prompts 10 e 11                                             |
| Movimento financeiro            | Prompt 12                                                   |
| Garantia                        | Prompt 13                                                   |
| Envio de WhatsApp/e-mail        | Prompt 16 — a ação registra intenção e **diz isso**         |
| Central de Trabalho             | Prompt 15 — o painel é só "venceu / vence hoje", na unidade |
| Automações                      | Prompt 19 — o job só publica evento                         |

Verificado: a ficha da OS não contém "Enviar orçamento", "Aprovar orçamento",
"Valor", "Peça" como entidade, nem aba vazia de nenhum dos módulos acima.

## O risco desta fronteira

O orçamento é o primeiro módulo que vai **querer mudar o estado da OS**. A regra
que o Prompt 08 estabelece e que o Prompt 09 precisa respeitar:

> Nenhum módulo escreve `status` diretamente. Quem precisa mover a ordem chama
> `transitionServiceOrder`, e a transição precisa existir na matriz.

Se o Prompt 09 aprovar um orçamento com um `UPDATE service_orders SET status`,
a OS passa a ter duas autoridades sobre o próprio estado — e a partir daí o
histórico deixa de ser confiável.
