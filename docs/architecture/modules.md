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

| Módulo      | Prompt | Responsabilidade                                                          | Tabelas                                                                                                                                        |
| ----------- | ------ | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `customers` | 05     | pessoas e empresas atendidas, contatos e endereços                        | `customers`, `customer_contacts`, `customer_addresses`                                                                                         |
| `equipment` | 06     | aparelhos, recebimento, acessórios, inspeção, fotos e leitura de etiqueta | `equipment`, `equipment_intakes`, `equipment_intake_accessories`, `equipment_intake_conditions`, `equipment_media`, `equipment_label_readings` |

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

customers ──→ tenancy, access-control, features, audit, events
equipment ──→ customers, tenancy, access-control, features, audit, events, core/storage
```

`customers` não conhece `equipment`: a seção "Equipamentos" da ficha do cliente
vive na camada de páginas, não no módulo de Clientes. A dependência é de mão
única, e é o que permitirá a Ordem de Serviço depender dos dois sem criar ciclo.

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
   automações; permissões; plano; reativação; histórico). Exemplo respondido:
   [Equipamentos](../modules/equipment/modularity.md).
5. Acrescentar testes de travessia entre tenants para as novas consultas.
6. Gerar migration (`npm run db:generate`) e revisar o SQL antes de aplicar.
