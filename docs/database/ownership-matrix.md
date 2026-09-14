# Matriz de ownership — Nexo56

Escopo de cada entidade (Prompt 02, itens 6 a 14 e 85).

**Nenhuma entidade de negócio fica sem ownership definido.**

---

## Entidades existentes (implementadas e migradas)

| Entidade                       | Escopo                | Tenant         | Unit                   | Histórico | Soft delete                  |
| ------------------------------ | --------------------- | -------------- | ---------------------- | --------- | ---------------------------- |
| `tenants`                      | plataforma            | — (é o tenant) | —                      | não       | não — `status`               |
| `units`                        | tenant                | obrigatório    | — (é a unidade)        | não       | não — `status`               |
| `users`                        | tenant                | obrigatório    | via `user_units`       | não       | não — `status`               |
| `user_units`                   | associação            | obrigatório    | obrigatório            | não       | não — hard delete            |
| `sessions`                     | tenant                | obrigatório    | não                    | não       | não — `revoked_at`           |
| `roles`                        | tenant                | obrigatório    | não                    | não       | não — `is_system` protege    |
| `permissions`                  | **global**            | não            | não                    | não       | não                          |
| `role_permissions`             | associação            | via `role`     | não                    | não       | não — hard delete            |
| `user_roles`                   | associação            | obrigatório    | não                    | não       | não — hard delete            |
| `user_unit_roles`              | associação            | obrigatório    | obrigatório            | não       | não — hard delete            |
| `password_reset_tokens`        | tenant                | obrigatório    | não                    | não       | não — `used_at`/`expires_at` |
| `features`                     | **global**            | não            | não                    | não       | não — `status`               |
| `feature_dependencies`         | **global**            | não            | não                    | não       | não                          |
| `plans`                        | **global**            | não            | não                    | não       | não                          |
| `plan_entitlements`            | **global**            | não            | não                    | não       | não                          |
| `tenant_features`              | tenant                | obrigatório    | não                    | não       | **não — desativar preserva** |
| `tenant_sequences`             | tenant                | obrigatório    | não                    | não       | não                          |
| `audit_logs`                   | tenant                | opcional¹      | opcional               | **sim**   | **nunca**                    |
| `domain_events`                | tenant                | opcional¹      | não                    | **sim**   | **nunca**                    |
| `jobs`                         | tenant                | opcional²      | não                    | não       | não — `status`               |
| `customers`                    | tenant                | obrigatório    | **não**³               | não       | não — `status`               |
| `customer_contacts`            | tenant                | obrigatório    | não                    | não       | não — hard delete            |
| `customer_addresses`           | tenant                | obrigatório    | não                    | não       | não — hard delete            |
| `equipment`                    | tenant                | obrigatório    | **não**⁴               | não       | não — `status`               |
| `equipment_intakes`            | **tenant + unidade**  | obrigatório    | **obrigatório**        | **sim**⁵  | **nunca**                    |
| `equipment_intake_accessories` | via recebimento       | obrigatório    | herdado                | não       | cascata do recebimento       |
| `equipment_intake_conditions`  | via recebimento       | obrigatório    | herdado                | não       | cascata do recebimento       |
| `equipment_media`              | tenant                | obrigatório    | herdado do recebimento | **sim**⁶  | remoção explícita            |
| `equipment_label_readings`     | tenant                | obrigatório    | não                    | **sim**   | cascata do equipamento       |
| `service_orders`               | **tenant + unidade**  | obrigatório    | **obrigatório**        | **sim**⁷  | **nunca**                    |
| `service_order_timeline`       | via ordem             | obrigatório    | herdado                | **sim**   | **nunca**                    |
| `service_order_tasks`          | **tenant + unidade**  | obrigatório    | **obrigatório**⁸       | não       | cascata da ordem             |
| `quotes`                       | **tenant + unidade**⁹ | obrigatório    | **obrigatório**        | **sim**   | **nunca**                    |
| `quote_items`                  | via orçamento         | obrigatório    | herdado                | não       | cascata do orçamento         |
| `quote_timeline`               | via orçamento         | obrigatório    | herdado                | **sim**   | cascata do orçamento         |

