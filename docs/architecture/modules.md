# Módulos

A fundação (Prompts 01–04) contém somente módulos **estruturais**. Os módulos de
negócio entram um por prompt, cada um com feature, permissões, ownership e
testes próprios — nunca como placeholder (Prompt 01, itens 8 e 82).

## Estruturais

| Módulo                 | Responsabilidade                                                 | Tabelas                                                                             |
| ---------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `auth`                 | senha, sessão, login, redefinição, contexto autenticado          | `sessions`, `password_reset_tokens`                                                 |
| `tenancy`              | empresa (tenant) e unidades; provisionamento                     | `tenants`, `units`                                                                  |
| `users`                | usuários e vínculo com unidades                                  | `users`, `user_units`                                                               |
| `access-control`       | papéis, permissões, escopo por unidade e autorização             | `roles`, `permissions`, `role_permissions`, `user_roles`, `user_unit_roles`         |
| `features`             | catálogo, entitlements, configuração do tenant, Effective Access | `features`, `feature_dependencies`, `plans`, `plan_entitlements`, `tenant_features` |
| `audit`                | trilha de auditoria                                              | `audit_logs`                                                                        |
| `events`               | eventos de domínio e despacho                                    | `domain_events`                                                                     |
| `jobs`                 | fila, executor e handlers técnicos                               | `jobs`                                                                              |
| `core` (compartilhado) | env, banco, erros, log, IDs, contexto, rate limit                | —                                                                                   |

## De negócio

| Módulo           | Prompt | Responsabilidade                                                                   | Tabelas                                                                                                                                                                                                             |
| ---------------- | ------ | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `customers`      | 05     | pessoas e empresas atendidas, contatos e endereços                                 | `customers`, `customer_contacts`, `customer_addresses`                                                                                                                                                              |
| `equipment`      | 06     | aparelhos, recebimento, acessórios, inspeção, fotos e leitura de etiqueta          | `equipment`, `equipment_intakes`, `equipment_intake_accessories`, `equipment_intake_conditions`, `equipment_media`, `equipment_label_readings`                                                                      |
| `service-orders` | 07–08  | abertura, numeração, vínculos, ficha, histórico e **workflow** da Ordem de Serviço | `service_orders`, `service_order_timeline`, `service_order_tasks`                                                                                                                                                   |
| `quotes`         | 09     | propostas comerciais da OS: itens, valores, envio, aprovação, recusa e revisões    | `quotes`, `quote_items`, `quote_timeline`                                                                                                                                                                           |
| `inventory`      | 10     | catálogo de peças, localizações, saldos, ledger, reservas e transferências         | `parts`, `stock_locations`, `stock_balances`, `stock_movements`, `stock_reservations`, `stock_transfers`                                                                                                            |
| `purchasing`     | 11     | fornecedores, necessidades, pedidos, recebimento parcial e histórico de custo      | `suppliers`, `supplier_contacts`, `supplier_parts`, `purchase_price_history`, `purchase_needs`, `purchase_orders`, `purchase_order_items`, `purchase_receipts`, `purchase_receipt_items`, `purchase_order_timeline` |
| `finance`        | 12     | contas a receber e a pagar, parcelas, liquidação, estorno, razão e caixa           | `financial_accounts`, `payment_methods`, `financial_categories`, `financial_titles`, `financial_installments`, `financial_settlements`, `cash_sessions`, `financial_movements`, `financial_title_timeline`          |
| `warranties`     | 13     | políticas, garantias, cobertura, certificado, retorno, custo e histórico           | `warranty_policies`, `warranties`, `warranty_coverage_items`, `warranty_certificates`, `warranty_returns`, `warranty_costs`, `warranty_timeline`                                                                    |

O `equipment` usa também a abstração de armazenamento de arquivos
(`core/storage`), introduzida no Prompt 06: os bytes das fotos ficam fora do
banco e fora de `public/` (ADR-030).

## Dependências entre módulos

