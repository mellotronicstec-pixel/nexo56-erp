# Data Dictionary — Nexo56

Significado, tipo, obrigatoriedade e restrições das colunas (Prompt 02, item 84).
Colunas triviais aparecem de forma condensada.

**Legenda:** `PK` chave primária · `FK` estrangeira · `UK` única ·
`NN` não nulo · 🔒 dado sensível

---

## Colunas comuns a quase todas as tabelas

| Coluna                                         | Tipo          | Obrig.   | Significado                                                                                   |
| ---------------------------------------------- | ------------- | -------- | --------------------------------------------------------------------------------------------- |
| `id`                                           | `CHAR(36)`    | NN, PK   | ID técnico UUIDv7. Ordenado por tempo, não enumerável. Nunca exibido como número de documento |
| `tenant_id`                                    | `CHAR(36)`    | NN, FK   | Empresa dona do registro. Deriva sempre da sessão, nunca do cliente                           |
| `unit_id`                                      | `CHAR(36)`    | varia    | Unidade operacional. Obrigatório nas entidades físicas/financeiras                            |
| `created_at`                                   | `DATETIME(3)` | NN       | Instante de criação, **UTC**                                                                  |
| `updated_at`                                   | `DATETIME(3)` | NN       | Instante da última alteração, **UTC**                                                         |
| `created_by`                                   | `CHAR(36)`    | opcional | Usuário que criou. Nulo = criado pelo sistema                                                 |
| `updated_by`                                   | `CHAR(36)`    | opcional | Usuário da última alteração                                                                   |
| `deleted_at` / `deleted_by` / `deleted_reason` | —             | opcional | Só onde a política prevê soft delete                                                          |

---

## `tenants`

| Coluna     | Tipo           | Obrig. | Significado                                                                                                            |
| ---------- | -------------- | ------ | ---------------------------------------------------------------------------------------------------------------------- |
| `slug`     | `VARCHAR(64)`  | NN, UK | Identificador legível da empresa. Minúsculo, `[a-z0-9-]`. Usado no login quando o e-mail existe em mais de uma empresa |
| `name`     | `VARCHAR(160)` | NN     | Nome comercial                                                                                                         |
| `status`   | `ENUM`         | NN     | `active` \| `suspended` \| `inactive`. Suspenso não autentica                                                          |
| `timezone` | `VARCHAR(64)`  | NN     | IANA, ex.: `America/Sao_Paulo`. Base para exibir horários                                                              |
| `plan_id`  | `CHAR(36)`     | NN, FK | Plano contratado. Define os entitlements                                                                               |

## `units`

| Coluna     | Tipo           | Obrig.       | Significado                                                                                        |
| ---------- | -------------- | ------------ | -------------------------------------------------------------------------------------------------- |
| `name`     | `VARCHAR(160)` | NN           | Nome da unidade. Único por tenant                                                                  |
| `status`   | `ENUM`         | NN           | `active` \| `inactive`                                                                             |
| `timezone` | `VARCHAR(64)`  | **opcional** | Fuso próprio. **Nulo = herda do tenant** — nulo aqui significa "não aplicável", não "desconhecido" |

## `tenant_sequences`

| Coluna          | Tipo              | Obrig. | Significado                                                                                |
| --------------- | ----------------- | ------ | ------------------------------------------------------------------------------------------ |
| `sequence_type` | `VARCHAR(64)`     | NN, PK | `service_order`, `quote`, `purchase_order`, `warranty`, `document`. Minúsculo, normalizado |
| `current_value` | `BIGINT UNSIGNED` | NN     | Último número entregue. Começa em 0; a primeira alocação devolve 1                         |
| `prefix`        | `VARCHAR(16)`     | NN     | Prefixo exibido, ex.: `OS`. Vazio = sem prefixo                                            |
| `padding`       | `INT`             | NN     | Zeros à esquerda na formatação (padrão 6 → `000001`)                                       |

## `users`

