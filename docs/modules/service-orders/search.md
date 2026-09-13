# Busca e listagem

## Escopo: a unidade ativa

A listagem mostra as ordens da **unidade ativa**, como a de recebimentos. Sem
unidade selecionada a lista vem vazia e a página explica o motivo, oferecendo o
seletor — em vez de somar as lojas, o que contrariaria o isolamento do Prompt 03.

## O que a busca encontra

Um único campo procura por:

- **número da OS** — `1234`, `OS 1234`, `OS #001234`, `os#1234`;
- nome do cliente;
- tipo, marca e modelo do equipamento;
- número de série, em qualquer formatação (`y1-2345` acha `Y12345`).

O número tem caminho próprio: vira **igualdade** sobre `ix_service_order_tenant_number`,
não `LIKE '%…%'`. As demais comparam com as colunas normalizadas gravadas junto
ao cadastro, dos dois lados já preparadas — em vez de aplicar função sobre a
coluna e descartar o índice.

## Filtros

Apenas atributos que existem: **período de abertura** (de/até), **cliente**,
**situação**, **acompanhamento** (vencido / vence hoje / futuro) e **técnico
responsável**.

Os três últimos chegaram com o Prompt 08 e usam índices próprios
(`ix_service_order_unit_status`, `ix_service_order_follow_up`,
`ix_service_order_technician`). Uma situação desconhecida na URL é **ignorada**,
não vira consulta.

O filtro de acompanhamento compara com o **dia civil da empresa**, não com UTC
(ver [follow-ups](follow-ups.md)).

A coluna Situação traz o rótulo em **texto** junto do tom de cor: quem não
distingue verde de amarelo continua sabendo em que situação a ordem está.

Busca e filtros viajam na URL (`method="get"`): o endereço resultante pode ser
guardado, compartilhado e reaberto, e o botão voltar funciona. Os filtros
aplicados aparecem como etiquetas, porque lista curta filtrada não é lista vazia.

## Ordenação e paginação

`opened_at DESC, id DESC` — mais recentes primeiro, com desempate determinístico
por `id`. Sem ele, duas ordens do mesmo milissegundo poderiam trocar de lugar
entre páginas e uma sumir da listagem.

Paginação por offset, no servidor. A paginação preserva os filtros vigentes.

## Sem N+1

A listagem faz **três consultas** para N ordens: a página (com `INNER JOIN` de
cliente e equipamento e `LEFT JOIN` de unidade e do técnico responsável), o
total, e **uma consulta agregada** para a contagem de tarefas abertas da página
inteira. Uma consulta por linha transformaria uma lista de 25 ordens em 26 idas
ao banco — e esta é a tela mais aberta do sistema. Nunca uma consulta
por linha.

Na ficha, os nomes dos autores da linha do tempo vêm em **uma** consulta com
`inArray`, não uma por fato.

O mesmo vale para as telas de Equipamentos e Recebimentos, que precisam saber se
cada recebimento já tem ordem: `mapServiceOrdersByIntake` resolve a página
inteira numa consulta.