```
core  ←── todos

tenancy ──→ features (plano do tenant)
users   ──→ tenancy
auth    ──→ users, tenancy, audit, events
access-control ──→ users, tenancy, features, auth
features ──→ tenancy, audit, events
audit   ──→ core
events  ──→ core
jobs    ──→ auth (handler de limpeza de sessão), core

customers      ──→ tenancy, access-control, features, audit, events
equipment      ──→ customers, tenancy, access-control, features, audit, events, core/storage
service-orders ──→ customers, equipment, tenancy (sequencias), access-control, features, audit, events
quotes         ──→ service-orders (workflow + leitura), tenancy (sequencias), money, access-control, features, audit, events
inventory      ──→ service-orders (leitura + linha do tempo), tenancy (sequencias), money, quantity, access-control, features, audit, events
purchasing     ──→ inventory (primitiva de entrada), service-orders (leitura), tenancy (sequencias), money, quantity, access-control, features, audit, events
finance        ──→ service-orders, quotes, purchasing, customers (LEITURA apenas), tenancy (sequencias), money, access-control, features, audit, events
warranties     ──→ service-orders (primitiva de criacao + workflow), equipment, customers, inventory (LEITURA opcional), purchasing (LEITURA opcional), tenancy (sequencias), money, access-control, features, audit, events
```

`finance` lê os módulos operacionais e **nunca escreve neles**. Nenhum deles
importa `finance`: as seções financeiras na ficha da OS, do pedido de compra, do
cliente e do fornecedor vivem na camada de páginas, como as demais seções que
cruzam módulos. O teste de boundary falha se `service-orders`, `quotes`,
`inventory` ou `purchasing` importarem de `finance`, e também se `core`
importar — com a única exceção de `core/db/schema.ts`, o barril do Drizzle, que
por construção reexporta o schema de todos os módulos e nunca um serviço.

`warranties` chama **duas primitivas** de `service-orders` —
`planServiceOrderCreation`/`applyServiceOrderCreation` e
`planTransition`/`applyTransition` — e nunca escreve em `service_orders.status`
por conta própria. `service-orders` **não importa** `warranties`: as seções de
garantia na ficha da OS e do equipamento vivem na camada de páginas, como as
demais seções que cruzam módulos.

`warranties` **não escreve** em `inventory` nem em `finance`. As leituras de
peça e fornecedor são opcionais — a garantia de peça funciona com
`part_description` e `part_code` quando o Estoque está desligado. Custo de
garantia é registro interno e **não cria** título nem movimento no razão
(ADR-071). O teste de boundary falha se `warranties` importar
`finance/application` ou escrever em `stock_balances`, `stock_movements`,
`stock_reservations` ou `financial_movements`.

`inventory` **nunca** importa `quotes`, e `quotes/application` **nunca** importa
`inventory`: a única ponte é a FK `quote_items.part_id → parts`, declarada no
schema. O grafo continua acíclico, e os dois sentidos são verificados por teste
de arquitetura (ADR-047).

`customers` não conhece `equipment`, e nenhum dos dois conhece `service-orders`:
as seções que cruzam módulos (Equipamentos na ficha do cliente, Ordem de Serviço
na ficha do recebimento) vivem na camada de páginas. As dependências são de mão
única, e foi o que permitiu à Ordem de Serviço depender dos dois sem criar ciclo.

`service-orders` reusa `tenancy` para a numeração (`tenant_sequences`, ADR-034)
em vez de criar um segundo mecanismo de sequência.

Sem ciclo na camada de aplicação. Entre os arquivos de `schema.ts` existe um
ciclo **de tipo** deliberado (`tenants.plan_id → plans` e
`tenant_features.tenant_id → tenants`), resolvido pelas referências preguiçosas
do Drizzle (`references(() => ...)`), que só são avaliadas na geração da
migration — não na carga do módulo.

## Regras para acrescentar um módulo

1. Criar `src/modules/<nome>/{domain,application,infrastructure}`.
2. Declarar as tabelas em `infrastructure/schema.ts` **com `tenant_id`** quando
   forem entidades de negócio, e exportá-las em `src/core/db/schema.ts`.
3. Declarar a feature em `FEATURE_CATALOG` e as permissões em
   `PERMISSION_CATALOG` — nunca criar chave solta em runtime.
4. Responder às 12 perguntas de modularidade (classificação; pode desativar;
   dependências; dependentes; dados ao desativar; frontend; backend/API;
   automações; permissões; plano; reativação; histórico). Exemplos respondidos:
   [Equipamentos](../modules/equipment/modularity.md) e
   [Ordens de Serviço](../modules/service-orders/modularity.md) e
   [Orçamentos](../modules/quotes/modularity.md) e
   [Estoque](../modules/inventory/modularity.md).
5. Acrescentar testes de travessia entre tenants para as novas consultas.
6. Gerar migration (`npm run db:generate`) e revisar o SQL antes de aplicar.