| Coluna             | Tipo           | Obrig.   | Significado                                                                                  |
| ------------------ | -------------- | -------- | -------------------------------------------------------------------------------------------- |
| `email` 🔒         | `VARCHAR(190)` | NN       | Login. Único **por tenant**. Normalizado em minúsculas                                       |
| `name` 🔒          | `VARCHAR(160)` | NN       | Nome da pessoa                                                                               |
| `password_hash` 🔒 | `VARCHAR(255)` | NN       | `scrypt$N$r$p$salt$hash`. **Nunca** senha em texto puro                                      |
| `status`           | `ENUM`         | NN       | `active` \| `suspended` \| `inactive`. Não-ativo invalida o contexto mesmo com sessão válida |
| `last_login_at`    | `DATETIME(3)`  | opcional | Nulo = nunca entrou                                                                          |

## `sessions`

| Coluna                  | Tipo           | Obrig.   | Significado                                                                                |
| ----------------------- | -------------- | -------- | ------------------------------------------------------------------------------------------ |
| `token_hash` 🔒         | `VARCHAR(64)`  | NN, UK   | SHA-256 do token do cookie. O token em si nunca é gravado                                  |
| `expires_at`            | `DATETIME(3)`  | NN       | Expiração absoluta                                                                         |
| `revoked_at`            | `DATETIME(3)`  | opcional | Preenchido no logout/suspensão. Nulo = ativa                                               |
| `last_used_at`          | `DATETIME(3)`  | NN       | Último uso                                                                                 |
| `user_agent_summary` 🔒 | `VARCHAR(120)` | opcional | Resumo curto ("Chrome no Windows"). **Não** é fingerprint: sem IP, sem user-agent completo |

## `password_reset_tokens`

| Coluna          | Tipo          | Obrig.   | Significado                                                    |
| --------------- | ------------- | -------- | -------------------------------------------------------------- |
| `token_hash` 🔒 | `VARCHAR(64)` | NN, UK   | SHA-256 do código entregue. O código em si nunca é gravado     |
| `expires_at`    | `DATETIME(3)` | NN       | 60 minutos após a emissão                                      |
| `used_at`       | `DATETIME(3)` | opcional | Preenchido no consumo. Torna o código de **uso único**         |
| `created_by`    | `CHAR(36)`    | opcional | Administrador que iniciou o reset. Nulo = pelo próprio titular |

## `roles` · `permissions` · associações

| Tabela             | Coluna                        | Tipo             | Significado                                                              |
| ------------------ | ----------------------------- | ---------------- | ------------------------------------------------------------------------ |
| `roles`            | `key`                         | `VARCHAR(64)`    | Chave do papel, única por tenant (`admin`)                               |
| `roles`            | `is_system`                   | `BOOLEAN`        | Papel estrutural; a aplicação impede exclusão                            |
| `permissions`      | `key`                         | `VARCHAR(96)` PK | `<recurso>.<ação>` — `users.view`, `features.manage`                     |
| `permissions`      | `feature_key`                 | `VARCHAR(96)` FK | Feature a que a permissão pertence                                       |
| `user_units`       | `(user_id, unit_id)`          | PK               | Unidades que o usuário pode acessar                                      |
| `user_roles`       | `(user_id, role_id)`          | PK               | Papel atribuído com escopo **TENANT**                                    |
| `user_unit_roles`  | `(user_id, role_id, unit_id)` | PK               | Papel atribuído com escopo **UNIT** — exige vínculo em `user_units` (FK) |
| `role_permissions` | `(role_id, permission_key)`   | PK               | Permissões do papel                                                      |

## Modularidade

