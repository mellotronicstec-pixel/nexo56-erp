# Fora de Escopo (deliberado)

- **Provedor externo real.** Nenhuma decisão de fornecedor foi tomada;
  quando existir, entra só em `provider-registry.ts`.
- **Enriquecimento por Nexo56 AI** (normalização de descrição, sugestão
  de termos, explicação em linguagem natural). O prompt permite ("se
  fizer sentido"), mas exige uma capacidade própria, sem poluir o
  catálogo de tasks de escrita do Prompt 20 (item 189/190) — não
  implementado nesta V1 porque a busca deterministica já cumpre o
  requisito de "funcionar sem IA real" (item 12) sozinha, e adicionar uma
  superfície de IA nova é trabalho arquitetural genuíno que merece seu
  próprio ciclo de decisão (vendor, prompt, guardas), não um adendo. Nota:
  o Feature Catalog do CI #33 declarava `ai.part_search` dependente de
  `ai.core`, contradizendo esta mesma frase — corrigido logo em seguida
  (ver `ai-independence.md`); a busca em si nunca chamou IA nenhuma.
- **Base de Conhecimento / Diagnóstico** (Prompt 22) — manuais, PDFs,
  histórico de diagnóstico, embeddings, RAG. Não iniciado.
- **APIs/Integrações** (Prompt 23). Não iniciado.
- **Busca por imagem/OCR.** Separado da Captura de Etiqueta (Prompt 06).
- **Múltiplos provedores simultâneos com merge determinístico** (item
  130/131) — a arquitetura (`PartSearchProvider` como porta, um `name`
  por provedor, `provider_calls` por chamada) já comporta mais de um
  provedor no futuro sem mudança de schema; só não há um segundo hoje.
- **Fila/worker para a busca externa** (item 254) — V1 é request/response
  síncrono; a porta não impede mover para fila depois.
- **Índice único em `purchase_needs`** para fechar a janela de corrida da
  idempotência (ver `purchasing-integration.md`) — pertence ao módulo de
  Compras, fora da propriedade deste prompt.
- **Elasticsearch/motor de busca full-text** — `LIKE` sobre colunas
  normalizadas e indexadas é suficiente para o volume esperado
  (compatível com hospedagem inicial modesta, item 251-253).
