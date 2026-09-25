# Observabilidade

## `part_search_provider_calls` — operacional, nunca comercial

Uma linha por chamada ao provedor externo: `provider_key`, `status`
(`ok`/`error`/`timeout`/`not_configured`), `result_count`, `error_code`
(um `PartSearchErrorCode` — nunca o corpo/stack cru do provedor),
`latency_ms`, `requested_at`. Isto é telemetria de infraestrutura — nunca
o snapshot comercial observado (esse é `part_search_offers`, item 69).

## Logs

`logger.warn`/`logger.error` registram `sessionId`, `tenantId` (via
contexto), `provider`/`kind`/`rejectedCount` — nunca o texto livre da
consulta, nunca o corpo da resposta do provedor.

## O que não existe nesta V1 (e por quê)

- **Monitoramento de saúde do provedor** além do último resultado de
  chamada (item 187) — sem histórico de uptime, sem alerta automático:
  não há provedor real para monitorar ainda.
- **Métrica de custo de provedor** — `part_search_provider_calls` tem
  espaço para isso (`resultCount`/`latencyMs`), mas nenhum campo de custo
  foi adicionado: nenhum provedor real informa custo hoje, e inventar um
  violaria o mesmo princípio de "nunca inventar dado" que rege o resto do
  módulo (item 188).

## EXPLAIN

Ver `docs/modules/part-search/performance.md` (relatório de performance)
para os planos de consulta das rotas mais usadas: candidatos de uma
sessão, ofertas de um candidate, buscas recentes de uma unidade.
