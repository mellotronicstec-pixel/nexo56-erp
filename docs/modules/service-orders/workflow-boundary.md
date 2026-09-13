# Fronteira com o Prompt 08

```
Prompt 07 = o que a Ordem de Serviço É.
Prompt 08 = como a Ordem de Serviço MUDA DE ESTADO.
```

## O que foi implementado de estado

**Um único valor, nenhuma transição.**

```ts
export const SERVICE_ORDER_INITIAL_STATUS = 'awaiting_technical_opinion';

export const SERVICE_ORDER_STATUS_LABEL = {
  [SERVICE_ORDER_INITIAL_STATUS]: 'Aguardando parecer tecnico',
};
```

A coluna `status` existe porque a entidade precisa dela para funcionar, e o
valor inicial é o que a Constituição prevê para uma OS comum. **Nada mais**: não
há função de transição, não há ação que altere o estado, não há regra que
dependa dele, não há `if (status === …)` em lugar nenhum além do rótulo do
badge.

Há teste que falha se alguém acrescentar um segundo estado a esse registro — é
uma trava deliberada contra antecipar a máquina de estados pela porta dos
fundos.

Também há teste verificando que **nenhum estado é uma ação**: `buscar_peca`,
`enviar_orcamento` e `informar_disponivel` não existem como estado.

## O que o Prompt 08 encontra pronto

| Precisa de                                | Já existe                                           |
| ----------------------------------------- | --------------------------------------------------- |
| Coluna de estado que aceite novos valores | `status varchar(40)` — sem `ALTER`                  |
| Índice para filtrar por estado            | `ix_service_order_tenant_status`                    |
| Linha do tempo para registrar transições  | `service_order_timeline`, `kind` livre, append-only |
| Eventos no outbox                         | `SERVICE_ORDER_CREATED`, `SERVICE_ORDER_UPDATED`    |
| Auditoria transacional                    | `recordAudit(…, tx)` já no caminho de escrita       |
| Autorização por unidade                   | `requireUnitAuthorization` já em uso                |
| Camada de aplicação reutilizável          | serviços fora dos componentes                       |

## O que o Prompt 08 vai precisar acrescentar

- os demais estados e as transições válidas entre eles;
- as ações (enviar orçamento, buscar peça, informar disponível, concluir,
  finalizar, cancelar) com as permissões correspondentes;
- follow-ups, tarefas automáticas e notificações;
- preparação para entrega;
- os filtros de workflow na listagem;
- os `kind` novos da linha do tempo.

Nada disso exige migration destrutiva nem reescrita do domínio da OS.

## O que NÃO foi antecipado

Nenhuma transição, nenhuma ação de workflow, nenhuma automação, nenhum botão sem
backend, nenhuma aba vazia. Verificado em navegador real: a ficha não contém
"Enviar orçamento", "Buscar peça", "Concluir reparo", "Informar disponível" nem
"Finalizar".

## Classificação e ordens relacionadas

Duas extensões previstas e **deliberadamente não criadas**:

- **Classificação** (atendimento normal, garantia interna, garantia de fábrica,
  retorno) — Prompt 13. Entra como coluna aditiva `classification` com padrão
  `standard`.
- **Ordem relacionada** (retorno em garantia apontando para a OS original) —
  entra como `related_service_order_id` com FK composta auto-referente a
  `uq_service_order_id_tenant`, que já existe.

As duas são `ALTER TABLE … ADD COLUMN` puros. Criá-las agora, sem caso de uso,
produziria colunas que ninguém preenche e que a interface teria de fingir
entender.
