# ADR-057 — A cobrança nasce de um ato humano, não da aprovação do orçamento

**Status:** Aceito
**Data:** Prompt 12 — Financeiro
**Itens atendidos:** 28, 29, 30, 68, 72, 73

## Contexto

Aprovar um orçamento e cobrar por ele parecem o mesmo evento. A automação
óbvia seria: orçamento aprovado → cria conta a receber com o total.

Ela está errada para quase toda assistência técnica, e o motivo é o calendário
real do atendimento. O orçamento é aprovado por telefone na terça. O aparelho só
é retirado na sexta. Entre uma coisa e outra:

- o cliente pede desconto no balcão e o dono dá R$ 50;
- o cliente decide pagar em duas no cartão;
- a peça não veio e metade do serviço foi cancelada;
- o aparelho nunca foi retirado.

Um título criado na terça, com o valor da terça, vira um número que alguém
precisa corrigir na sexta. E **corrigir título com liquidação é exatamente o que
não se faz** (ADR-054).

## Decisão

**A cobrança é criada por uma pessoa, na ficha da Ordem de Serviço, com o valor
pré-preenchido a partir do orçamento aprovado.**

```
Orçamento aprovado  ──(sugere o valor)──►  [ Gerar cobrança ]  ──►  Título CR
```

- O valor vem sugerido do orçamento `approved` — não do maior, não do último;
- continua **editável**, porque o desconto de balcão existe;
- sem orçamento aprovado não há sugestão: a pessoa informa o valor, e o sistema
  não inventa número.

## Idempotência: uma OS, uma cobrança

`ensureServiceOrderCharge()` grava `origin_key = 'service_order:<id>'`, com
índice único por tenant:

```sql
CONSTRAINT uq_fin_title_origin_key UNIQUE (tenant_id, origin_key)
```

Duplo clique, botão voltar e retry depois de queda de rede **reencontram** a
cobrança existente e devolvem `reused: true`. A tela diz "Esta Ordem de Serviço
já tinha cobrança. Nada foi duplicado." — a colisão vira resposta útil, não
erro.

## A OS não muda de situação, e o Financeiro não escreve nela

Esta é a fronteira, e ela é de mão única:

- o Financeiro **lê** `service_orders` para achar cliente, unidade e número;
- o Financeiro **nunca** escreve em `service_orders.status`;
- receber não entrega o aparelho; entregar não quita a conta.

Juntar as duas coisas apagaria a informação mais útil que a loja tem: **quem já
pagou e ainda não levou**.

Quando todos os recebíveis de uma OS são quitados, o Financeiro emite o evento
`SERVICE_ORDER_FINANCIAL_SETTLED`. **Ele não tem consumidor hoje** — é o gancho
para o Prompt 13 (Garantias), e está documentado como tal para que ninguém o
confunda com uma automação já existente.

## Consequências

**Ganhamos:** o valor cobrado é o valor combinado no balcão, não o de três dias
antes; nenhum título nasce para ser corrigido.

**Pagamos:** alguém precisa clicar. É o clique que registra a decisão comercial,
e é exatamente por isso que ele existe.
