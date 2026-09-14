# Orçamentos

A proposta comercial de uma Ordem de Serviço: o que será feito, quanto custa, e
o que o cliente decidiu sobre isso.

Decisões: [ADR-040](../../adr/ADR-040-orcamento-pertence-a-ordem-de-servico.md),
[ADR-041](../../adr/ADR-041-estrategia-de-revisao-de-orcamento.md),
[ADR-042](../../adr/ADR-042-fronteira-orcamento-workflow.md).

## Índice

- [Modelo de dados](model.md)
- [Dinheiro, cálculo e arredondamento](money.md)
- [Ciclo de vida](lifecycle.md)
- [Revisões e imutabilidade](revisions.md)
- [Integração com o workflow da OS](workflow-integration.md)
- [Permissões, auditoria e eventos](permissions.md)
- [12 perguntas de modularidade](modularity.md)
- [Segurança](security.md)
- [Fronteira com os próximos módulos](future-integrations.md)

## A decisão que define o módulo

**O orçamento pertence à Ordem de Serviço — e, por ela, à unidade.**

```
Tenant ──< Cliente ──< Equipamento              (atravessam as lojas)
                            │
                            └──< Ordem de Serviço >── Unidade
                                        │
                                        └──< Orçamento >── Unidade (herdada)
```

Não existe orçamento avulso do tenant. Cliente e equipamento **não se repetem**
aqui: são lidos da OS, porque copiar criaria duas verdades sobre o mesmo
atendimento.

## As três coisas que este módulo mantém separadas

| Quem decide        | O quê                          | Onde vive                       |
| ------------------ | ------------------------------ | ------------------------------- |
| **Orçamento**      | valores e a decisão do cliente | `modules/quotes`                |
| **Workflow da OS** | o estado da Ordem de Serviço   | `modules/service-orders`        |
| **Estoque**        | peça como item real            | `modules/inventory` (Prompt 10) |

O orçamento **nunca** escreve `service_orders.status`. Quando precisa mover a
OS, pede ao workflow do Prompt 08 — e faz isso dentro da mesma transação. Ver
[workflow-integration](workflow-integration.md) e
[ADR-042](../../adr/ADR-042-fronteira-orcamento-workflow.md).

## O fluxo completo

```
     RASCUNHO ──enviar──> ENVIADO ──aprovar──> APROVADO
        │                    │
        │                    ├─recusar──> RECUSADO
    descartar                ├─cancelar─> CANCELADO
        │                    ├─(prazo)──> EXPIRADO
        v                    └─(revisão)> SUBSTITUÍDO
    CANCELADO
```

Cada uma dessas mudanças é um fato registrado: entra na linha do tempo do
orçamento, na auditoria e no outbox de eventos.

**Apenas duas delas mexem na Ordem de Serviço**, e as duas pelo workflow:

| Ação do orçamento   | Ordem de Serviço                                      |
| ------------------- | ----------------------------------------------------- |
| Enviar              | Aguardando Parecer Técnico → **Aguardando Aprovação** |
| Registrar aprovação | Aguardando Aprovação → **Aguardando Conserto**        |
| Registrar recusa    | **não muda** — ver [lifecycle](lifecycle.md)          |
| Cancelar / expirar  | **não muda**                                          |

## O que "enviar" quer dizer aqui

**Formalizar a proposta.** Não há WhatsApp nem e-mail integrado — isso é o
Prompt 16. O que acontece ao enviar:

- o orçamento passa a `sent`, com data e autor;
- a OS vai para Aguardando Aprovação;
- o evento `QUOTE_SENT` fica no outbox, com `delivered: false`.

A interface diz exatamente isso:

> Nada foi enviado automaticamente. O orçamento está formalizado no sistema.
> Não há WhatsApp nem e-mail integrado — avise o cliente pelo canal de sempre e
> registre aqui a resposta dele.

Escrever "mensagem enviada" faria o atendente parar de ligar para o cliente.

## Quem aprova

**A equipe registra a decisão que o cliente comunicou.** Não existe Portal
(Prompt 17), então a origem gravada é `internal` e a ficha mostra "Registrado
pela equipe", com o nome de quem registrou. Fingir que o cliente clicou num link
tornaria a trilha de auditoria inútil justamente no ponto em que ela importa.
