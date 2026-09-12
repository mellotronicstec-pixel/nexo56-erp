# Schema físico — Nexo56

Documentação do modelo efetivamente existente no banco (Prompt 02, item 82).
**18 tabelas de negócio/infraestrutura** + o journal do Drizzle.

Convenções: `docs/database/conventions.md` · Escopos:
`docs/database/ownership-matrix.md` · Diagrama: `docs/database/erd.md`

---

## Tenancy

### `tenants` — empresa cliente da plataforma

| Item          | Valor                                                                  |
| ------------- | ---------------------------------------------------------------------- |
| Finalidade    | A empresa contratante. Raiz de todo ownership de negócio               |
| Ownership     | plataforma                                                             |
| PK            | `id` (UUIDv7)                                                          |
| FKs           | `plan_id → plans.id` `RESTRICT`                                        |
| Unique        | `uq_tenants_slug (slug)`                                               |
| Índices       | `ix_tenants_status (status)`                                           |
| Delete        | Nunca. Empresa com dados é protegida por `RESTRICT` em todas as filhas |
| Sensibilidade | Interno (nome comercial)                                               |
| Módulo        | `tenancy`                                                              |

### `units` — unidade operacional / filial

| Item          | Valor                                                                               |
| ------------- | ----------------------------------------------------------------------------------- |
| Finalidade    | Onde a operação acontece fisicamente. Todo tenant tem pelo menos uma                |
| Ownership     | tenant                                                                              |
| PK            | `id`                                                                                |
| FKs           | `tenant_id → tenants.id` `RESTRICT`                                                 |
| Unique        | `uq_units_tenant_name (tenant_id, name)` · **`uq_units_id_tenant (id, tenant_id)`** |
| Índices       | `ix_units_tenant_status (tenant_id, status)`                                        |
| Delete        | Inativação por `status`                                                             |
| Sensibilidade | Interno                                                                             |
| Módulo        | `tenancy`                                                                           |

`uq_units_id_tenant` existe para ser **alvo de FK composta**. Sem ela, uma FK
`unit_id → units.id` garantiria apenas que a unidade existe, não que pertence
ao mesmo tenant.

### `tenant_sequences` — numeração humana por tenant _(novo no Prompt 02)_

| Item          | Valor                                                            |
| ------------- | ---------------------------------------------------------------- |
| Finalidade    | Contador do número visível de documentos (OS, orçamento, compra) |
| Ownership     | tenant                                                           |
| PK            | `(tenant_id, sequence_type)`                                     |
| FKs           | `tenant_id → tenants.id` `RESTRICT`                              |
| Delete        | Nunca — reiniciar numeração corromperia referências históricas   |
| Sensibilidade | Interno                                                          |
| Módulo        | `tenancy`                                                        |

Colunas: `current_value` (último número entregue), `prefix` (ex.: `OS`),
`padding` (zeros à esquerda). Alocação atômica — ver ADR-013.

---

## Usuários e autenticação

### `users`

| Item          | Valor                                                                                 |
| ------------- | ------------------------------------------------------------------------------------- |
| Finalidade    | Pessoa que acessa o sistema, sempre vinculada a uma empresa                           |
| Ownership     | tenant                                                                                |
| PK            | `id`                                                                                  |
| FKs           | `tenant_id → tenants.id` `RESTRICT`                                                   |
| Unique        | `uq_users_tenant_email (tenant_id, email)` · **`uq_users_id_tenant (id, tenant_id)`** |
| Índices       | `ix_users_email (email)` (login), `ix_users_tenant_status`                            |
| Delete        | Inativação por `status`; nunca hard delete                                            |
| Sensibilidade | **Pessoal** (nome, e-mail) + **credencial** (`password_hash`)                         |
| Módulo        | `users`                                                                               |

E-mail é único **por tenant** — a mesma pessoa pode ter conta em empresas
diferentes. O login trata o caso pedindo o identificador da empresa.

### `user_units` — unidades autorizadas

| Item      | Valor                                                                                                                     |
| --------- | ------------------------------------------------------------------------------------------------------------------------- |
| Ownership | associação (tenant + unidade)                                                                                             |
| PK        | `(user_id, unit_id)`                                                                                                      |
| FKs       | **`(user_id, tenant_id) → users(id, tenant_id)`** `CASCADE` · **`(unit_id, tenant_id) → units(id, tenant_id)`** `CASCADE` |
| Índices   | `ix_user_units_tenant`, `ix_user_units_unit`                                                                              |
| Delete    | Hard delete aceitável — revogar acesso não apaga histórico                                                                |
| Módulo    | `users`                                                                                                                   |

