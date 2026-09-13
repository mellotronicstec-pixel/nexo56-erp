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

## `customers` (Prompt 05)

| Coluna                                 | Tipo           | Obrig.   | Significado                                                                                                                     |
| -------------------------------------- | -------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `kind`                                 | `ENUM`         | NN       | `individual` \| `company`                                                                                                       |
| `name` 🔒                              | `VARCHAR(200)` | NN       | Nome da pessoa ou razão social                                                                                                  |
| `name_normalized`                      | `VARCHAR(200)` | NN       | Sem acento e em minúsculas — só para busca                                                                                      |
| `trade_name` / `trade_name_normalized` | `VARCHAR(200)` | opcional | Nome fantasia (pessoa jurídica)                                                                                                 |
| `document_type`                        | `ENUM`         | opcional | `cpf` \| `cnpj`                                                                                                                 |
| `document_digits` 🔒                   | `VARCHAR(14)`  | opcional | Só dígitos. Único por tenant quando presente; **cada `NULL` é distinto no MySQL**, então vários clientes sem documento convivem |
| `state_registration`                   | `VARCHAR(32)`  | opcional | Inscrição estadual                                                                                                              |
| `birth_date` 🔒                        | `VARCHAR(10)`  | opcional | Data civil ISO, sem fuso                                                                                                        |
| `notes`                                | `TEXT`         | opcional | Observações do cadastro                                                                                                         |
| `status`                               | `ENUM`         | NN       | `active` \| `inactive` — nunca exclusão física                                                                                  |
| `origin_unit_id`                       | `CHAR(36)`     | opcional | Unidade onde o cadastro nasceu. **Procedência, nunca filtro**                                                                   |

## `customer_contacts` / `customer_addresses` (Prompt 05)

| Coluna                                                                                  | Tipo           | Obrig.   | Significado                                                                                                                             |
| --------------------------------------------------------------------------------------- | -------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `type` (contato)                                                                        | `ENUM`         | NN       | `phone` \| `email`                                                                                                                      |
| `value` 🔒                                                                              | `VARCHAR(190)` | NN       | Como foi digitado                                                                                                                       |
| `value_normalized` 🔒                                                                   | `VARCHAR(190)` | NN       | Só dígitos (telefone) ou minúsculas (e-mail) — para busca                                                                               |
| `is_whatsapp`                                                                           | `BOOLEAN`      | NN       | Marca o telefone com WhatsApp                                                                                                           |
| `is_primary`                                                                            | `BOOLEAN`      | NN       | Contato/endereço principal                                                                                                              |
| `primary_marker`                                                                        | `TINYINT`      | opcional | `1` no principal, **`NULL` nos demais**. Com UNIQUE `(customer_id, primary_marker)`, o banco garante **um único principal** sem trigger |
| `zip_code`, `street`, `number`, `complement`, `district`, `city`, `state`, `country` 🔒 | `VARCHAR`      | opcional | Endereço; `country` padrão `BR`                                                                                                         |

## `equipment` (Prompt 06)

| Coluna                         | Tipo           | Obrig.       | Significado                                                                                                          |
| ------------------------------ | -------------- | ------------ | -------------------------------------------------------------------------------------------------------------------- |
| `customer_id`                  | `CHAR(36)`     | NN, FK       | Dono do aparelho. FK **composta** `(customer_id, tenant_id)`                                                         |
| `kind` / `kind_normalized`     | `VARCHAR(80)`  | NN           | Tipo (TV, amplificador…). Texto livre com sugestões, não taxonomia fechada                                           |
| `brand` / `brand_normalized`   | `VARCHAR(120)` | opcional     | Marca                                                                                                                |
| `model` / `model_normalized`   | `VARCHAR(160)` | opcional     | Modelo. O exibido **não** sofre normalização destrutiva: `RX-V385` ≠ `RXV385` para quem procura peça                 |
| `serial` / `serial_normalized` | `VARCHAR(120)` | **opcional** | Número de série. **Não é chave e não tem unicidade** — etiqueta ilegível é rotina; fabricantes reaproveitam formatos |
| `voltage`                      | `ENUM`         | NN           | `v110` \| `v127` \| `v220` \| `bivolt` \| `not_applicable` \| `unknown`. Padrão `unknown`                            |
| `notes`                        | `TEXT`         | opcional     | Observações de **identificação** — nunca diagnóstico                                                                 |
| `status`                       | `ENUM`         | NN           | `active` \| `inactive`                                                                                               |
| `origin_unit_id`               | `CHAR(36)`     | opcional     | Unidade onde o cadastro nasceu. **Procedência, nunca filtro**                                                        |

