# ADR-047 — O orçamento continua sendo snapshot comercial

**Status:** Aceito
**Data:** Prompt 10 — Estoque e Peças
**Itens atendidos:** 39, 40, 41, 42, 85, 86, 108, 109, 110, 130

## Contexto

O Prompt 09 criou `quote_items` com descrição escrita à mão e sem referência a
catálogo — porque catálogo não existia. O Prompt 10 trouxe o catálogo real e
pede, no item 39, um vínculo **opcional** entre linha PART e peça.

O risco óbvio: transformar o orçamento em um `JOIN`. No dia em que alguém
renomear a peça ou reajustar o preço, a proposta que o cliente aprovou mudaria
sozinha.

## Decisão

**`quote_items.part_id` é coluna aditiva, anulável, e puramente referencial.**

- **Nulo é o estado normal e permanente** de uma linha escrita à mão. Todas as
  linhas existentes continuam válidas, com vínculo nulo (item 130).
- Escolher a peça no editor preenche descrição e valor **como conveniência, no
  momento da escolha**. Dali em diante o orçamento guarda os próprios números.
- Mudar nome, código ou preço sugerido da peça **não altera** orçamento
  nenhum — enviado, aprovado ou rascunho.
- Ler um orçamento **não depende** do módulo de Estoque: tudo que a proposta
  precisa dizer já está gravado nela (item 110).

## Direção da dependência

O grafo continua acíclico (item 85):

- o **schema** de `quote_items` referencia `parts`, para a FK composta
  `(part_id, tenant_id)` garantir coerência de empresa no banco;
- a **camada de aplicação** do orçamento **não** importa nada de estoque. O id
  chega opaco, é gravado, e a FK é a autoridade;
- o módulo de estoque **nunca** importa o de orçamentos.

Isso é verificado por teste de arquitetura em `quote-workflow-boundary.test.ts`
e em `inventory-boundary.test.ts`.

A feature `core.quotes` **não** depende de `operations.inventory`: com Estoque
desligado, o editor recebe lista de peças vazia e continua inteiro, com linha
PART manual (item 86).

## Nenhum movimento por causa de orçamento

Salvar, enviar ou aprovar **não** movimenta e **não** consome estoque. Testado
em `tests/integration/inventory-quote.test.ts`, contando movimentações e
reservas antes e depois do ciclo completo.

## Alternativas consideradas

| Alternativa                                            | Por que não                                                                                      |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Linha PART obrigatoriamente ligada ao catálogo         | Quebraria todo orçamento existente e impediria orçar peça que a loja ainda não cadastrou.        |
| Ler descrição e preço da peça na exibição do orçamento | A proposta aprovada mudaria sozinha quando a peça mudasse.                                       |
| Validar a peça na camada de aplicação do orçamento     | Criaria dependência de build do Orçamento para com o Estoque, sem ganho: a FK já é a autoridade. |

## Consequências

- A revisão do orçamento herda o vínculo, como herda todo o resto.
- A ficha da peça pode responder "quais orçamentos citaram esta peça?" pelo
  índice `ix_quote_item_part`.
- Apagar uma peça é `RESTRICT` — o catálogo se inativa, não se apaga.
