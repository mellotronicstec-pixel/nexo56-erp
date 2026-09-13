# Fronteira entre entidade e workflow

```
Prompt 07 = o que a Ordem de Serviço É.
Prompt 08 = como a Ordem de Serviço MUDA DE ESTADO.
```

Esta fronteira foi **atravessada no Prompt 08**, e sem reescrever o Prompt 07. O
documento fica como registro de que a separação valeu a pena — e do que ela
custou (nada).

## O que o Prompt 07 deixou pronto, e foi usado como estava

| Precisava de                              | Já existia                                          | Precisou mudar? |
| ----------------------------------------- | --------------------------------------------------- | --------------- |
| Coluna de estado que aceite novos valores | `status varchar(40)`                                | **não**         |
| Índice para filtrar por estado            | `ix_service_order_tenant_status`                    | **não**         |
| Linha do tempo para registrar transições  | `service_order_timeline`, `kind` livre, append-only | **não**         |
| Eventos no outbox                         | padrão `runInTransaction(… emit)`                   | **não**         |
| Auditoria transacional                    | `recordAudit(…, tx)`                                | **não**         |
| Autorização por unidade                   | escopo de unidade já em uso                         | **não**         |
| Camada de aplicação reutilizável          | serviços fora dos componentes                       | **não**         |

O `status` como `varchar` (e não `enum`) foi a decisão que mais pagou: os oito
estados novos entraram **sem um único `ALTER TABLE … MODIFY`**, e a migration
0006 é puramente aditiva.

## O que o Prompt 08 acrescentou

- os oito estados restantes e a matriz de transições
  ([workflow.md](workflow.md));
- as ações de negócio — atribuir técnico, reagendar acompanhamento, Buscar Peça,
  Informar Ordem Disponível, concluir tarefa, cancelar
  ([workflow.md](workflow.md), [tasks.md](tasks.md));
- follow-ups com data civil e o job de varredura ([follow-ups.md](follow-ups.md));
- tarefas de fluxo com idempotência no banco ([tasks.md](tasks.md));
- concorrência otimista por `version`;
- seis permissões, seis tipos de evento, sete ações de auditoria, seis `kind`
  novos de linha do tempo;
- os filtros de workflow na listagem e o painel de pendências da unidade.

Nenhuma migration destrutiva. Nenhuma reescrita do domínio da OS. A entidade do
Prompt 07 continua exatamente como estava — ganhou colunas, não perdeu nenhuma.

## A trava que mudou de forma

O Prompt 07 tinha um teste que **falhava se alguém acrescentasse um segundo
estado**. Era uma trava deliberada contra antecipar a máquina de estados pela
porta dos fundos, e cumpriu o papel: o Prompt 08 foi quem a removeu, no momento
certo, substituindo-a por travas mais fortes.

O que ficou no lugar:

- a lista de estados é exatamente a declarada, sem inventar nem faltar;
- **nenhum estado é uma ação** — `buscar_peca`, `enviar_orcamento`,
  `informar_disponivel`, `part_pickup` e `notify_customer` não existem como
  estado, e o teste falha se aparecerem;
- a matriz de transições é conferida linha a linha contra uma cópia escrita à
  mão no teste: qualquer atalho novo quebra a suíte;
- `awaiting_delivery_preparation → awaiting_customer_pickup` não aparece no
  seletor genérico de situação.

## Classificação e ordens relacionadas

Continuam **deliberadamente não criadas**:

- **Classificação** (atendimento normal, garantia interna, garantia de fábrica,
  retorno) — Prompt 13. Entra como coluna aditiva `classification` com padrão
  `standard`.
- **Ordem relacionada** (retorno em garantia apontando para a OS original) —
  entra como `related_service_order_id` com FK composta auto-referente a
  `uq_service_order_id_tenant`, que já existe.

As duas são `ALTER TABLE … ADD COLUMN` puros. Estado e classificação continuam
sendo coisas diferentes: uma OS de garantia percorre os **mesmos** estados de
uma OS comum.

## A próxima fronteira

[Fronteira com o Prompt 09 — Orçamentos](quote-boundary.md).
