# Histórico estrutural

## AuditLog ≠ linha do tempo

São duas coisas com perguntas diferentes:

|                          | Pergunta                            | Público                  |
| ------------------------ | ----------------------------------- | ------------------------ |
| `audit_logs`             | "quem alterou o quê, e quando"      | segurança e conformidade |
| `service_order_timeline` | "o que aconteceu com este aparelho" | operação                 |

Hoje os dois quase coincidem, porque só existem dois fatos. Deixam de coincidir
no primeiro orçamento enviado ou peça encomendada — e reaproveitar o AuditLog
como narrativa de negócio significaria expor nome de tabela e coluna a quem só
quer acompanhar a ordem.

Por isso a linha do tempo é uma tabela própria, e não uma consulta sobre a
trilha de auditoria.

## Os fatos que existem hoje

| `kind`                    | Quando                                   |
| ------------------------- | ---------------------------------------- |
| `created`                 | a ordem foi aberta                       |
| `customer_report_updated` | o relato do cliente foi corrigido        |
| `details_updated`         | as observações internas foram corrigidas |

**Nada além disso.** A ficha mostra o que aconteceu de verdade; não há
"em breve" nem evento futuro inventado.

## Como o Prompt 08 entra sem migration

`kind` é `varchar`, a tabela é append-only e `metadata` é JSON. Acrescentar
`status_changed`, `quote_sent` ou `part_ordered` é escrever linhas novas — não
alterar estrutura.

## Privacidade

Nem `summary` nem `metadata` carregam o relato do cliente. Há teste que abre uma
ordem com uma frase reconhecível no relato e falha se ela aparecer na linha do
tempo.

A **exceção consciente** está na auditoria, não aqui: quando o relato é
corrigido, o texto **anterior** vai por inteiro para `audit_logs.before`. Sem
ele, "relato alterado" não permitiria reconstruir o que o cliente havia dito — e
a trilha já é área de acesso restrito, com `redact()` neutralizando segredo e
documento.
