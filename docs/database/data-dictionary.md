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

| Coluna                   | Tipo           | Obrig.       | Significado                                                                                                                     |
| ------------------------ | -------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `unit_id`                | `CHAR(36)`     | **NN**, FK   | Unidade que assumiu o serviço. Vem de `context.activeUnitId`, **nunca do formulário**. Não muda depois da abertura              |
| `number`                 | `INT UNSIGNED` | NN           | Número humano, **único por tenant**. Guarda só o valor; prefixo e zeros à esquerda vivem em `tenant_sequences`                  |
| `customer_id`            | `CHAR(36)`     | NN, FK       | Dono do aparelho. Derivado do equipamento, não aceito da entrada                                                                |
| `equipment_id`           | `CHAR(36)`     | NN, FK       | Aparelho atendido                                                                                                               |
| `intake_id`              | `CHAR(36)`     | opcional     | Recebimento de origem. **Nulo = OS aberta direto do cadastro**. Único por tenant quando presente                                |
| `status`                 | `VARCHAR(40)`  | NN           | Um dos nove estados do workflow. `VARCHAR` e não `ENUM`: o Prompt 08 acrescentou oito estados **sem um único `ALTER … MODIFY`** |
| `customer_report` 🔒     | `TEXT`         | NN           | O que o **cliente** relatou. Não é diagnóstico. Pode conter dado pessoal incidental                                             |
| `internal_notes`         | `TEXT`         | opcional     | Recado da equipe. Não é apresentado ao cliente                                                                                  |
| `opened_at`              | `DATETIME(3)`  | NN           | Instante da abertura, **UTC**                                                                                                   |
| `idempotency_key`        | `VARCHAR(80)`  | opcional     | Chave do comando de criação. Única por tenant; **cada `NULL` é distinto**                                                       |
| `status_changed_at`      | `DATETIME(3)`  | opcional     | **P08** — instante da última transição, **UTC**. Nulo nas ordens anteriores à migração                                          |
| `version`                | `INT UNSIGNED` | NN (=1)      | **P08** — concorrência otimista. Sobe a cada transição; o `UPDATE` compara com a versão que a pessoa leu                        |
| `assigned_technician_id` | `CHAR(36)`     | opcional, FK | **P08** — responsável. FK composta com `tenant_id`; vínculo com a unidade é verificado na hora de atribuir                      |
| `follow_up_at`           | `VARCHAR(10)`  | opcional     | **P08** — **data civil** ISO no fuso da empresa, não instante (ADR-039). Nulo = fora do radar de pendências                     |
| `follow_up_alerted_for`  | `VARCHAR(10)`  | opcional     | **P08** — prazo para o qual o evento de vencimento já saiu. Idempotência do job sem tabela de alertas                           |

## `service_order_timeline` (Prompt 07)

| Coluna             | Tipo           | Obrig.   | Significado                                                                                                      |
| ------------------ | -------------- | -------- | ---------------------------------------------------------------------------------------------------------------- |
| `service_order_id` | `CHAR(36)`     | NN, FK   | Ordem a que o fato pertence. FK composta com `tenant_id`                                                         |
| `kind`             | `VARCHAR(40)`  | NN       | Nove tipos hoje; texto, e foi por isso que o Prompt 08 acrescentou seis **sem migration**                        |
| `summary`          | `VARCHAR(300)` | opcional | Resumo legível. **Nunca carrega o relato do cliente**                                                            |
| `metadata`         | `JSON`         | opcional | Detalhe estruturado do fato — só chaves técnicas (`{ from, to, via }`). Também sem PII                           |
| `reason`           | `VARCHAR(300)` | opcional | **P08** — justificativa escrita de uma transição (obrigatória no cancelamento). Texto humano, fora do `metadata` |
| `actor_id`         | `CHAR(36)`     | opcional | Quem provocou o fato. Nulo = sistema                                                                             |
| `occurred_at`      | `DATETIME(3)`  | NN       | Quando aconteceu, **UTC**                                                                                        |

Tabela **append-only**: é a narrativa de negócio da ordem, distinta da trilha de
segurança em `audit_logs`.

## `service_order_tasks` (Prompt 08)

| Coluna                          | Tipo           | Obrig.       | Significado                                                                                           |
| ------------------------------- | -------------- | ------------ | ----------------------------------------------------------------------------------------------------- |
| `unit_id`                       | `CHAR(36)`     | **NN**, FK   | Unidade da ordem. FK composta com `tenant_id`                                                         |
| `service_order_id`              | `CHAR(36)`     | NN, FK       | Ordem a que a tarefa pertence. FK composta; `ON DELETE CASCADE`                                       |
| `kind`                          | `VARCHAR(40)`  | NN           | `delivery_preparation` ou `part_pickup`. **Não é situação da OS** — é trabalho prático                |
| `title`                         | `VARCHAR(160)` | NN           | Texto oficial da tarefa, lido na bancada                                                              |
| `description`                   | `VARCHAR(500)` | opcional     | Detalhe. Em `part_pickup`, texto livre: qual peça e onde buscar (catálogo é dos Prompts 10 e 11)      |
| `assignee_id`                   | `CHAR(36)`     | opcional, FK | Responsável. **Nulo quando quem abriu a OS perdeu acesso** — melhor sem dono do que com dono sorteado |
| `due_date`                      | `VARCHAR(10)`  | opcional     | **Data civil** ISO no fuso da empresa                                                                 |
| `status`                        | `VARCHAR(20)`  | NN (=`open`) | `open` \| `done` \| `cancelled`                                                                       |
| `open_marker`                   | `TINYINT`      | opcional     | `1` enquanto aberta, `NULL` depois. Com a UNIQUE, garante **uma tarefa aberta por tipo, por ordem**   |
| `completed_at` / `completed_by` | —              | opcional     | Quando e por quem foi concluída                                                                       |

