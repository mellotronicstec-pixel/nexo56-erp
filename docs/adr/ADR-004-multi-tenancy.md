# ADR-004 — Estratégia multi-tenant compartilhada

**Status:** Aceito · **Data:** Prompt 01

## Contexto

Decisão do proprietário (D3): banco compartilhado com `tenant_id` obrigatório
nas entidades de negócio aplicáveis.

## Decisão

- **Um banco, um schema, coluna `tenant_id`** nas entidades de negócio.
- `tenant_id` é `NOT NULL` com **foreign key** para `tenants`, `ON DELETE
RESTRICT` — empresa com dados não pode ser apagada por cascata.
- Índices **compostos** começando por `tenant_id` nas colunas de consulta
  (`ix_users_tenant_status`, `ix_units_tenant_status`, `ix_audit_tenant_created`).
- Unicidade é **por tenant**, não global: `uq_users_tenant_email`,
  `uq_units_tenant_name`, `uq_roles_tenant_key`.
- Tabelas de catálogo global (`features`, `permissions`, `plans`) **não** têm
  `tenant_id` — são o mesmo produto para todos.

## Motivo

- Um único banco cabe no plano contratado (quantidade de bancos e de conexões
  é limitada em hospedagem compartilhada).
- Migrations aplicam-se uma vez, não N vezes.
- Consultas administrativas e agregações futuras não precisam de fan-out.

## Alternativas consideradas

| Alternativa       | Por que não                                                     |
| ----------------- | --------------------------------------------------------------- |
| Schema por tenant | Multiplica migrations e conexões; inviável no plano inicial.    |
| Banco por tenant  | Mesma objeção, agravada; e a Hostinger limita bancos por plano. |

## Consequências

- O isolamento passa a ser **responsabilidade da aplicação** — daí o ADR-005 e
  os testes obrigatórios de travessia entre tenants.
- Um bug de escopo vaza dados entre empresas. Por isso o caminho seguro é o
  caminho padrão (ADR-005) e existe suíte dedicada a isso.
- `uq_users_tenant_email` implica que a mesma pessoa pode ter conta em duas
  empresas — tratado no login (ADR-006).
