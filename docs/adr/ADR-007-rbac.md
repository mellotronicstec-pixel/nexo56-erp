# ADR-007 — RBAC

**Status:** Aceito · **Data:** Prompt 01

## Decisão

- **`permissions`**: catálogo **global** do produto (mesma chave = mesmo
  significado em todos os tenants). Declarado em código
  (`PERMISSION_CATALOG`) e sincronizado para o banco.
- **`roles`**: **por tenant**, com papéis de sistema (`is_system = true`)
  criados no provisionamento.
- **`role_permissions`** e **`user_roles`**: tabelas de associação.
- Nomenclatura: `<recurso>.<acao>` — `view` (leitura), `manage`
  (criar/editar/desativar).
- As permissões efetivas são carregadas uma vez, na montagem do
  `TenantContext`, e viajam como `ReadonlySet`.

## Motivo

- Papéis por tenant permitem que cada empresa organize seus perfis sem afetar
  as outras; permissões globais evitam que a mesma chave signifique coisas
  diferentes em empresas diferentes.
- Permissão controla **ação**, não tela — a Constituição é explícita nisso
  (Prompt 00, item 23).
- O sistema não fica preso aos nomes de perfil: `admin` é apenas o papel
  estrutural do bootstrap.

## Alternativas consideradas

| Alternativa                   | Por que não                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------ |
| Strings de perfil no frontend | Proibido pelo Prompt 01, item 17; não é mecanismo de segurança.                      |
| ABAC / políticas por atributo | Complexidade sem demanda atual; o RBAC pode evoluir para escopos por unidade depois. |
| Permissões por tenant         | Fragmentaria o significado das chaves e complicaria upgrades do produto.             |

## Consequências

- Permissões novas entram no catálogo em código e são sincronizadas por
  `syncCatalog()` — não há permissão "solta" criada em runtime.
- Escopo por unidade ainda não existe: hoje a permissão vale no tenant.
  O modelo comporta essa evolução sem reconstrução (`user_units` já existe).
