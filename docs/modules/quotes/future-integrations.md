# Fronteira com os próximos módulos

O que o Prompt 09 **preparou** e o que deliberadamente **não** fez.

## O que NÃO foi antecipado

| Não existe                    | Por quê                                                   |
| ----------------------------- | --------------------------------------------------------- |
| Peça como item de estoque     | Prompt 10. A linha `part` guarda **texto livre**          |
| Reserva de peça               | Prompt 10                                                 |
| Movimentação de estoque       | Prompt 10 — aprovar orçamento **não** movimenta nada      |
| Fornecedor, pedido de compra  | Prompt 11                                                 |
| Contas a receber, pagamento   | Prompt 12 — aprovar **não** cria lançamento financeiro    |
| Regras de garantia            | Prompt 13                                                 |
| Envio de WhatsApp/e-mail      | Prompt 16 — "enviar" formaliza, não transmite             |
| Aprovação pelo cliente online | Prompt 17 (Portal) — a origem gravada é sempre `internal` |
| Automações sobre os eventos   | Prompt 19 — sete eventos publicados, zero consumidores    |
| PDF do orçamento              | não há infraestrutura documental; ver abaixo              |
| Tributação / NF-e / NFS-e     | módulo fiscal futuro                                      |
| Multimoeda                    | BRL apenas; a coluna `currency` existe, a lógica não      |

Verificado em navegador real: a ficha do orçamento não contém "Estoque",
"Reservar peça", "Fornecedor", "Pedido de compra", "Contas a receber",
"Pagamento", "Garantia", "Portal do cliente", "Gerar PDF" nem "Em breve".

## PDF — o que existe e o que falta

**Não foi gerado nenhum PDF**, e isso é deliberado: não há infraestrutura
documental no projeto (nem armazenamento de documento, nem layout oficial, nem
os ativos de marca — a logo ainda não foi fornecida, ver `public/brand/`).

O que já está pronto para quando houver:

- todos os dados que o documento precisa (número, revisão, cliente e equipamento
  pela OS, itens, valores, validade, observações do cliente);
- a separação entre `customer_notes` e `internal_notes`, para o documento não
  vazar recado de equipe;
- o conceito de imutabilidade pós-envio, que é o que torna um **snapshot**
  documental correto: o PDF de uma versão enviada nunca vai divergir do que
  está no banco, porque aquela versão não muda mais.

Quando existir, o PDF será **apresentação**, nunca fonte de verdade: o banco e o
domínio continuam sendo a autoridade.

## O que o Prompt 10 — Estoque e Peças encontra pronto

| Precisa de                               | Já existe                                            |
| ---------------------------------------- | ---------------------------------------------------- |
| Linha de peça com descrição e quantidade | `quote_items` com `kind = 'part'`                    |
| Quantidade fracionada segura             | `DECIMAL(14,4)` + `Money`                            |
| Momento em que a necessidade vira real   | evento `QUOTE_APPROVED`, no outbox                   |
| Tarefa operacional ligada à OS           | `service_order_tasks` (Prompt 08), com `part_pickup` |
| Estado "Aguardando Peça" na OS           | matriz do workflow (Prompt 08)                       |
| Vínculo tenant/unidade seguro            | FKs compostas, já no padrão                          |

O caminho natural é `quote_items` ganhar uma coluna **aditiva e opcional**
apontando para o item de catálogo — o que já foi proposto continua valendo como
está, em texto.

## Pendências declaradas

| Pendência                             | Situação                                                                                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Orçamento complementar após aprovação | Sem caminho hoje: exigiria transição `Aguardando Conserto → Aguardando Aprovação`, que é decisão de negócio. Ver [revisions](revisions.md) |
| Desconto percentual                   | Só valor implementado, por decisão de não-ambiguidade. Entra como coluna aditiva                                                           |
| Prazo de validade padrão              | Não existe; é manual. Inventar um seria criar regra que ninguém pediu                                                                      |
| Estimativa de prazo de reparo         | Não implementada — evitar campo que ninguém preenche                                                                                       |
| Notificação de orçamento expirado     | O evento é publicado; **não há canal** para avisar ninguém                                                                                 |