`UNIQUE (service_order_id, kind, open_marker)`: como o MySQL trata cada `NULL`
como distinto, duas tarefas **abertas** do mesmo tipo são impossíveis e as
encerradas se acumulam à vontade. Mesmo padrão do contato principal do cliente.

---

---

## `quotes` (Prompt 09)

| Coluna                            | Tipo            | Obrig.       | Significado                                                                                             |
| --------------------------------- | --------------- | ------------ | ------------------------------------------------------------------------------------------------------- |
| `service_order_id`                | `CHAR(36)`      | **NN**, FK   | A OS a que a proposta pertence. FK composta com `tenant_id` **e** com `unit_id`                         |
| `unit_id`                         | `CHAR(36)`      | **NN**, FK   | Unidade da OS. Redundante de propósito: sustenta a FK `(service_order_id, unit_id)`                     |
| `number`                          | `INT UNSIGNED`  | NN           | Número humano; sequência do **tenant** (`tenant_sequences`, tipo `quote`), compartilhada entre unidades |
| `revision`                        | `INT UNSIGNED`  | NN (=1)      | Revisão. A revisão é **linha nova com o mesmo número** (ADR-041)                                        |
| `supersedes_quote_id`             | `CHAR(36)`      | opcional, FK | A versão que esta revisão substitui                                                                     |
| `status`                          | `VARCHAR(20)`   | NN           | `draft` \| `sent` \| `approved` \| `rejected` \| `expired` \| `superseded` \| `cancelled`               |
| `active_marker`                   | `TINYINT`       | opcional     | `1` enquanto rascunho ou enviado, `NULL` depois. Com a UNIQUE: **uma proposta viva por OS**             |
| `approved_marker`                 | `TINYINT`       | opcional     | `1` só na versão aprovada. Com a UNIQUE: **uma aprovação por OS**                                       |
| `subtotal` / `discount` / `total` | `DECIMAL(14,2)` | NN           | Recalculados pelo backend a cada gravação; o total enviado pelo formulário é ignorado                   |
| `currency`                        | `VARCHAR(3)`    | NN (=BRL)    | Existe para o dia em que houver outra. Sem multimoeda implementada                                      |
| `valid_until`                     | `VARCHAR(10)`   | opcional     | **Data civil** ISO no fuso da empresa (ADR-017). Nula: não há prazo padrão                              |
| `customer_notes` 🔒               | `TEXT`          | opcional     | Texto que o cliente verá. Separado do interno de propósito                                              |
| `internal_notes`                  | `TEXT`          | opcional     | Recado da equipe. Não vai ao cliente                                                                    |
| `sent_at` / `sent_by`             | —               | opcional     | Quando e por quem a proposta foi **formalizada** (nenhuma mensagem é enviada)                           |
| `decided_at` / `decided_by`       | —               | opcional     | Quando e quem **registrou** a decisão do cliente                                                        |
| `decision_source`                 | `VARCHAR(40)`   | opcional     | Hoje sempre `internal`. `VARCHAR` para receber `customer_portal` quando o Portal existir                |
| `decision_reason` 🔒              | `VARCHAR(300)`  | opcional     | Motivo da recusa ou do cancelamento. Texto livre de pessoa                                              |
| `version`                         | `INT UNSIGNED`  | NN (=1)      | Concorrência otimista, mesmo padrão da OS                                                               |
| `idempotency_key`                 | `VARCHAR(80)`   | opcional     | Mesmo comando não cria dois orçamentos. Cada `NULL` é distinto                                          |

## `quote_items` (Prompt 09)

| Coluna        | Tipo            | Obrig. | Significado                                                                  |
| ------------- | --------------- | ------ | ---------------------------------------------------------------------------- |
| `quote_id`    | `CHAR(36)`      | NN, FK | Orçamento a que a linha pertence. FK composta; `ON DELETE CASCADE`           |
| `kind`        | `VARCHAR(20)`   | NN     | `service` \| `part` \| `other`. **`part` NÃO é item de estoque** — Prompt 10 |
| `description` | `VARCHAR(200)`  | NN     | Obrigatória. Texto livre: a linha não depende de catálogo                    |
| `quantity`    | `DECIMAL(14,4)` | NN     | Meia hora de bancada é `0.5000`                                              |
| `unit_price`  | `DECIMAL(14,2)` | NN     | Preço em centavos; lido e escrito pelo `Money`, nunca por float              |
| `discount`    | `DECIMAL(14,2)` | NN     | Desconto da linha, em **valor**                                              |
| `total`       | `DECIMAL(14,2)` | NN     | `round(quantidade × unitário) − desconto`, calculado no backend              |
| `position`    | `INT UNSIGNED`  | NN     | Ordem de exibição                                                            |

A tabela **não tem** referência a produto, fornecedor ou SKU — há teste
arquitetural que falha se aparecer.

## `quote_timeline` (Prompt 09)

`id`, `tenant_id`, `quote_id`, `kind`, `summary`, `metadata` (JSON, sem PII),
`reason` (texto livre de pessoa, em coluna própria), `actor_id`, `occurred_at`.
Append-only, `ON DELETE CASCADE` para o orçamento.

Separada da linha do tempo da OS de propósito: a ficha do aparelho recebe o fato
resumido ("Orçamento ORC #45 enviado"), e o detalhe vive aqui.

---

## `parts` (Prompt 10)

Catálogo de peças. **TENANT-owned**: não há `unit_id`, e isso é a regra — a peça
é o vocabulário da empresa, e quem tem quantidade é o saldo.

