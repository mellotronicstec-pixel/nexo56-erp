# Multi-tenancy e isolamento

Estratégia: **banco compartilhado com `tenant_id`** (decisão D3 do
proprietário; ver [ADR-004](../adr/ADR-004-multi-tenancy.md) e
[ADR-005](../adr/ADR-005-isolamento-tenant-aware.md)).

## Como o Tenant A é impedido de acessar o Tenant B

São quatro barreiras, e nenhuma delas depende do frontend.

### 1. O tenant nasce da sessão, não do cliente

`getCurrentContext()` é o **único** caminho pelo qual um `tenantId` entra na
aplicação:

```
cookie nexo56_session (token opaco)
        ↓ SHA-256
linha em `sessions` (não revogada, não expirada)
        ↓ session.tenant_id
TenantContext.tenantId
```

Não existe parâmetro de rota, cabeçalho, corpo de requisição ou campo de
formulário capaz de influenciar qual tenant será usado.

### 2. Toda consulta é escopada na origem

```ts
// tenancy-queries.ts
.where(scopedWhere(context, units.tenantId, eq(units.id, unitId)))
```

`scopedWhere` combina `tenant_id = <tenant da sessão>` com as demais condições.
Passar o ID de uma unidade de outro tenant **não retorna linha** — o registro
existe, mas está fora do escopo da consulta.

### 3. Escrita não aceita tenant injetado

`TenantScope.values()` sobrescreve qualquer `tenantId` recebido de fora:

```ts
scope.values({ name: 'X', tenantId: outroTenant }).tenantId; // === tenant da sessão
```

### 4. Barreira final para registros vindos por outro caminho

`scope.assertOwnership(registro)` lança `AuthorizationError` — nunca devolve
`false` em silêncio.

## Camada de banco

- `tenant_id NOT NULL` com FK para `tenants`, `ON DELETE RESTRICT`.
- Índices compostos começando por `tenant_id`.
- Unicidade **por tenant**: `uq_users_tenant_email`, `uq_units_tenant_name`,
  `uq_roles_tenant_key`.
- Catálogo global (`features`, `permissions`, `plans`) não tem `tenant_id`.

## Unidades

`user_units` define quais unidades o usuário pode acessar. A unidade "atual"
vem de cookie, mas **só vale se estiver entre as autorizadas**; caso contrário
o sistema cai na primeira unidade autorizada.

## Testes obrigatórios

`tests/integration/tenant-isolation.test.ts` cobre os quatro cenários do
Prompt 01, item 22:

1. usuário de A acessa recurso de A;
2. usuário de A não vê recurso equivalente de B (unidades, usuários, auditoria);
3. manipulação de ID não atravessa tenant — inclusive provando que o ID existe
   e só não é alcançado por causa do escopo;
4. o tenant vem da sessão: sessão de A com usuário de B não monta contexto, e
   unidade fora das autorizadas é ignorada.
