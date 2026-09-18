# ADR-069 — Garantia de peça não é garantia de serviço

**Status:** Aceito
**Data:** Prompt 13 — Garantias
**Itens atendidos:** 4, 5, 38, 39, 40, 41, 103

## Contexto

A loja troca uma fonte. Duas coberturas nascem do mesmo atendimento e **não são
a mesma coisa**:

- a **mão de obra** da troca, garantida pela loja por 90 dias;
- a **peça**, garantida pelo fabricante ou pelo distribuidor por 12 meses.

Tratá-las como um registro só obrigaria a escolher um prazo — e qualquer escolha
estaria errada para metade dos casos. Pior: quando a peça falha no mês 6, quem
responde é o fornecedor, não a bancada; e quando a solda falha no mês 2, quem
responde é a loja.

## Decisão

**Quatro tipos de garantia, com significados distintos:**

| Tipo       | Quem responde         | De onde nasce             |
| ---------- | --------------------- | ------------------------- |
| `internal` | a loja                | OS concluída              |
| `factory`  | o fabricante          | registro sobre o aparelho |
| `part`     | fornecedor/fabricante | peça instalada            |
| `extended` | contrato estendido    | registro sobre o aparelho |

Só `internal` gera Ordem de Serviço de garantia automaticamente
(`originatesInternalWarrantyService`). Nas demais, a loja **intermedeia**: o
retorno é registrado, o histórico é preservado, e o encaminhamento ao terceiro é
trabalho humano — o Nexo56 não abre chamado em fabricante nem compra peça
sozinho.

A garantia de peça carrega `part_id`, `part_description`, `part_code`,
`part_quantity`, `installed_on`, `stock_movement_id` e `supplier_id`. Com o
módulo de Estoque ativo, `part_id` e `stock_movement_id` apontam o registro
real; sem ele, `part_description` e `part_code` sustentam o caso sozinhos —
Garantias **não exige** Estoque.

## `covers_whole_service` e os itens de cobertura

O caso que obriga a lista: a OS trocou a fonte, reparou a placa e fez limpeza,
mas a garantia concedida cobre **apenas** o reparo da fonte. Um booleano
"tem garantia" transformaria o retorno por defeito na placa em garantia aceita,
e a loja consertaria de graça um serviço que nunca garantiu.

Por isso `warranty_coverage_items` existe, com `kind` (`labor`, `service`,
`part`, `component`, `other`) e descrição. Cobertura parcial é dita na tela, em
destaque, na ficha e no certificado.

## Consequências

**Ganhamos:** prazos corretos por natureza, e a possibilidade de responder "a
peça ainda tem garantia, a mão de obra não" — que é a resposta verdadeira no mês 5.

**Pagamos:** um aparelho pode acumular várias garantias simultâneas, e o fluxo
de retorno começa perguntando **qual** delas está sendo acionada. É a pergunta
certa.
