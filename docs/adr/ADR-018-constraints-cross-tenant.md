# ADR-018 — Constraints cross-tenant no banco

**Status:** Aceito · **Data:** Prompt 02

## Contexto

Com banco compartilhado (ADR-004), o isolamento vinha **só** da aplicação
(ADR-005). A auditoria do Prompt 02 mostrou o buraco, e ele foi **reproduzido
antes de ser corrigido**:

```sql
INSERT INTO user_units (user_id, unit_id, tenant_id, created_at)
VALUES ('usuario-do-tenant-A', 'unidade-do-tenant-B', 'tenant-A', NOW(3));
-- linha gravada: user=usrA unit=uB tenant=tA
```

O banco aceitou. As três FKs eram independentes (`user_id → users.id`,
`unit_id → units.id`, `tenant_id → tenants.id`): cada uma garantia que o
registro **existe**, nenhuma que pertencem ao **mesmo tenant**.

## Decisão

Chaves únicas compostas nas tabelas pai:

```sql
UNIQUE (id, tenant_id)  -- em units, users, roles
```

E foreign keys **compostas** nas tabelas filhas, compartilhando `tenant_id`:

| Constraint                  | Colunas                | Referencia             |
| --------------------------- | ---------------------- | ---------------------- |
| `fk_user_units_user_tenant` | `(user_id, tenant_id)` | `users(id, tenant_id)` |
| `fk_user_units_unit_tenant` | `(unit_id, tenant_id)` | `units(id, tenant_id)` |
| `fk_user_roles_user_tenant` | `(user_id, tenant_id)` | `users(id, tenant_id)` |
| `fk_user_roles_role_tenant` | `(role_id, tenant_id)` | `roles(id, tenant_id)` |
| `fk_sessions_user_tenant`   | `(user_id, tenant_id)` | `users(id, tenant_id)` |

Como as duas FKs de uma mesma tabela compartilham a coluna `tenant_id`, o
InnoDB só aceita a linha quando **ambas** as pontas pertencem àquele tenant.

As FKs simples para `tenants` foram removidas por redundância: o tenant é
alcançado transitivamente por `users`/`units`/`roles`.

## Motivo

- **Defesa em profundidade.** A aplicação já filtrava corretamente; agora um
  bug de aplicação, um script de manutenção ou uma importação mal feita também
  são barrados.
- `sessions` é o caso mais crítico: o `tenant_id` da sessão é a origem de
  **todo** `TenantContext`. Com a FK composta, uma linha de sessão forjada com
  outro tenant é rejeitada antes de existir.
- Custo praticamente zero: as chaves compostas são índices que o InnoDB já
  usaria, e a validação acontece no mesmo lookup da FK.

## Alternativas consideradas

| Alternativa                                       | Por que não                                                        |
| ------------------------------------------------- | ------------------------------------------------------------------ |
| Só validação na aplicação                         | Era o estado anterior — e o buraco foi demonstrado                 |
| Trigger de validação                              | Mais lento, mais difícil de auditar, e o InnoDB já faz nativamente |
| Desnormalizar e checar por `CHECK`                | MariaDB não permite subquery em `CHECK`                            |
| Chave primária composta `(id, tenant_id)` em tudo | Mudaria toda FK existente e engordaria índices sem ganho adicional |

## Consequências

- **Migração falha se houver dado incoerente pré-existente.** Isso é desejável:
  a migration detecta corrupção em vez de escondê-la. Em produção, rodar antes
  uma consulta de verificação. Documentado em `docs/database/schema.md`.
- Toda entidade futura com `unit_id` usa FK composta `(unit_id, tenant_id)` —
  a regra está em `docs/database/conventions.md`.
- Verificado por `tests/integration/cross-tenant-constraints.test.ts`, que ataca
  o banco por SQL cru, ignorando a aplicação de propósito.
