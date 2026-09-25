# Interface

## Onde vive

Botão "Buscar peça" na página da OS
(`ordens-de-servico/[serviceOrderId]/part-search-panel.tsx`), ao lado do
`PartPickupPanel` existente — **não é a mesma coisa**: o painel existente
cria uma tarefa manual de retirada ("o que buscar e onde"), sempre em
`awaiting_part`; este é uma ferramenta de classificação técnica
determinística, disponível em qualquer situação da OS (item 80). Sem
"(IA)" no rótulo (correção pós-CI #33): a busca não depende do Nexo56 AI
— ver `ai-independence.md`.

## Fluxo

1. Diálogo (`Modal`, tamanho `lg`) com campo de termo/código.
2. Resultados agrupados visualmente por origem: "No seu estoque",
   "Histórico de compra" e "Resultados externos" — nunca misturados sem
   rótulo (item 57).
3. Cada resultado mostra: título, código, marca, badge de compatibilidade
   (texto, não só cor — `Badge` do Design System já carrega o rótulo por
   extenso), evidências em texto curto, e as ofertas (preço, vendedor,
   disponibilidade, prazo, "consultado em").
4. Preço histórico aparece como "Última compra registrada: R$X em
   DD/MM", nunca como "Disponível por R$X" (item 58).
5. CTA nunca é "Comprar": "Selecionar esta oferta" / "Selecionar peça".
6. `Incompatível`: sem botão de seleção, com aviso explícito.
7. `Não Verificada`: seleção pede uma segunda confirmação explícita
   (aviso + botão "Confirmar seleção mesmo assim").
8. Depois de selecionar, se aplicável (candidate interno + permissão de
   Compras), aparece "Criar necessidade de compra" — ação distinta,
   nunca automática.
9. Disclaimer fixo: "Preço e disponibilidade foram consultados no
   momento da busca e podem ter mudado."

## Estados

- Sem resultado: "Nenhuma peça encontrada para os critérios informados."
  (nunca tratado como erro).
- Busca externa indisponível (`not_configured`/`error`/`timeout`):
  aviso amarelo, resultados internos continuam visíveis.
- Sem acesso ao Estoque na unidade: aviso informativo, só externos
  aparecem (quando disponíveis).

## Acessibilidade e responsividade

Reaproveita os componentes do Design System (`Modal`, `FormField`,
`Badge`, `Alert`, `Button`) — foco preso no diálogo, Esc/clique fora
fecham, rótulos ligados a controles, mensagens de erro em texto (nunca só
cor). Sem CSS específico de layout fixo: os componentes já são
responsivos por padrão do Design System (grid fluido, sem largura fixa
que quebre em 360px).

## Sem tema

Nenhum modo escuro, nenhum white-label — mesma paleta e tipografia
(Sora/Inter) do resto do Nexo56.
