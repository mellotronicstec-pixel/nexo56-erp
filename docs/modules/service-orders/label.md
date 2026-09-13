# Etiqueta física e QR

## Estado real

**A etiqueta não é imprimível hoje.** Não há rota de impressão, não há layout
publicado e `isLabelPrintable()` responde `false`.

O que existe é o **contrato de dados**, implementado e testado.

## Os cinco elementos

A Constituição fixa cinco, e mais nenhum:

| #   | Elemento                                 | Estado                                              |
| --- | ---------------------------------------- | --------------------------------------------------- |
| 1   | Nome do cliente                          | **existe**                                          |
| 2   | Número da OS                             | **existe**                                          |
| 3   | Tensão                                   | **existe**                                          |
| 4   | Indicação de garantia (quando aplicável) | **pendente** — depende da classificação (Prompt 13) |
| 5   | QR Code                                  | **pendente** — depende da referência opaca segura   |

`buildLabelData()` devolve exatamente esses cinco campos, com `warranty` e
`qrToken` em `null`. Preencher qualquer um deles com um palpite produziria
etiqueta errada colada no aparelho de um cliente.

## Por que não imprimir três quintos

Porque uma etiqueta incompleta **parece** completa. Colada no aparelho, ela seria
tratada como a etiqueta oficial do Nexo56 — e a ausência do QR só apareceria no
dia em que alguém tentasse lê-lo.

Item 82 do Prompt 07 autoriza preparar contrato, layout e serviço de dados, mas
proíbe declarar a etiqueta operacional enquanto os requisitos estiverem
pendentes. A escolha feita foi: **contrato sim, interface não** — porque uma tela
de etiqueta que avisa "faltam elementos" seria exatamente o placeholder que o
item 59 proíbe na interface operacional.

## Tensão (item 84)

Vem do equipamento:

| Cadastro                 | Etiqueta                    |
| ------------------------ | --------------------------- |
| `v110` / `v127` / `v220` | `110 V` / `127 V` / `220 V` |
| `bivolt`                 | `Bivolt`                    |
| `not_applicable`         | `N/A`                       |
| `unknown`                | `Nao identificada`          |

Nunca em branco e nunca um chute: etiqueta sem tensão e etiqueta com tensão
errada levam ao mesmo lugar, que é o técnico ligando um 110 na tomada de 220.

## O que a etiqueta nunca terá (item 83)

Telefone, CPF, endereço, defeito, acessórios, técnico, senha, preço, código de
barras extra, observações, marca, modelo, serial. Há teste que falha se qualquer
um desses campos aparecer no objeto da etiqueta.

## QR — princípios já fixados, implementação pendente

Quando for implementado:

- **referência opaca e não previsível** — nunca o UUID cru, nunca dado pessoal;
- primeira finalidade: abrir a OS **dentro do ambiente autenticado**;
- **QR identifica, não autoriza.** Sessão, tenant e permissão autorizam. Um QR
  que desse acesso por si só transformaria um adesivo no aparelho numa chave.

## Dimensão física

Não definida pelo negócio. Nenhum tamanho foi inventado; quando houver decisão,
o layout deve ser adaptável ou configurável.

## Nenhum ADR foi criado para a etiqueta

O item 121 pede ADR "se efetivamente decidida". A estratégia de QR — formato do
token, ciclo de vida, revogação — **não está decidida**; o que existe é a
recusa em imprimir enquanto faltarem elementos, registrada aqui.
