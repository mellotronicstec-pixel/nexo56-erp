# Histórico estrutural

## AuditLog ≠ linha do tempo

São duas coisas com perguntas diferentes:

|                          | Pergunta                            | Público                  |
| ------------------------ | ----------------------------------- | ------------------------ |
| `audit_logs`             | "quem alterou o quê, e quando"      | segurança e conformidade |
| `service_order_timeline` | "o que aconteceu com este aparelho" | operação                 |

Elas já divergem. A auditoria registra `service_order_task.cancelled` quando a
ordem é encerrada com tarefas abertas; a linha do tempo não — para a operação, o
fato é "ordem cancelada", e listar cada tarefa encerrada junto seria ruído.
Reaproveitar o AuditLog como narrativa de negócio significaria expor nome de
tabela e coluna a quem só quer acompanhar a ordem.

Por isso a linha do tempo é uma tabela própria, e não uma consulta sobre a
trilha de auditoria.

## Os fatos que existem hoje

| `kind`                            | Quando                                   | Prompt |
| --------------------------------- | ---------------------------------------- | ------ |
| `created`                         | a ordem foi aberta                       | 07     |
| `customer_report_updated`         | o relato do cliente foi corrigido        | 07     |
| `details_updated`                 | as observações internas foram corrigidas | 07     |
| `status_changed`                  | a ordem mudou de situação                | 08     |
| `technician_assigned`             | responsável definido ou removido         | 08     |
| `follow_up_rescheduled`           | acompanhamento reagendado ou encerrado   | 08     |
| `part_pickup_requested`           | busca de peça registrada                 | 08     |
| `task_completed`                  | tarefa do fluxo concluída                | 08     |
| `customer_notification_requested` | "Informar Ordem Disponível"              | 08     |

**Nada além disso.** A ficha mostra o que aconteceu de verdade; não há
"em breve" nem evento futuro inventado. Há teste que falha se a lista declarada
ganhar um `kind` que o código nunca escreve.

## O Prompt 08 entrou sem migration — como previsto

`kind` é `varchar`, a tabela é append-only e `metadata` é JSON. Os seis fatos
novos são **linhas**, não colunas.

A única mudança estrutural foi `reason varchar(300)`, acrescentado porque a
justificativa escrita de uma transição é do fato — misturá-la ao `summary`
tiraria a possibilidade de exibir as duas coisas separadamente, e enfiá-la no
`metadata` esconderia texto humano dentro de um campo técnico.

`metadata` guarda só chaves técnicas: `{ from, to, via }` numa transição,
`{ taskId, kind }` numa conclusão de tarefa.

### O texto diz a verdade

A entrada de `customer_notification_requested` é:

> Cliente marcado como avisado. O envio automático ainda não está disponível.

Não há WhatsApp nem e-mail integrado (Prompt 16). Escrever "mensagem enviada"
faria o atendente parar de ligar para o cliente.

## Privacidade

Nem `summary` nem `metadata` carregam o relato do cliente. Há teste que abre uma
ordem com uma frase reconhecível no relato e falha se ela aparecer na linha do
tempo.

A **exceção consciente** está na auditoria, não aqui: quando o relato é
corrigido, o texto **anterior** vai por inteiro para `audit_logs.before`. Sem
ele, "relato alterado" não permitiria reconstruir o que o cliente havia dito — e
a trilha já é área de acesso restrito, com `redact()` neutralizando segredo e
documento.