| Coluna                                   | Observação                                                                              |
| ---------------------------------------- | --------------------------------------------------------------------------------------- |
| `code` / `code_normalized`               | código interno; a forma normalizada carrega a **UNIQUE por tenant**                     |
| `name` / `name_search`                   | `name_search` sem acento e minúsculo, para busca                                        |
| `brand` / `brand_search`                 | texto livre; não há catálogo de marcas                                                  |
| `part_number` / `part_number_normalized` | **sem unicidade**: fabricantes reusam a mesma referência                                |
| `barcode` / `barcode_normalized`         | qualquer formato; **não** presume EAN. Não há leitor de câmera                          |
| `unit_of_measure`                        | `unit` `package` `meter` `gram` `kilogram` `liter`. `unit`/`package` não aceitam fração |
| `suggested_price`                        | `DECIMAL(14,2)`. Informação comercial; o preço que vale é o aprovado no orçamento       |
| `status`                                 | `active` / `inactive`. Inativar **não apaga nada**                                      |
| `version`                                | concorrência otimista                                                                   |

---

## `stock_locations` (Prompt 10)

Posição física **dentro da unidade**. Não é a unidade.

`name` (obrigatório), `code` / `code_normalized` (**único dentro da unidade**),
`description`, `status`. Não há enum de tipo: a loja nomeia o próprio espaço.

`uq_stock_location_id_unit` é alvo da FK composta que impede uma movimentação da
unidade A apontar para a prateleira da unidade B.

---

## `stock_balances` (Prompt 10)

Saldo **materializado** por (unidade, peça). O histórico é `stock_movements`
(ADR-043).

| Coluna                 | Observação                                                                                                |
| ---------------------- | --------------------------------------------------------------------------------------------------------- |
| `on_hand`              | físico, **incluindo o que já tem dono**. `CHECK >= 0`                                                     |
| `reserved`             | comprometido com alguma OS. `CHECK >= 0` e `CHECK <= on_hand`                                             |
| `minimum_quantity`     | por peça **e** por unidade. Zero = não acompanhar                                                         |
| `average_cost`         | média ponderada móvel, calculada dentro do próprio `UPDATE`. Nulo enquanto nenhuma entrada informou custo |
| `primary_location_id`  | resumo para a listagem; FK composta com `unit_id`                                                         |
| `low_stock_alerted_at` | marca que impede o job de republicar o mesmo alerta                                                       |

`available` **não é coluna**: é `on_hand − reserved`, calculado no servidor.

---

## `stock_movements` (Prompt 10)

Ledger **append-only**. Não tem `updated_at` nem `version` — a ausência das
colunas é a primeira barreira contra "corrigir" um lançamento.

| Coluna                           | Observação                                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------------- |
| `type`                           | `receipt` `issue` `adjustment_in` `adjustment_out` `transfer_out` `transfer_in`             |
| `quantity`                       | **com sinal**: `+5` entrou, `−2` saiu                                                       |
| `resulting_on_hand`              | saldo da peça na unidade **depois** deste movimento                                         |
| `unit_cost` / `total_cost`       | congelados; mudar o custo da peça não reescreve o passado                                   |
| `origin_kind`                    | `manual` `service_order` `transfer` `purchase_order` (Prompt 11)                            |
| `reference`                      | nota, fornecedor, quem trouxe. Texto livre — é aqui que mora `Compra PC 000037` (Prompt 11) |
| `reason`                         | **obrigatório** em ajuste                                                                   |
| `service_order_id`               | FK **composta com `unit_id`**: isola a unidade no banco                                     |
| `transfer_id` / `reservation_id` | correlação                                                                                  |
| `idempotency_key`                | UNIQUE por tenant: retry não lança duas vezes                                               |

---

## `stock_reservations` (Prompt 10)

Compromisso com uma OS **da mesma unidade**. Reservar não tira nada da
prateleira (ADR-045).

`quantity`, `consumed_quantity`, `released_quantity` (`CHECK consumed + released
<= quantity`), `status` (`open` / `closed` / `cancelled`), `notes`, `version`.

`remaining = quantity − consumed − released`. A situação **deriva do que
sobrou**, calculada no `CASE` do próprio `UPDATE`.

---

## `stock_transfers` (Prompt 10)

Identidade própria da transferência. **TENANT-owned**, com origem e destino
UNIDADE — ela atravessa as duas lojas (ADR-046).

`number` (único por tenant, exibido como `TRF 000012`), `from_unit_id`,
`to_unit_id`, `part_id`, `quantity` (`CHECK > 0`), `status` (sempre `completed`
na V1 — **não há `in_transit`**), `notes`, `idempotency_key`.

As FKs compostas `(from_unit_id, tenant_id)` e `(to_unit_id, tenant_id)` tornam
o cruzamento de empresas impossível no banco.

**Não há CHECK de `from_unit_id <> to_unit_id`**: o MariaDB 10.11 recusa (erro 1901) uma FK com `ON UPDATE CASCADE` sobre coluna citada em CHECK que compara
duas colunas. A regra fica no domínio, testada; as FKs, que protegem o
isolamento, ficam no banco.

---

## `quote_items.part_id` (acrescentada no Prompt 10)

Coluna **aditiva e anulável**. Nulo é o estado normal e permanente de uma linha
escrita à mão. FK composta `(part_id, tenant_id) → parts(id, tenant_id)`,
`ON DELETE RESTRICT`.

Vincular a peça **não** substitui descrição, quantidade nem valor aprovados: o
orçamento continua sendo snapshot comercial (ADR-047).

---

## `suppliers` (Prompt 11)

Fornecedor é do **TENANT**: não há `unit_id` nesta tabela. A empresa negocia com
o distribuidor, não a loja ([ADR-052](../adr/ADR-052-fornecedor-pertence-ao-tenant.md)).

| Coluna                              | Observação                                                                        |
| ----------------------------------- | --------------------------------------------------------------------------------- |
| `kind`                              | `company` ou `individual`                                                         |
| `name` / `name_search`              | razão social e a forma normalizada para busca                                     |
| `trade_name` / `trade_name_search`  | nome fantasia                                                                     |
| `document_type` / `document_digits` | **opcional**; quando informado é validado e UNIQUE `(tenant_id, document_digits)` |
| `phone` / `phone_digits`            | o segundo é a forma só-dígitos, que a busca usa                                   |
| `lead_time_days`                    | prazo **prometido** pelo fornecedor. O real vive no histórico de preço            |
| `commercial_terms`                  | texto livre: prazo de pagamento, pedido mínimo, frete                             |
| `status`                            | `active` / `inactive`. Inativar **não apaga nada**                                |
| `version`                           | concorrência otimista                                                             |

