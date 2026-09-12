# ADR-016 — Soft delete, arquivamento e histórico

**Status:** Aceito · **Data:** Prompt 02

## Contexto

A Constituição (item 93) proíbe exclusão física indiscriminada de OS,
financeiro, estoque, garantia, auditoria e histórico. Mas aplicar soft delete
em tudo também é errado: enche o schema de colunas inúteis e obriga toda
consulta a lembrar de um filtro.

## Decisão

Classificação por categoria, e não regra única:

| Categoria                 | Política                                                   | Exemplo                                               |
| ------------------------- | ---------------------------------------------------------- | ----------------------------------------------------- |
| **Dado mestre**           | `status` de inativação; soft delete só sob exigência legal | cliente, equipamento, fornecedor, peça                |
| **Documento de negócio**  | **Nunca** apagar — cancelamento é estado                   | OS, orçamento, pagamento                              |
| **Histórico e auditoria** | **Nunca** apagar, nunca alterar                            | `audit_logs`, `domain_events`, timeline, movimentação |
| **Associação técnica**    | Hard delete aceitável                                      | `user_units`, `role_permissions`, `user_roles`        |
| **Configuração**          | Desativação preserva a linha e os dados                    | `tenant_features`                                     |
| **Técnico efêmero**       | Hard delete                                                | `sessions`, `jobs` concluídos                         |

Quando soft delete for necessário: `deleted_at`, `deleted_by`,
`deleted_reason` — **nunca** apenas `is_deleted`.

## Motivo

- `is_deleted` booleano perde **quando** e **por quem**, e é exatamente isso que
  se precisa saber quando um registro "some" e alguém pergunta o porquê.
- Entidade com ciclo de vida real usa `status`, não soft delete: uma OS
  cancelada não está "apagada", está **cancelada** — é um estado do negócio,
  visível e relatável.
- Associação técnica pode ser apagada porque revogar o acesso de um usuário a
  uma unidade não destrói histórico de negócio; o fato da revogação fica na
  auditoria.

## Auditoria ≠ histórico de domínio (item 29)

Duas coisas diferentes, que não se substituem:

|                    | Responde                                 | Onde                                                  |
| ------------------ | ---------------------------------------- | ----------------------------------------------------- |
| **AuditLog**       | _Quem_ alterou _o quê_ e _quando_        | `audit_logs`, transversal, somente inserção           |
| **Domain History** | _O que aconteceu_ no processo de negócio | timeline por agregado (ex.: `service_order_timeline`) |

A timeline da OS conta a história do atendimento e é mostrada ao usuário; a
auditoria conta a história das alterações e serve à investigação. Uma não
substitui a outra: a auditoria não sabe que "o cliente aprovou o orçamento", e
a timeline não sabe que "alguém editou o telefone do cliente ontem".

## Consequências

- Toda consulta em tabela com soft delete filtra `deleted_at IS NULL` por
  padrão — responsabilidade do repositório, não de quem chama.
- Nenhuma entidade da fundação usa soft delete hoje: `users`, `units` e
  `tenants` usam `status`; histórico não se apaga. As colunas existem como
  helper (`softDelete()`) para quando a primeira entidade precisar.
