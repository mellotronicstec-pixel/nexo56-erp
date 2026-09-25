# Performance

`EXPLAIN` contra MariaDB de teste, nas consultas reais do módulo — todas
usam índice (`type: ref`/`range`), nenhuma varre a tabela inteira.

## Candidatos de uma sessão (tela de resultados)

```sql
EXPLAIN SELECT id, source_type, title, part_number, brand, part_id, compatibility_label
FROM part_search_candidates WHERE tenant_id=? AND session_id=?;
-- type=ref, key=fk_part_search_candidate_session_tenant, rows=1, Using index condition
```

## Ofertas de um candidate

```sql
EXPLAIN SELECT id, source_key, price, availability
FROM part_search_offers WHERE tenant_id=? AND candidate_id=?;
-- type=ref, key=fk_part_search_offer_candidate_tenant, rows=1, Using index condition
```

## Buscas recentes de uma unidade

```sql
EXPLAIN SELECT id, status, query_term, created_at
FROM part_search_sessions WHERE tenant_id=? AND unit_id=? ORDER BY created_at DESC LIMIT 20;
-- type=range, key=ix_part_search_session_tenant_unit_created, Using where
```

## Chamadas de provedor de uma sessão (observabilidade)

```sql
EXPLAIN SELECT id, provider_key, status
FROM part_search_provider_calls WHERE tenant_id=? AND session_id=?;
-- type=ref, key=fk_part_search_provider_call_session_tenant, rows=1, Using index condition
```

## Seleções de um candidate

```sql
EXPLAIN SELECT id FROM part_search_selections WHERE tenant_id=? AND candidate_id=?;
-- type=ref, key=fk_part_search_selection_candidate_tenant, rows=1, Using where; Using index
```

## Busca interna no catálogo (`parts`)

```sql
EXPLAIN SELECT id, code, name, brand, part_number, part_number_normalized, suggested_price
FROM parts WHERE tenant_id=? AND status='active'
  AND (name_search LIKE ? OR brand_search LIKE ? OR code_normalized LIKE ? OR part_number_normalized LIKE ?);
-- type=ref, key=uq_part_tenant_code (entra pelo tenant_id), Using index condition; Using where
```

O `LIKE '%termo%'` não pode usar o índice para o próprio filtro de texto
— mesma limitação, aceita, do `buildPartSearch` que o Estoque já usa
(`docs/modules/inventory/` documenta a mesma escolha: "não é busca
inteligente, é `LIKE` sobre colunas indexadas"). O que importa para o
volume esperado (catálogo de uma assistência técnica, não um
marketplace) é que o filtro por `tenant_id` já entra pelo índice,
evitando varrer o catálogo de outros tenants — nunca full scan
multi-tenant. Sem Elasticsearch nem motor de busca full-text nesta V1
(item 251/252) — compatível com hospedagem inicial modesta (item 253).

## Índices adicionados (migration 0019)

Todos justificados por um padrão de consulta real do módulo:
`ix_part_search_session_tenant_unit_created` (buscas recentes de uma
unidade), `ix_part_search_session_order` (buscas de uma OS),
`ix_part_search_candidate_session` (resultados de uma sessão),
`ix_part_search_evidence_candidate`/`ix_part_search_offer_candidate`
(detalhe de um candidate), `ix_part_search_provider_call_session`
(observabilidade de uma sessão),
`ix_part_search_selection_session`/`ix_part_search_selection_candidate`
(auditoria de seleção). Nenhum índice especulativo sem consulta real por
trás.