UNIQUE auxiliar `(id, tenant_id)`, alvo das FKs compostas.

---

## `supplier_contacts` (Prompt 11)

Pessoas com quem se fala. `role`: `commercial`, `financial`, `other`.
**Dado pessoal** dentro de cadastro de empresa — ver
[data-sensitivity.md](data-sensitivity.md).

---

## `supplier_parts` (Prompt 11)

Vínculo fornecedor × peça, com UNIQUE `(tenant_id, supplier_id, part_id)`.

`last_unit_cost` e `last_purchased_at` são **conveniência de tela, não
autoridade de preço**: servem para acelerar o próximo pedido. Quem responde
"como o custo evoluiu" é `purchase_price_history`.

---

## `purchase_price_history` (Prompt 11)

**Append-only.** Uma linha por recebimento; o preço anterior nunca é
sobrescrito.

| Coluna                                      | Observação                                                                                                                               |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `supplier_id` / `part_id`                   | de quem, e do quê                                                                                                                        |
| `unit_id`                                   | em qual loja a mercadoria entrou                                                                                                         |
| `purchase_order_id` / `purchase_receipt_id` | de onde veio                                                                                                                             |
| `quantity` / `unit_cost` / `total_cost`     | o que se pagou, congelado                                                                                                                |
| `observed_lead_time_days`                   | prazo **real** entre `placed_at` e a chegada. Nulo quando o pedido não tem data de realização — inventar zero afirmaria entrega imediata |

---

## `purchase_needs` (Prompt 11)

"Precisamos comprar isto" — e não "compramos isto"
([ADR-048](../adr/ADR-048-necessidade-e-pedido-sao-coisas-diferentes.md)).
Pertence à **unidade**.

| Coluna              | Observação                                                                |
| ------------------- | ------------------------------------------------------------------------- |
| `quantity`          | quanto precisa                                                            |
| `ordered_quantity`  | quanto já entrou em pedido. **Não** significa atendida                    |
| `received_quantity` | quanto chegou de verdade. É isto que fecha a necessidade                  |
| `origin`            | `manual`, `service_order`, `low_stock`                                    |
| `service_order_id`  | opcional. FK **composta com `unit_id`**: a OS tem de ser da mesma unidade |
| `status`            | `open` `ordered` `fulfilled` `cancelled`                                  |
| `justification`     | por que precisa. Ajuda quem autoriza a despesa                            |

CHECKs garantem que as quantidades acumuladas não passem do necessário.

---

## `purchase_orders` (Prompt 11)

Pertence ao **TENANT e à UNIDADE**: a mercadoria chega em um endereço.

| Coluna                                                        | Observação                                                                                                                                             |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `number`                                                      | `PC 000037`, por empresa, sobre `tenant_sequences` (ADR-034). UNIQUE `(tenant_id, number)`                                                             |
| `status`                                                      | `draft` `approved` `placed` `partially_received` `received` `cancelled`                                                                                |
| `subtotal` / `discount` / `freight` / `other_costs` / `total` | `total = subtotal − desconto + frete + outros`. Frete **não** entra no custo da peça ([ADR-051](../adr/ADR-051-custo-comercial-e-custo-de-estoque.md)) |
| `expected_at`                                                 | data **civil** (`VARCHAR(10)`): previsão é dia de calendário                                                                                           |
| `approved_at` / `placed_at` / `cancelled_at`                  | instantes                                                                                                                                              |
| `cancel_reason`                                               | obrigatório a partir de `approved`                                                                                                                     |
| `idempotency_key`                                             | UNIQUE por tenant: duplo clique reencontra o pedido                                                                                                    |
| `version`                                                     | compare-and-swap nas transições                                                                                                                        |

UNIQUEs auxiliares `(id, tenant_id)` e `(id, unit_id)`.

---

## `purchase_order_items` (Prompt 11)

**Snapshot comercial**: `description`, `unit_of_measure` e `supplier_code` são
congelados na linha. Renomear a peça depois não reescreve pedido nenhum.

| Coluna                | Observação                                                                              |
| --------------------- | --------------------------------------------------------------------------------------- |
| `quantity`            | quanto foi pedido                                                                       |
| `received_quantity`   | quanto chegou. CHECK `received_quantity <= quantity` — a trava de over-receipt no banco |
| `unit_cost` / `total` | custo do fornecedor, congelado                                                          |
| `purchase_need_id`    | opcional: a necessidade que esta linha atende                                           |

---

## `purchase_receipts` (Prompt 11)

Uma chegada de mercadoria. Um pedido tem **N** recebimentos
([ADR-050](../adr/ADR-050-recebimento-parcial-e-o-caso-normal.md)).

| Coluna                              | Observação                                               |
| ----------------------------------- | -------------------------------------------------------- |
| `purchase_order_id`                 | FK **composta com `unit_id`**                            |
| `received_at`                       | instante da chegada                                      |
| `document_number` / `document_date` | nota fiscal. Preparado para o Financeiro, sem consumidor |
| `idempotency_key`                   | UNIQUE por tenant. É a garantia final contra duplicidade |

Não existe caminho de exclusão: correção é **ajuste de estoque, com motivo**.

---

## `purchase_receipt_items` (Prompt 11)