As duas FKs compostas compartilham a coluna `tenant_id`: o InnoDB só aceita a
linha quando usuário **e** unidade pertencem ao mesmo tenant.

### `sessions`

| Item          | Valor                                                               |
| ------------- | ------------------------------------------------------------------- |
| Finalidade    | Sessão server-side. Origem de **todo** `TenantContext` da aplicação |
| Ownership     | tenant                                                              |
| PK            | `id`                                                                |
| FKs           | **`(user_id, tenant_id) → users(id, tenant_id)`** `CASCADE`         |
| Unique        | `uq_sessions_token_hash (token_hash)`                               |
| Índices       | `ix_sessions_user`, `ix_sessions_expires` (limpeza)                 |
| Delete        | Hard delete pelo job `session.prune-expired`                        |
| Sensibilidade | **Credencial** (hash do token)                                      |
| Módulo        | `auth`                                                              |

Guarda apenas o **SHA-256** do token. IP não é armazenado; do user-agent só um
resumo curto em `user_agent_summary`, para a pessoa reconhecer o próprio
dispositivo (LGPD). A FK composta impede sessão carimbada com tenant diferente
do usuário.

### `password_reset_tokens` _(novo no Prompt 03)_

| Item          | Valor                                                       |
| ------------- | ----------------------------------------------------------- |
| Finalidade    | Redefinição de senha por código de uso único                |
| Ownership     | tenant                                                      |
| PK            | `id`                                                        |
| FKs           | **`(user_id, tenant_id) → users(id, tenant_id)`** `CASCADE` |
| Unique        | `uq_password_reset_token_hash (token_hash)`                 |
| Índices       | `ix_password_reset_user`, `ix_password_reset_expires`       |
| Delete        | Hard delete na limpeza; `used_at` marca o consumo           |
| Sensibilidade | **Credencial** (hash do código)                             |
| Módulo        | `auth`                                                      |

---

## Controle de acesso

### `roles`

| Item      | Valor                                                                            |
| --------- | -------------------------------------------------------------------------------- |
| Ownership | tenant                                                                           |
| PK        | `id` · Unique: `uq_roles_tenant_key (tenant_id, key)` · **`uq_roles_id_tenant`** |
| FKs       | `tenant_id → tenants.id` `RESTRICT`                                              |
| Delete    | `is_system = true` bloqueia exclusão na aplicação                                |
| Módulo    | `access-control`                                                                 |

### `permissions` — catálogo **global**

| Item      | Valor                                                      |
| --------- | ---------------------------------------------------------- |
| Ownership | **global** — a chave significa o mesmo em todos os tenants |
| PK        | `key` · FKs: `feature_key → features.key` `RESTRICT`       |
| Delete    | Nunca em runtime; sincronizado do catálogo em código       |
| Módulo    | `access-control`                                           |

### `role_permissions` · `user_roles`

| Item   | `role_permissions`                    | `user_roles`                                                            |
| ------ | ------------------------------------- | ----------------------------------------------------------------------- |
| PK     | `(role_id, permission_key)`           | `(user_id, role_id)`                                                    |
| FKs    | `role_id`, `permission_key` `CASCADE` | **`(user_id, tenant_id) → users`** · **`(role_id, tenant_id) → roles`** |
| Delete | Hard delete                           | Hard delete                                                             |
| Escopo | —                                     | atribuição de escopo **TENANT**                                         |

### `user_unit_roles` — atribuição com escopo de unidade _(novo no Prompt 03)_

| Item       | Valor                                                                                                                                                      |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Finalidade | Papel válido **somente** na unidade indicada (escopo UNIT)                                                                                                 |
| Ownership  | associação, tenant + unit obrigatórios                                                                                                                     |
| PK         | `(user_id, role_id, unit_id)`                                                                                                                              |
| FKs        | `(user_id, tenant_id) → users` · `(role_id, tenant_id) → roles` · `(unit_id, tenant_id) → units` · **`(user_id, unit_id) → user_units`** — todas `CASCADE` |
| Índices    | `ix_user_unit_roles_tenant`, `ix_user_unit_roles_unit`, `ix_user_unit_roles_role`                                                                          |
| Delete     | Hard delete; cascata ao remover o vínculo de unidade                                                                                                       |
| Módulo     | `access-control`                                                                                                                                           |

`user_roles` **não foi alterada** e mantém a semântica original. A quarta FK faz
do "papel por unidade exige vínculo" uma regra do banco, não da aplicação.

---

## Modularidade