## `equipment_intakes` (Prompt 06)

| Coluna             | Tipo          | Obrig.     | Significado                                                                                                               |
| ------------------ | ------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------- |
| `unit_id`          | `CHAR(36)`    | **NN**, FK | Unidade onde o aparelho foi recebido. Vem de `context.activeUnitId`, **nunca do formulário**. FK composta com `tenant_id` |
| `equipment_id`     | `CHAR(36)`    | NN, FK     | Aparelho recebido. FK composta com `tenant_id`                                                                            |
| `received_at`      | `DATETIME(3)` | NN         | Instante da entrada, **UTC**                                                                                              |
| `received_by`      | `CHAR(36)`    | opcional   | Quem atendeu. Complementa a auditoria, não a substitui                                                                    |
| `power_cable`      | `ENUM`        | NN         | `yes` \| `no` \| `not_applicable`                                                                                         |
| `inspection_notes` | `TEXT`        | opcional   | Relato livre do estado físico de entrada                                                                                  |
| `notes`            | `TEXT`        | opcional   | Observações do atendimento                                                                                                |

## `equipment_intake_accessories` / `equipment_intake_conditions` (Prompt 06)

| Coluna              | Tipo           | Obrig.   | Significado                                                                                                                                                                |
| ------------------- | -------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `label` (acessório) | `VARCHAR(120)` | NN       | Item entregue junto. Texto livre; a lista sugerida acelera, não limita                                                                                                     |
| `quantity`          | `INT`          | NN       | Quantidade **inteira** — acessório se conta por unidade, nunca em fração                                                                                                   |
| `condition_key`     | `VARCHAR(40)`  | NN       | Chave do catálogo (`scratches`, `dents`, `cracks`, `broken_parts`, `missing_screws`, `disassembled`, `loose_parts`, `oxidation`, `liquid`, `dirt`). UNIQUE com `intake_id` |
| `note` (condição)   | `VARCHAR(300)` | opcional | Detalhe: "risco de 3 cm na tampa"                                                                                                                                          |

## `equipment_media` (Prompt 06)

| Coluna             | Tipo           | Obrig.   | Significado                                                                                 |
| ------------------ | -------------- | -------- | ------------------------------------------------------------------------------------------- |
| `equipment_id`     | `CHAR(36)`     | NN, FK   | Aparelho fotografado                                                                        |
| `intake_id`        | `CHAR(36)`     | opcional | **Nulo = foto do cadastro**; preenchido = foto daquele atendimento                          |
| `kind`             | `ENUM`         | NN       | `general` \| `front` \| `back` \| `damage` \| `label` \| `serial` \| `accessory` \| `other` |
| `storage_key`      | `VARCHAR(255)` | NN       | Chave opaca no storage, gerada pelo servidor. **Nunca caminho absoluto nem nome enviado**   |
| `mime_type`        | `VARCHAR(40)`  | NN       | Confirmado por magic bytes, não pelo cabeçalho da requisição                                |
| `byte_size`        | `INT`          | NN       | Tamanho em bytes (limite 8 MB)                                                              |
| `width` / `height` | `INT`          | opcional | Lidos do cabeçalho da imagem                                                                |
| `checksum`         | `VARCHAR(64)`  | NN       | SHA-256 do conteúdo — integridade e detecção de reenvio                                     |
| `caption` 🔒       | `VARCHAR(200)` | opcional | Descrição curta digitada pelo atendente                                                     |