¹ Nulo em evento de plataforma anterior ao tenant existir.
² Nulo em job técnico global (ex.: limpeza de sessões expiradas).
³ **Cliente pertence ao tenant** (ADR-026). `origin_unit_id` é procedência
auditável, nunca filtro.
⁴ **Equipamento pertence ao tenant e ao cliente** (ADR-029). Não se duplica
porque passou por outra unidade; quem registra a unidade é o recebimento.
⁵ O recebimento é um **acontecimento**: cada entrada é uma linha nova, e uma
entrada posterior nunca sobrescreve a anterior.
⁶ A foto é prova de como o aparelho estava naquele dia. Corrigir o cadastro do
equipamento depois **não** altera a mídia.
⁷ A Ordem de Serviço é registro histórico operacional: não se exclui, e cliente,
equipamento e unidade não mudam depois da abertura (ADR-033). Cancelamento é
**estado do workflow** (`cancelled`, Prompt 08), nunca `DELETE`.
⁸ A tarefa herda a unidade da ordem e é trabalho operacional, não histórico: ela
segue a ordem no `CASCADE`. Encerrar a OS **cancela** as tarefas abertas — cada
uma com seu próprio registro de auditoria, porque "a ordem foi cancelada" não
explica, meses depois, por que a tarefa que estava na bancada de alguém sumiu.
⁹ A unidade do orçamento **vem da Ordem de Serviço**, nunca da sessão, e a
coerência é imposta pela FK composta `(service_order_id, unit_id)` — ADR-040. O
orçamento é registro comercial e histórico: não se exclui, e a versão que o
cliente viu nunca é reescrita (ADR-041).

### Justificativa das tabelas globais (item 7)

`permissions`, `features`, `feature_dependencies`, `plans` e
`plan_entitlements` descrevem **o produto**, não os dados de uma empresa. A
chave `users.view` significa a mesma coisa em todos os tenants; fragmentá-la
por tenant impediria evoluir o produto de forma coerente. Nenhuma delas é
global por conveniência.

---

## Entidades futuras (conceituais — ainda NÃO existem no banco)

Decisões de ownership já fixadas, para evitar retrabalho estrutural:

| Entidade                 | Escopo           | Tenant      | Unit              | Histórico | Soft delete |
| ------------------------ | ---------------- | ----------- | ----------------- | --------- | ----------- |
| `service_order_timeline` | tenant + unidade | obrigatório | herdado           | **sim**   | **nunca**   |
| `quotes`                 | tenant + unidade | obrigatório | herdado da OS     | não⁵      | **não**     |
| `quote_items`            | tenant           | obrigatório | herdado           | não       | não         |
| `parts`                  | tenant           | obrigatório | não⁶              | não       | sim         |
| `inventory`              | tenant + unidade | obrigatório | **obrigatório**   | não       | não         |
| `inventory_movements`    | tenant + unidade | obrigatório | **obrigatório**   | **sim**   | **nunca**   |
| `suppliers`              | tenant           | obrigatório | não               | não       | sim         |
| `purchase_requests`      | tenant + unidade | obrigatório | obrigatório       | não       | não         |
| `purchase_orders`        | tenant + unidade | obrigatório | obrigatório       | não       | não         |
| `payments`               | tenant + unidade | obrigatório | **obrigatório**   | **sim**   | **nunca**   |
| `warranties`             | tenant           | obrigatório | origem registrada | **sim**   | **nunca**   |
| `tasks`                  | tenant           | obrigatório | opcional          | não       | sim         |
| `appointments`           | tenant + unidade | obrigatório | obrigatório       | não       | sim         |
| `communications`         | tenant           | obrigatório | opcional          | **sim**   | **nunca**   |
| `attachments`            | tenant           | obrigatório | opcional          | não       | sim         |

> `clients`, `client_contacts`, `addresses`, `equipments` e `service_orders`
> saíram desta lista: foram implementados como `customers`, `customer_contacts`,
> `customer_addresses` (Prompt 05), `equipment` (Prompt 06) e `service_orders`
> (Prompt 07), com o ownership que estava previsto aqui.

⁵ O documento em si não é histórico, mas suas mudanças de estado alimentam uma
timeline própria.

⁶ O **cadastro** da peça é do tenant; o **estoque físico** dela é por unidade
(`inventory`). São coisas diferentes (item 64).

---

## Regra de `unit_id` obrigatório (item 11)

Entidade cuja operação pertence necessariamente a uma unidade:

- **Ordem de Serviço** (`service_orders`, Prompt 07) e **recebimento de
  equipamento** (`equipment_intakes`, Prompt 06) — ambos implementados
- Estoque físico e movimentação de estoque
- Caixa e movimentação operacional por unidade
- Compra e recebimento vinculados a unidade
- Agenda operacional vinculada a unidade

Toda unidade pertence a um tenant, e **todo tenant tem pelo menos uma unidade**
(item 10): empresa de loja única opera com uma unidade padrão, e não com uma
arquitetura diferente.

Quando `unit_id` existir, a FK é composta `(unit_id, tenant_id)` — nunca só
`unit_id`.
