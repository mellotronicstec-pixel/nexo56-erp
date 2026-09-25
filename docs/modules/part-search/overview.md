# Busca de Peças — Visão Geral

**Prompt 21.** "Compatibilidade vem antes do preço." Um resultado
encontrado não é peça confirmada; um candidato não é item de estoque; uma
oferta não prova compatibilidade. A Busca de Peças é uma ferramenta de
apoio à decisão — nunca decide, nunca compra, nunca reserva.

## O problema real

Um técnico abre uma OS, precisa de uma peça e não sabe se a que existe no
estoque (ou num marketplace) serve para aquele modelo de equipamento. A
busca hoje era "olhar de memória" ou ligar para o fornecedor. A Busca de
Peças organiza essa pergunta: dado um termo/código e o contexto técnico do
equipamento, mostra o que existe (interno e, quando configurado, externo),
com uma classificação honesta de compatibilidade — nunca inventada.

## O que este prompt entrega

- Busca interna: cruza o catálogo de peças (`parts`) e o saldo de estoque
  da unidade (`stock_balances`, via `loadBalance`), mais o histórico de
  compra (`purchase_price_history`, via `listPriceHistoryForPart`) — tudo
  lido pelas portas de aplicação oficiais do Estoque e das Compras, nunca
  duplicado.
- Busca externa **opcional**: um `PartSearchProvider` estruturado — sem
  fornecedor real decidido nesta V1 (mesma situação do Nexo56 AI, ADR-085):
  fora de produção usa um provedor de captura determinístico; em produção,
  sem provedor real configurado, falha honestamente com
  `PART_SEARCH_PROVIDER_NOT_CONFIGURED` e a busca interna continua
  funcionando sozinha.
- Cinco rótulos oficiais de compatibilidade — **Confirmada, Alta
  Probabilidade, Provável, Não Verificada, Incompatível** — calculados por
  um `CompatibilityAssessor` puro e determinístico a partir de evidências
  com proveniência, nunca por "confiança" da IA.
- Um `Ranking` lexicográfico: compatibilidade sempre decide primeiro,
  preço só desempata por último.
- Seleção humana explícita e, só depois dela, a opção (também explícita)
  de criar uma necessidade de compra usando a porta oficial de Compras.

## O que este prompt NÃO faz (fora de escopo, deliberado)

- Não compra, não cria Pedido de Compra, não reserva estoque, não move
  nada sozinho.
- Não usa Base de Conhecimento/diagnóstico (Prompt 22) — nem manual, nem
  embedding, nem RAG.
- Não faz busca por imagem/OCR (isso é Prompt 06, Captura de Etiqueta).
- Não decide margem/preço de venda.
- Não altera o status da OS — "Buscar peça (IA)" é ação, nunca estado,
  igual à `PartPickupPanel` já existente (que continua sendo outra coisa:
  um lembrete manual de retirada, não uma busca técnica).

## Onde entra no produto

Botão "Buscar peça (IA)" na página da Ordem de Serviço, disponível em
qualquer situação da OS (não depende de status). Abre um diálogo com
formulário de busca e lista de resultados classificados. Ver `ui.md`.

## Documentos relacionados

`architecture.md`, `sources.md`, `compatibility.md`, `ranking.md`,
`providers.md`, `privacy-security.md`, `purchasing-integration.md`,
`observability.md`, `ui.md`, `future.md`. ADR-086 registra as decisões
arquiteturais.
