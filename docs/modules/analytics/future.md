# Evoluções futuras do Painel (não implementadas)

Documentado, não construído — em linha com "construir simples para hoje sem
impedir a infraestrutura de amanhã".

- **Seleção livre de N unidades.** `AnalyticsScope` já suporta qualquer
  subconjunto das unidades autorizadas; a UI V1 só expõe "todas" ou "uma
  específica". Um seletor multi-escolha é aditivo, sem mudança de
  arquitetura.
- **Comparação de períodos** (últimos 30 dias vs. 30 dias anteriores) com
  variação percentual, tratando denominador zero como "novo"/"—".
- **Drill-down de finalizações/cancelamentos no período.** Hoje sem link
  porque a lista oficial de OS filtra por `opened_at`, não por
  `status_changed_at` (ver `metric-catalog.md`). Precisaria de um filtro
  aditivo em `listServiceOrders` ou de uma lista própria do Painel — ambos
  fora de escopo deste prompt.
- **Snapshots/materialização diária.** Só com evidência de que a live query
  deixou de performar sob volume real (ver `performance.md` e ADR-081).
- **Custo de garantia** (`warranties.costs.view`) como métrica agregada.
- **Exportação (CSV/XLSX) e impressão em PDF.**
- **Metas, ranking, benchmark, forecasting, insight gerado por IA.**
  Explicitamente fora de escopo dos Prompts 18 a 22.
- **Personalização/arranjo de widgets.** Aguarda um prompt dedicado de
  preferências/tema.
