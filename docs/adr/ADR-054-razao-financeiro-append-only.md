# ADR-054 — O razão financeiro é append-only; estorno é contramovimento

**Status:** Aceito
**Data:** Prompt 12 — Financeiro
**Itens atendidos:** 11, 12, 13, 45, 46, 47, 48, 49

## Contexto

Todo sistema financeiro chega no mesmo dia: alguém lançou R$ 300 na conta
errada e pede para "arrumar". A tentação é `UPDATE financial_movements SET
financial_account_id = ...` ou, pior, `DELETE`.

O custo disso não aparece no dia. Aparece dois meses depois, quando o saldo da
conta não bate com o extrato do banco e **não existe nenhum registro do que
mudou**. A pessoa que arrumou já esqueceu; o cliente jura que pagou; o sistema
não tem como dar razão a ninguém.

## Decisão

**`financial_movements` é a única tabela do sistema sem `updated_at` e sem
`version` — e isso é intencional, não esquecimento.**

```ts
export const financialMovements = mysqlTable('financial_movements', {
  // ... sem timestamps(), sem version: o razao nao se atualiza.
  occurredAt: datetime('occurred_at', { fsp: 3 }).notNull(),
  resultingBalance: decimal('resulting_balance', { precision: 14, scale: 2 }).notNull(),
  reversalOfMovementId: char('reversal_of_movement_id', { length: 36 }),
});
```

Uma linha nasce e nunca muda. O `amount` é **sempre positivo**; quem carrega o
sinal é `direction` (`inflow` / `outflow`). Isso elimina de vez a pergunta "esse
`-300` é uma saída ou uma entrada corrigida?".

**Estornar não apaga: escreve.**

1. A liquidação original passa de `confirmed` para `reversed` — ela continua
   lá, com `reversal_reason` preenchido e obrigatório;
2. o saldo da parcela e do título voltam;
3. o razão ganha **um novo movimento**, na direção oposta, com
   `reversal_of_movement_id` apontando para o original.

Quem lê o extrato de amanhã vê as duas pernas e entende a história. Se a linha
sumisse, o saldo mudaria sozinho.

## Duas travas contra estorno duplo

```sql
CONSTRAINT uq_fin_movement_reversal_of UNIQUE (reversal_of_movement_id)
```

Um movimento só pode ser estornado uma vez — o banco recusa o segundo. E a
transição de estado da liquidação vai no `WHERE` do próprio `UPDATE`
(ADR-044):

```sql
UPDATE financial_settlements SET status = 'reversed', ...
 WHERE id = :id AND tenant_id = :t AND status = 'confirmed'
```

`affectedRows() === 0` significa que outra transação já estornou. A recusa é do
banco, não de um `SELECT` anterior que poderia estar velho.

## O teste que garante isso

`tests/unit/finance-boundary.test.ts` varre o código-fonte e **falha se qualquer
arquivo escrever um `UPDATE` ou `DELETE` sobre `financialMovements`**. Não é
disciplina de revisão: é build vermelho.

## O saldo materializado continua conferível

`financial_accounts.current_balance` é projeção, não verdade — a verdade é a
soma do razão. `reconcileAccountBalance()` recalcula a partir dos movimentos e
compara, e há teste de integração que o exercita depois de liquidações e
estornos concorrentes.

## Consequências

**Ganhamos:** um extrato que explica a si mesmo, e uma auditoria em que
"corrigir" é um fato datado e assinado, não um apagão.

**Pagamos:** a tela mostra mais linhas do que o usuário esperaria — o estorno
aparece. Isso é o comportamento desejado, e a interface diz por quê em vez de
esconder.

**Não fizemos:** conciliação bancária. O razão registra o que a loja declara,
não o que o banco confirma. O Nexo56 não fala com banco nenhum.
