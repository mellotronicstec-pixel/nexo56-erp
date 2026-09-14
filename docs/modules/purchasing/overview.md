# Fornecedores e Compras — visão geral

**Feature key:** `operations.purchasing` · **Tipo:** OPTIONAL · **Depende de:**
`operations.inventory`

## O que este módulo resolve

Antes do Prompt 11, a peça aparecia no estoque por entrada manual e ninguém
sabia de onde ela veio, quanto custou, nem se alguém ainda estava esperando
mercadoria chegar. Este módulo responde quatro perguntas:

1. **De quem compramos?** — cadastro de fornecedores, com contatos e condições
   comerciais.
2. **O que está faltando?** — necessidades de compra, registradas por pessoas.
3. **O que já pedimos e ainda não chegou?** — pedidos com situação e pendência.
4. **Quanto pagamos, de quem, e quando?** — histórico de preço pago,
   append-only.

## As três frases que separam tudo

O módulo inteiro se apoia em distinguir três coisas que a conversa do dia a dia
mistura:

| Frase                 | Entidade            | Efeito no estoque |
| --------------------- | ------------------- | ----------------- |
| "Precisamos comprar"  | `purchase_needs`    | nenhum            |
| "Compramos"           | `purchase_orders`   | nenhum            |
| "A mercadoria chegou" | `purchase_receipts` | **entrada**       |

**O estoque só muda no recebimento.** Criar rascunho não muda, aprovar não
muda, registrar o pedido realizado não muda, cancelar não desfaz. Isso está
escrito na tela, e os testes E2E verificam o saldo em cada um desses passos.

## O que este módulo NÃO faz

- **Não envia nada ao fornecedor.** "Registrar pedido realizado" significa
  "você confirma que ligou/mandou WhatsApp/foi ao balcão". O Nexo56 anota; não
  manda e-mail, não manda mensagem, não gera integração.
- **Não implementa Contas a Pagar, nem qualquer Financeiro.** Receber mercadoria
  emite `PURCHASE_RECEIPT_CREATED`, e **esse evento não tem consumidor** — é o
  gancho do Prompt 12 e nada mais. Não há tabela de título, pagamento ou conta
  a pagar no banco, e um teste de integração verifica isso lendo o
  `information_schema`.
- **Não reserva peça automaticamente** depois da compra. Receber dá entrada no
  estoque; reservar continua sendo decisão de quem atende a OS.
- **Não muda a situação da Ordem de Serviço.** Nenhum caminho deste módulo
  executa `UPDATE service_orders` nem chama o workflow da OS.
- **Não compra sozinho.** Estoque baixo _sugere_ (a tela mostra o que está
  abaixo do mínimo); quem registra a necessidade e quem abre o pedido é uma
  pessoa.

## Mapa de arquivos

```
src/modules/purchasing/
  domain/purchasing.ts              a autoridade: situações, matriz de transição,
                                    aritmética de totais, pendências, rótulos
  infrastructure/schema.ts          10 tabelas
  application/
    supplier-service.ts             cadastro de fornecedor e contatos
    purchase-need-service.ts        necessidades + primitivas de acúmulo
    purchase-order-service.ts       pedido, rascunho, transições
    purchase-receipt-service.ts     recebimento — o único que mexe no estoque
    purchasing-queries.ts           listagens e fichas

src/app/(app)/fornecedores/         lista, ficha, cadastro
src/app/(app)/compras/              pedidos, necessidades, recebimento
```

## Documentos deste módulo

- [suppliers.md](suppliers.md) — cadastro, documento, contatos, inativação
- [needs.md](needs.md) — necessidade × pedido, e por que nada compra sozinho
- [orders.md](orders.md) — ciclo do pedido, numeração, totais
- [receiving.md](receiving.md) — recebimento parcial, over-receipt, correção
- [integrations.md](integrations.md) — Estoque, OS, e o gancho do Financeiro
- [concurrency.md](concurrency.md) — as travas, e o que cada teste prova
- [permissions.md](permissions.md) — as oito permissões e por que são oito
- [modularity.md](modularity.md) — o que acontece com o módulo desligado
- [security.md](security.md) — tenant, unidade e dado pessoal
- [future.md](future.md) — o que ficou preparado e o que ficou de fora