| Tabela                 | Ownership | PK                              | Observação                                      |
| ---------------------- | --------- | ------------------------------- | ----------------------------------------------- |
| `features`             | global    | `key`                           | `type`: CORE, OPTIONAL, PREMIUM, BETA, INTERNAL |
| `feature_dependencies` | global    | `(feature_key, depends_on_key)` | Ciclo detectado antes de gravar                 |
| `plans`                | global    | `id`, unique `key`              | `is_internal` marca plano não comercializável   |
| `plan_entitlements`    | global    | `(plan_id, feature_key)`        | Ausência de linha = não contemplado             |
| `tenant_features`      | tenant    | `(tenant_id, feature_key)`      | **Desativar preserva a linha e os dados**       |

`tenant_features` guarda `enabled`, `enabled_at` e `disabled_at`: desativar um
módulo nunca apaga registro, e reativar devolve o acesso ao histórico.

---

## Auditoria, eventos e jobs

### `audit_logs`

| Item          | Valor                                                                                   |
| ------------- | --------------------------------------------------------------------------------------- |
| Finalidade    | Quem alterou o quê e quando                                                             |
| Ownership     | tenant (nulo em evento de plataforma)                                                   |
| PK            | `id` · FKs: `tenant_id → tenants.id` `RESTRICT`                                         |
| Índices       | `ix_audit_tenant_created`, `ix_audit_entity`, `ix_audit_action`, `ix_audit_correlation` |
| Delete        | **Nunca.** Somente inserção                                                             |
| Sensibilidade | Pode conter **pessoal** em `before`/`after` — redigido antes de gravar                  |

### `domain_events`

| Item       | Valor                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------- |
| Finalidade | Fato de negócio ocorrido; formato outbox                                                    |
| PK         | `id` · FKs: `tenant_id → tenants.id` `RESTRICT`                                             |
| Índices    | `ix_domain_events_tenant_occurred`, `ix_domain_events_type`, `ix_domain_events_unpublished` |
| Delete     | **Nunca**                                                                                   |

`published_at` nulo = ainda não entregue aos handlers.

### `jobs`

| Item       | Valor                                                                |
| ---------- | -------------------------------------------------------------------- |
| Finalidade | Fila durável de trabalho em background                               |
| PK         | `id` · Unique: **`uq_jobs_idempotency_key`**                         |
| FKs        | `tenant_id → tenants.id` `RESTRICT`                                  |
| Índices    | `ix_jobs_status_run_after`, `ix_jobs_name`, `ix_jobs_tenant`         |
| Delete     | Hard delete de jobs antigos é aceitável (não é histórico de negócio) |

O índice único da chave de idempotência é a garantia real contra execução
duplicada — não uma verificação na aplicação.

---

## Proteção cross-tenant no banco (Prompt 02, item 34)

Nove FKs compostas, verificadas por teste automatizado — cinco do Prompt 02 e
quatro acrescentadas pelo Prompt 03:

| Constraint                       | Impede                                            |
| -------------------------------- | ------------------------------------------------- |
| `fk_user_units_user_tenant`      | vincular usuário de outro tenant                  |
| `fk_user_units_unit_tenant`      | vincular unidade de outro tenant                  |
| `fk_user_roles_user_tenant`      | atribuir papel a usuário de outro tenant          |
| `fk_user_roles_role_tenant`      | atribuir papel definido em outro tenant           |
| `fk_sessions_user_tenant`        | sessão carimbada com tenant diferente do usuário  |
| `fk_user_unit_roles_user_tenant` | papel por unidade para usuário de outro tenant    |
| `fk_user_unit_roles_role_tenant` | papel por unidade com perfil de outro tenant      |
| `fk_user_unit_roles_unit_tenant` | papel por unidade em unidade de outro tenant      |
| `fk_user_unit_roles_membership`  | **papel por unidade sem vínculo naquela unidade** |

E `fk_password_reset_user_tenant` impede código de redefinição carimbado com
tenant diferente do usuário.

Antes do Prompt 02 essas associações eram aceitas pelo banco (bloqueadas apenas
pela aplicação). Testes em `tests/integration/cross-tenant-constraints.test.ts`.

---

## Charset, engine e conexão

- Engine **InnoDB** em todas as tabelas (transações e FKs).
- `utf8mb4` / `utf8mb4_unicode_ci` fixado por tabela.
- Pool com `timezone: 'Z'` — todo `DATETIME` é UTC.
- `DB_POOL_SIZE` padrão 5, por causa do limite de conexões da hospedagem
  compartilhada. **Limite real da Hostinger ainda a confirmar no hPanel.**