| Tabela              | Coluna                       | Tipo             | Significado                                                                       |
| ------------------- | ---------------------------- | ---------------- | --------------------------------------------------------------------------------- |
| `features`          | `key`                        | `VARCHAR(96)` PK | `core.auth`, `platform.multi_unit`                                                |
| `features`          | `type`                       | `ENUM`           | `CORE` \| `OPTIONAL` \| `PREMIUM` \| `BETA` \| `INTERNAL`. CORE não é desativável |
| `features`          | `status`                     | `ENUM`           | `available` \| `deprecated`                                                       |
| `plans`             | `is_internal`                | `BOOLEAN`        | Plano técnico, não comercializável                                                |
| `plan_entitlements` | `(plan_id, feature_key)`     | PK               | **Ausência de linha = não contemplado pelo plano**                                |
| `tenant_features`   | `enabled`                    | `BOOLEAN`        | Configuração da empresa                                                           |
| `tenant_features`   | `enabled_at` / `disabled_at` | `DATETIME(3)`    | Quando foi ativada/desativada. **A linha sobrevive à desativação**                |

## `audit_logs`

| Coluna                      | Tipo          | Obrig.        | Significado                                                                       |
| --------------------------- | ------------- | ------------- | --------------------------------------------------------------------------------- |
| `action`                    | `VARCHAR(96)` | NN            | `user.login.succeeded`, `feature.enabled`                                         |
| `entity_type` / `entity_id` | `VARCHAR`     | NN / opcional | Entidade afetada. `entity_id` nulo quando a ação não tem alvo único               |
| `before` / `after` 🔒       | `JSON`        | opcional      | Estado antes/depois, **redigido** (senha, token, segredo, CPF viram `[REDACTED]`) |
| `metadata`                  | `JSON`        | opcional      | Contexto adicional seguro                                                         |
| `correlation_id`            | `CHAR(36)`    | opcional      | Liga request, auditoria, evento e job                                             |
| `origin`                    | `VARCHAR(16)` | NN            | `web` \| `api` \| `job` \| `cli` \| `test`                                        |

## `domain_events`

| Coluna         | Tipo             | Significado                                     |
| -------------- | ---------------- | ----------------------------------------------- |
| `type`         | `VARCHAR(96)`    | `USER_LOGGED_IN`, `FEATURE_ENABLED`             |
| `payload`      | `JSON` NN        | Dados do evento. Uso legítimo de JSON (item 39) |
| `occurred_at`  | `DATETIME(3)` NN | Quando o fato ocorreu                           |
| `published_at` | `DATETIME(3)`    | **Nulo = ainda não entregue** (outbox)          |

## `jobs`

| Coluna                      | Tipo              | Significado                                                      |
| --------------------------- | ----------------- | ---------------------------------------------------------------- |
| `name`                      | `VARCHAR(96)` NN  | Handler registrado (`session.prune-expired`)                     |
| `payload`                   | `JSON` NN         | Parâmetros                                                       |
| `idempotency_key`           | `VARCHAR(190)` UK | **Garantia de não-duplicação, imposta pelo índice único**        |
| `status`                    | `ENUM`            | `pending` \| `running` \| `succeeded` \| `failed` \| `discarded` |
| `attempts` / `max_attempts` | `INT`             | Controle de retentativa com backoff                              |
| `run_after`                 | `DATETIME(3)` NN  | Não executar antes deste instante                                |
| `locked_by` / `locked_at`   | —                 | Processo que reivindicou; base da recuperação de job travado     |
| `last_error`                | `VARCHAR(1000)`   | Mensagem do último erro, truncada                                |

---

## Tipos monetários e de quantidade (ainda sem uso físico)

Definidos como convenção em `src/core/db/columns.ts`, aplicáveis assim que
existir a primeira entidade financeira:

| Helper           | Tipo SQL        | Uso                                           |
| ---------------- | --------------- | --------------------------------------------- |
| `money()`        | `DECIMAL(14,2)` | Valor final: preço, pagamento, total          |
| `moneyPrecise()` | `DECIMAL(14,4)` | Custo unitário, rateio, cálculo intermediário |
| `quantity()`     | `DECIMAL(14,4)` | Quantidade — pode ser fracionária             |
| `currency()`     | `CHAR(3)`       | ISO 4217. `BRL` inicial                       |
| `civilDate()`    | `VARCHAR(10)`   | Data civil ISO, sem fuso                      |

Nenhuma coluna monetária existe ainda — a primeira virá com Orçamentos
(Prompt 09) ou Financeiro (Prompt 12).