| Coluna                                  | Observação                                                                                                                                                                                      |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stock_movement_id`                     | FK **composta** para `stock_movements(id, tenant_id)`. A direção é Compras → Estoque, nunca o contrário ([ADR-049](../adr/ADR-049-recebimento-entra-no-estoque-pela-primitiva-do-inventory.md)) |
| `location_id`                           | onde a peça foi guardada, quando informado                                                                                                                                                      |
| `quantity` / `unit_cost` / `total_cost` | o que entrou, congelado                                                                                                                                                                         |

UNIQUE em `stock_movement_id`: um movimento pertence a um recebimento.

---

## `purchase_order_timeline` (Prompt 11)

A história do pedido em português, para quem abrir daqui a seis meses.
`kind`: `created`, `updated`, `approved`, `placed`, `partially_received`,
`received`, `cancelled`.

---

## `stock_movements.id + tenant_id` (UNIQUE acrescentada no Prompt 11)

Único ALTER do Prompt 11 sobre tabela pré-existente. É o alvo composto da FK de
`purchase_receipt_items.stock_movement_id` — o que mantém a rastreabilidade
"entrada de estoque → recebimento" **tenant-safe no banco**, sem que o Estoque
precise conhecer Compras.

---

## `financial_accounts` (Prompt 12)

**ONDE** o dinheiro fica. É o único dos três cadastros financeiros que tem saldo
([ADR-059](../adr/ADR-059-conta-financeira-e-forma-de-pagamento.md)).

| Coluna            | Observação                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------ |
| `unit_id`         | **anulável**. Nulo = compartilhada pela empresa; preenchido = serve só aquela loja         |
| `kind`            | `cash` \| `bank` \| `digital_wallet` \| `clearing` \| `other`. Congela quando há movimento |
| `current_balance` | **projeção**, não verdade. A verdade é a soma de `financial_movements`                     |
| `status`          | `active` \| `inactive`. **Não existe exclusão**                                            |

Nasce **sempre** com saldo zero: saldo não se digita.
`uq_fin_account_id_tenant UNIQUE (id, tenant_id)` é o alvo composto das FKs.

---

## `payment_methods` (Prompt 12)

**COMO** o dinheiro se moveu. Não tem saldo — é vocabulário de balcão.

`kind`: `cash`, `pix`, `debit_card`, `credit_card`, `bank_transfer`, `boleto`,
`other`. Pertence ao TENANT: a forma de pagamento é a mesma em todas as lojas.

Registrar "PIX" aqui **não integra com banco nenhum**.

---

## `financial_categories` (Prompt 12)

**POR QUE** entrou ou saiu. `kind`: `revenue` | `expense`.
Agrupa, nunca bloqueia: título sem categoria é válido.

---

## `financial_titles` (Prompt 12)

A obrigação. Uma tabela para as duas direções
([ADR-053](../adr/ADR-053-titulo-unico-com-direcao.md)).

| Coluna                                       | Observação                                                                                         |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `direction`                                  | `receivable` \| `payable`. Define contraparte, permissão, prefixo e direção no razão               |
| `number`                                     | de `tenant_sequences`, sequência por direção. `CR 000042` / `CP 000010`                            |
| `counterparty_kind`                          | `customer` \| `supplier` \| `other`. Existe **para a CHECK ter um alvo que nenhuma FK toca**       |
| `customer_id` / `supplier_id` / `payee_name` | exatamente um é preenchido, conforme a direção                                                     |
| `origin` / `origin_key`                      | `manual` \| `service_order` \| `purchase_receipt`. `UNIQUE (tenant_id, origin_key)` = idempotência |
| `amount` / `settled_amount`                  | `DECIMAL(14,2)`. `settled_amount` é a soma das parcelas                                            |
| `due_date`                                   | data civil `VARCHAR(10)`, sem fuso                                                                 |
| `installment_count`                          | ≥ 1 sempre. À vista é 1                                                                            |
| `status`                                     | `open` \| `partially_settled` \| `settled` \| `cancelled`. **Não existe `overdue`**                |
| `version`                                    | concorrência otimista (CAS)                                                                        |

CHECKs: `ck_fin_title_counterparty_direction` (compara **apenas colunas
simples**, para evitar o erro 1901 do MariaDB), `ck_fin_title_amount_positive`,
`ck_fin_title_settled_non_negative`, `ck_fin_title_no_over_settlement`,
`ck_fin_title_installments_positive`.

---

## `financial_installments` (Prompt 12)

**Todo título tem ao menos uma** — à vista é 1 de 1
([ADR-056](../adr/ADR-056-parcelamento-e-parcela-sempre.md)). Isso elimina o
`if` "se tem parcela..." de toda consulta e toda tela.

A divisão é em centavos (`bigint`) e a sobra vai para as **primeiras** parcelas.
CHECK `settled_amount <= amount`.

---

## `financial_settlements` (Prompt 12)

Cada recebimento ou pagamento registrado.

| Coluna              | Observação                                                                |
| ------------------- | ------------------------------------------------------------------------- |
| `installment_id`    | a liquidação é **sempre** de uma parcela                                  |
| `status`            | `confirmed` \| `reversed`. Estorno muda o status, **nunca apaga a linha** |
| `idempotency_key`   | `UNIQUE (tenant_id, …)`. Duplo clique reencontra em vez de duplicar       |
| `cash_session_id`   | preenchido quando a conta é caixa em espécie                              |
| `card_installments` | parcelas combinadas na maquininha. **Registro, não integração**           |
| `reversal_reason`   | obrigatório no estorno, 5 a 300 caracteres                                |

**Nunca armazena** número de cartão, CVV, senha ou token bancário (item 109).

---

## `cash_sessions` (Prompt 12)

A gaveta aberta de uma unidade
([ADR-060](../adr/ADR-060-caixa-operacional.md)).

| Coluna                               | Observação                                                            |
| ------------------------------------ | --------------------------------------------------------------------- |
| `open_marker`                        | `1` enquanto aberta, `NULL` depois. Existe **só** para o índice único |
| `opening_amount`                     | contado na gaveta, não adivinhado                                     |
| `expected_amount` / `counted_amount` | o sistema calcula o primeiro; a pessoa conta o segundo **às cegas**   |
| `difference_amount`                  | sobra ou falta. **Nunca some**: é dita em voz alta                    |

`uq_cash_session_open UNIQUE (financial_account_id, open_marker)` garante **um
caixa aberto por conta** — o MySQL trata cada `NULL` como distinto, e é por isso
que a coluna marcadora existe.

---

## `financial_movements` (Prompt 12)

O razão. **A única tabela do sistema sem `updated_at` e sem `version`** — e isso
é intencional ([ADR-054](../adr/ADR-054-razao-financeiro-append-only.md)).

| Coluna                    | Observação                                                                   |
| ------------------------- | ---------------------------------------------------------------------------- |
| `direction`               | `inflow` \| `outflow`. **O `amount` é sempre positivo**; o sinal é aqui      |
| `resulting_balance`       | o saldo **depois** deste movimento. Torna o extrato conferível linha a linha |
| `origin_kind`             | `settlement`, `reversal`, `cash_opening`, `cash_supply`, `cash_withdrawal`   |
| `reversal_of_movement_id` | `UNIQUE`: um movimento só pode ser estornado **uma vez**                     |

Uma linha nasce e nunca muda. Estorno é **contramovimento**, não `DELETE`. Há
teste de boundary que falha se qualquer arquivo escrever `UPDATE`/`DELETE` aqui.

---

## `financial_title_timeline` (Prompt 12)

A história do título em português, com autor e instante. Não é o log técnico: é
o que a pessoa lê para entender por que o saldo é esse.

---

## `warranty_policies` (Prompt 13)

O padrão que a casa oferece. **Não é a verdade da garantia emitida**
([ADR-062](../adr/ADR-062-politica-e-padrao-garantia-e-snapshot.md)).

| Coluna                                      | Observação                                                   |
| ------------------------------------------- | ------------------------------------------------------------ |
| `name` / `name_search`                      | nome interno; `name_search` normaliza para busca e ordenação |
| `type`                                      | `internal` \| `factory` \| `part` \| `extended`              |
| `duration_amount` / `duration_unit`         | 1 a 120; `days` ou `months`. CHECK `duration_amount > 0`     |
| `coverage_summary` / `exclusions` / `terms` | textos **copiados** na emissão, nunca lidos depois           |
| `status`                                    | `active` \| `inactive`. Desativar não apaga                  |
| `version`                                   | concorrência otimista (CAS)                                  |

---

## `warranties` (Prompt 13)

A garantia em si. Snapshot dos termos no momento da emissão.

| Coluna                                       | Observação                                                                 |
| -------------------------------------------- | -------------------------------------------------------------------------- |
| `number`                                     | de `tenant_sequences`. `GAR 000042`                                        |
| `type`                                       | `internal` \| `factory` \| `part` \| `extended`. Só `internal` gera OS     |
| `policy_id`                                  | **procedência**, nunca fonte de leitura                                    |
| `customer_id` / `equipment_id`               | FK composta com `tenant_id`                                                |
| `service_order_id`                           | FK composta com `unit_id`. Nulo nas garantias registradas sobre o aparelho |
| `duration_amount` / `duration_unit`          | copiados da política ou informados                                         |
| `coverage_summary` / `exclusions` / `terms`  | **copiados**. A política pode mudar; isto não                              |
| `covers_whole_service`                       | `tinyint`. 0 = cobertura parcial, e a lista passa a ser a verdade          |
| `starts_on` / `ends_on`                      | data civil `VARCHAR(10)`. Fim **inclusivo**                                |
| `status`                                     | `draft` \| `active` \| `cancelled` \| `revoked`. **Não existe `expired`**  |
| `manufacturer` / `external_reference`        | a quem recorrer numa garantia de fábrica                                   |
| `part_id` / `part_description` / `part_code` | garantia de peça. Funciona **sem** o módulo de Estoque                     |
| `installed_on` / `stock_movement_id`         | quando a peça saiu do estoque                                              |
| `supplier_id`                                | de quem veio a peça. Leitura, não integração                               |
| `idempotency_key`                            | `UNIQUE`. Duplo clique reencontra em vez de duplicar                       |
| `version`                                    | concorrência otimista (CAS)                                                |

CHECKs: `ck_warranty_period_ordered` (`starts_on <= ends_on`),
`ck_warranty_duration_positive`.

---

## `warranty_coverage_items` (Prompt 13)

O que exatamente está coberto. Existe porque um booleano "tem garantia"
transformaria o retorno pela placa em garantia aceita quando a loja garantiu
apenas a fonte.

| Coluna        | Observação                                               |
| ------------- | -------------------------------------------------------- |
| `kind`        | `labor` \| `service` \| `part` \| `component` \| `other` |
| `description` | até 200 caracteres                                       |
| `part_id`     | opcional, quando o Estoque está ativo                    |
| `position`    | ordem de exibição                                        |

---

## `warranty_certificates` (Prompt 13)

Snapshot do documento, com soma de verificação
([ADR-070](../adr/ADR-070-certificado-e-snapshot-com-token-opaco.md)).

| Coluna     | Observação                                                          |
| ---------- | ------------------------------------------------------------------- |
| `snapshot` | JSON completo. Montado a partir da **garantia**, nunca da política  |
| `checksum` | SHA-256 do conteúdo                                                 |
| `token`    | 24 bytes aleatórios em base64url. Opaco, não enumerável, **UNIQUE** |
| `format`   | formato da representação registrada na emissão                      |

`UNIQUE (tenant_id, warranty_id)` — um certificado por garantia. Gerar de novo
devolve o mesmo documento e o mesmo token.

**O token identifica; ele não autoriza.** Nunca carrega dado pessoal.

### Colunas do arquivo PDF (Prompt 13.1)

Todas anuláveis: o certificado existe sem PDF desde o Prompt 13, e os históricos
continuam válidos sem reemissão.

| Coluna                  | Observação                                                                   |
| ----------------------- | ---------------------------------------------------------------------------- |
| `pdf_storage_key`       | chave opaca no storage, **sem PII no caminho**                               |
| `pdf_mime_type`         | `application/pdf`                                                            |
| `pdf_byte_size`         | tamanho do arquivo                                                           |
| `pdf_checksum`          | SHA-256 dos **bytes**. Não se confunde com `checksum`, que é do **snapshot** |
| `pdf_snapshot_checksum` | de qual versão de snapshot este arquivo saiu — revela arquivo envelhecido    |
| `pdf_page_count`        | páginas do documento                                                         |
| `pdf_generated_at`      | quando o arquivo foi produzido                                               |
| `pdf_renderer`          | renderizador e versão, para diagnóstico                                      |

A gravação usa compare-and-swap sobre `pdf_storage_key`: gerações simultâneas
produzem um artefato só
([ADR-072](../adr/ADR-072-pdf-do-certificado-e-programatico.md)).

---

## `warranty_returns` (Prompt 13)

O aparelho voltou. A OS original **nunca reabre**
([ADR-065](../adr/ADR-065-retorno-cria-os-nova.md)).

| Coluna                      | Observação                                                    |
| --------------------------- | ------------------------------------------------------------- |
| `warranty_id`               | qual garantia foi acionada                                    |
| `original_service_order_id` | de onde veio                                                  |
| `return_service_order_id`   | a OS nova. `UNIQUE` — dois retornos não apontam a mesma ordem |
| `reference_date`            | data civil do dia, **congelada**                              |
| `was_enforceable`           | a garantia valia **naquele** dia. Não é recalculado           |
| `coverage_assessment`       | `covered` \| `not_covered` \| `undetermined`                  |
| `customer_report`           | o relato de quem trouxe o aparelho                            |
| `idempotency_key`           | `UNIQUE`. Dois atendentes clicando juntos criam **uma** OS    |

---

## `warranty_costs` (Prompt 13)

Quanto a garantia custou à loja. **Não gera lançamento financeiro**
([ADR-071](../adr/ADR-071-custo-de-garantia-nao-toca-o-financeiro.md)).

| Coluna               | Observação                                                |
| -------------------- | --------------------------------------------------------- |
| `kind`               | `labor` \| `part` \| `outsourced` \| `freight` \| `other` |
| `amount`             | `DECIMAL(14,2)`. CHECK `amount >= 0`                      |
| `warranty_return_id` | opcional — liga o custo ao atendimento                    |

Permissão de leitura separada (`warranties.costs.view`): o atendente precisa da
cobertura, não da margem.

---

## `warranty_timeline` (Prompt 13)

A história da garantia em português, com ator e instante. Emissão, ativação,
certificado, retorno, reclassificação, cancelamento e revogação.

---

## Colunas adicionadas a `service_orders` (Prompt 13)

Três `ADD COLUMN` puros, com default seguro. Nenhuma migration histórica foi
tocada.

| Coluna                      | Observação                                                                                                                        |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `classification`            | `standard` \| `warranty_internal`, default `standard`. **Não é status** ([ADR-067](../adr/ADR-067-classificacao-nao-e-status.md)) |
| `warranty_id`               | a garantia que originou esta OS. Sem FK por ordem de criação de tabelas                                                           |
| `original_service_order_id` | a OS de onde o retorno veio                                                                                                       |

A integridade do vínculo é garantida do outro lado, em `warranty_returns`, que
tem FK composta para as duas ordens.

---

## Tipos monetários e de quantidade

Definidos como convenção em `src/core/db/columns.ts`, aplicáveis assim que
existir a primeira entidade financeira:

| Helper           | Tipo SQL        | Uso                                           |
| ---------------- | --------------- | --------------------------------------------- |
| `money()`        | `DECIMAL(14,2)` | Valor final: preço, pagamento, total          |
| `moneyPrecise()` | `DECIMAL(14,4)` | Custo unitário, rateio, cálculo intermediário |
| `quantity()`     | `DECIMAL(14,4)` | Quantidade — pode ser fracionária             |
| `currency()`     | `CHAR(3)`       | ISO 4217. `BRL` inicial                       |
| `civilDate()`    | `VARCHAR(10)`   | Data civil ISO, sem fuso                      |

As primeiras colunas monetárias chegaram com Orçamentos (Prompt 09) e Estoque
(Prompt 10): `quotes.subtotal/discount/total`, `quote_items.unit_price`,
`parts.suggested_price`, `stock_balances.average_cost` e
`stock_movements.unit_cost/total_cost`.

`quantity()` é usada por `quote_items.quantity` e por todo o Estoque. O valor
exato em TypeScript é a classe `Quantity` (`src/core/quantity/quantity.ts`), que
guarda décimos de milésimo em `bigint` — quantidade **não é dinheiro**, e um
saldo que erra na quarta casa recusa reserva legítima sem ninguém entender por
quê.

---

## Agenda e Tarefas (Prompt 14, migration 0013)

Duas tabelas novas. Nenhuma tabela existente ganhou coluna.

### `agenda_tasks`

Trabalho que **uma pessoa** anotou. Distinta de `service_order_tasks`, que é
consequência de uma transição da OS — a comparação formal está na
[ADR-073](../adr/ADR-073-uma-arquitetura-de-tarefas-com-dois-papeis.md).

| Coluna                                                           | Tipo                   | Nota                                                        |
| ---------------------------------------------------------------- | ---------------------- | ----------------------------------------------------------- |
| `unit_id`                                                        | `varchar(36)` NOT NULL | tarefa acontece em algum lugar                              |
| `status`                                                         | `varchar(20)`          | `open` \| `done` \| `cancelled`, o vocabulário do Prompt 08 |
| `priority`                                                       | `varchar(10)`          | `low` \| `normal` \| `high` \| `urgent`                     |
| `due_date`                                                       | `civilDate()`          | prazo é **dia**, não instante                               |
| `idempotency_key`                                                | `varchar(120)`         | `UNIQUE (tenant_id, idempotency_key)`                       |
| `service_order_id`, `customer_id`, `equipment_id`, `warranty_id` | `varchar(36)`          | vínculos **opcionais**                                      |
| `version`                                                        | `int unsigned`         | CAS otimista                                                |

### `agenda_appointments`

Hora reservada. As quatro colunas temporais existem para que **instante e dia
civil nunca se misturem**: com horário valem `start_at`/`end_at`; dia inteiro
vale `start_date`/`end_date`, e o par não usado vai a `NULL`.

| Coluna                    | Tipo          | Nota                                        |
| ------------------------- | ------------- | ------------------------------------------- |
| `status`                  | `varchar(20)` | `scheduled` \| `cancelled` — **sem `done`** |
| `all_day`                 | `tinyint`     |                                             |
| `start_at` / `end_at`     | `instant()`   | `CHECK (end_at > start_at)`                 |
| `start_date` / `end_date` | `civilDate()` | `CHECK (end_date >= start_date)`            |

### Correção de redação na 0013

A migration também corrige a descrição da tarefa sistêmica de preparação, de
`conferencia estetica` para `conferência estética`, recortando por
`kind = 'delivery_preparation'`. A identidade da tarefa é
`(service_order_id, kind, open_marker)` — texto não identifica nada, então a
correção não duplica, não reabre e não toca em estado
([ADR-075](../adr/ADR-075-compatibilidade-com-o-follow-up-historico.md)).

---

## Motor de Automações (Prompt 19, migration 0016)

Cinco tabelas novas. Nenhuma tabela existente ganhou coluna. Ver
[ADR-082](../adr/ADR-082-motor-de-automacoes-fechado-por-catalogo.md) e
[ADR-083](../adr/ADR-083-autoridade-de-configuracao-nao-e-autoridade-de-runtime.md),
e `docs/modules/automations/` para o detalhamento por assunto.

### `automation_rules`

Ponteiro mutável: nome, se está habilitada, escopo e qual versão está ativa.

| Coluna               | Tipo          | Nota                                                               |
| -------------------- | ------------- | ------------------------------------------------------------------ |
| `enabled`            | `boolean`     | desabilitada nunca produz execução nova                            |
| `scope_kind`         | `varchar(20)` | `UNIT_SET` \| `TENANT_WIDE` — `CHECK`                              |
| `current_version_id` | `varchar(36)` | **referência sem FK** (evita ciclo com `automation_rule_versions`) |
| `archived_at`        | `instant()`   | arquivar preserva histórico; nunca dispara de novo                 |

Índice `ix_automation_rule_tenant_enabled (tenant_id, enabled)` — hot path do
disparo por evento e do tick de agendamento (ver
`docs/modules/automations/performance.md`).

### `automation_rule_units`

Escopo de unidade **persistido** na criação — nunca "todas as unidades que o
usuário tem hoje" recalculado dinamicamente. PK composta
`(rule_id, unit_id)`.

### `automation_rule_versions`

Definição **imutável** da regra: gatilho, condições, ações. Editar a regra
sempre grava uma versão nova; nunca sobrescreve a existente.

| Coluna           | Tipo           | Nota                                                        |
| ---------------- | -------------- | ----------------------------------------------------------- |
| `version_number` | `int unsigned` | `UNIQUE (rule_id, version_number)`                          |
| `trigger_kind`   | `varchar(20)`  | `domain_event` \| `schedule` — `CHECK`                      |
| `trigger_key`    | `varchar(80)`  | chave do `AutomationTriggerCatalog`, nunca string livre     |
| `definition`     | `json`         | condições + ações, sempre validadas por Zod antes de gravar |

### `automation_executions`

Um disparo real de uma regra contra um evento ou uma ocorrência de
agendamento.

| Coluna            | Tipo           | Nota                                                                                  |
| ----------------- | -------------- | ------------------------------------------------------------------------------------- |
| `trigger_ref`     | `varchar(190)` | id do evento de domínio, ou a ocorrência agendada (`YYYY-MM-DD`)                      |
| `idempotency_key` | `varchar(240)` | **a trava real**: `UNIQUE (tenant_id, idempotency_key)`, nunca `SELECT`-then-`INSERT` |
| `status`          | `varchar(20)`  | `skipped` \| `running` \| `succeeded` \| `failed` — `CHECK`                           |
| `input_snapshot`  | `json`         | mínimo necessário para explicar o disparo; nunca a entidade inteira, nunca PII        |

### `automation_action_attempts`

Append-only: uma linha por tentativa de uma ação de uma execução.

| Coluna              | Tipo           | Nota                                                                                                                |
| ------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------- |
| `action_index`      | `int unsigned` | posição da ação na lista da versão (0-based)                                                                        |
| `attempt_number`    | `int unsigned` | `UNIQUE (execution_id, action_index, attempt_number)` — trava de claim concorrente                                  |
| `error_code`        | `varchar(60)`  | código estável (`PROVIDER_NOT_CONFIGURED`, `INVALID_RECIPIENT`, ...)                                                |
| `domain_result_ref` | `varchar(36)`  | **sem FK**: id da linha produzida no módulo alvo (messageId/taskId) — Automations lê o resultado, nunca é dono dele |

### Por que cinco tabelas, e não três

A tentação óbvia seria uma tabela `automation_rules` com a definição embutida
e uma `automation_executions`. Separar Rule de RuleVersion é o que permite
"editar não apaga histórico" sem duplicar a regra inteira a cada edição — só
a definição, que é o que realmente muda. Separar Execution de ActionAttempt é
o que permite uma execução com várias ações, cada uma com seu próprio
histórico de tentativas (retry), sem misturar o status agregado da execução
com o status de cada passo.