**Os bytes não ficam no banco.** Eles vivem no storage, fora de `public/`, e são
servidos por rota autenticada (ADR-030).

## `equipment_label_readings` (Prompt 06)

| Coluna                          | Tipo          | Obrig.   | Significado                                                         |
| ------------------------------- | ------------- | -------- | ------------------------------------------------------------------- |
| `provider`                      | `VARCHAR(60)` | NN       | Nome do provider. **`none` quando indisponível — o padrão hoje**    |
| `status`                        | `ENUM`        | NN       | `succeeded` \| `partial` \| `failed` \| `unavailable`               |
| `fields`                        | `JSON`        | opcional | Campos sugeridos, com confiança. **Nunca sobrescreve o confirmado** |
| `confirmed_at` / `confirmed_by` | —             | opcional | Quando e por quem a sugestão foi confirmada por um humano           |

---

## `service_orders` (Prompt 07)

| Coluna               | Tipo           | Obrig.     | Significado                                                                                                                |
| -------------------- | -------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------- |
| `unit_id`            | `CHAR(36)`     | **NN**, FK | Unidade que assumiu o serviço. Vem de `context.activeUnitId`, **nunca do formulário**. Não muda depois da abertura         |
| `number`             | `INT UNSIGNED` | NN         | Número humano, **único por tenant**. Guarda só o valor; prefixo e zeros à esquerda vivem em `tenant_sequences`             |
| `customer_id`        | `CHAR(36)`     | NN, FK     | Dono do aparelho. Derivado do equipamento, não aceito da entrada                                                           |
| `equipment_id`       | `CHAR(36)`     | NN, FK     | Aparelho atendido                                                                                                          |
| `intake_id`          | `CHAR(36)`     | opcional   | Recebimento de origem. **Nulo = OS aberta direto do cadastro**. Único por tenant quando presente                           |
| `status`             | `VARCHAR(40)`  | NN         | Um único valor hoje: `awaiting_technical_opinion`. `VARCHAR` e não `ENUM` para o Prompt 08 acrescentar estados sem `ALTER` |
| `customer_report` 🔒 | `TEXT`         | NN         | O que o **cliente** relatou. Não é diagnóstico. Pode conter dado pessoal incidental                                        |
| `internal_notes`     | `TEXT`         | opcional   | Recado da equipe. Não é apresentado ao cliente                                                                             |
| `opened_at`          | `DATETIME(3)`  | NN         | Instante da abertura, **UTC**                                                                                              |
| `idempotency_key`    | `VARCHAR(80)`  | opcional   | Chave do comando de criação. Única por tenant; **cada `NULL` é distinto**                                                  |

## `service_order_timeline` (Prompt 07)

| Coluna             | Tipo           | Obrig.   | Significado                                                                                         |
| ------------------ | -------------- | -------- | --------------------------------------------------------------------------------------------------- |
| `service_order_id` | `CHAR(36)`     | NN, FK   | Ordem a que o fato pertence. FK composta com `tenant_id`                                            |
| `kind`             | `VARCHAR(40)`  | NN       | `created`, `customer_report_updated`, `details_updated`. Texto para o Prompt 08 acrescentar os seus |
| `summary`          | `VARCHAR(300)` | opcional | Resumo legível. **Nunca carrega o relato do cliente**                                               |
| `metadata`         | `JSON`         | opcional | Detalhe estruturado do fato. Também sem PII                                                         |
| `actor_id`         | `CHAR(36)`     | opcional | Quem provocou o fato. Nulo = sistema                                                                |
| `occurred_at`      | `DATETIME(3)`  | NN       | Quando aconteceu, **UTC**                                                                           |

Tabela **append-only**: é a narrativa de negócio da ordem, distinta da trilha de
segurança em `audit_logs`.

---

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
