# Segurança e dados sensíveis no Financeiro

## O que NUNCA é armazenado

Proibição do item 109, e não é uma questão de "ainda não implementamos":

- **número completo de cartão**;
- **CVV**;
- **senha** de qualquer natureza;
- **token bancário real** — não há infraestrutura de custódia para isso.

O que existe é `financial_settlements.card_installments`: um inteiro, o número
de parcelas combinado na maquininha. E `reference`, um texto livre de até 120
caracteres para o número do comprovante.

Há teste de componente que varre os atributos `name` de todos os campos do
painel de liquidação e falha se aparecer `cardnumber`, `cvv`, `securitycode` ou
`cartao`.

## Isolamento TENANT e UNIT

A proteção é **do banco**, não de um `WHERE` que alguém pode esquecer:

```sql
CONSTRAINT uq_fin_title_id_tenant UNIQUE (id, tenant_id)
-- e as FKs compostas apontando para (id, tenant_id) / (id, unit_id)
```

Um título só pode referenciar um cliente **do mesmo tenant**, e uma parcela só
pode pertencer a um título do mesmo tenant. Não existe caminho em que um
`tenant_id` errado passe despercebido: a FK composta recusa.

`findTitleDetail()` confere `context.authorizedUnitIds.includes(row.unitId)` e
devolve `null` — id de outra empresa e id inexistente terminam no mesmo lugar,
para não vazar existência.

## Auditoria

Onze ações registradas dentro da mesma transação do fato:

`financial_title.created` · `.updated` · `.cancelled` ·
`financial_settlement.created` · `.reversed` ·
`cash_session.opened` · `.closed` · `cash_adjustment.recorded` ·
`financial_account.changed` · `payment_method.changed` ·
`financial_category.changed`

Se a transação falha, a auditoria não fica órfã. Se a auditoria falha, o fato
não acontece.

## Motivo obrigatório onde importa

| Ação                 | Mínimo | Máximo |
| -------------------- | ------ | ------ |
| Cancelar título      | 5      | 300    |
| Estornar lançamento  | 5      | 300    |
| Suprimento / sangria | 5      | 300    |

`normalizeReason()` recusa espaço em branco disfarçado de justificativa. O motivo
vai para o histórico do título **e** para a auditoria.

## O histórico é legível

`financial_title_timeline` guarda o que aconteceu em português, com autor e
instante. Não é o log técnico: é o que a pessoa lê para entender por que o saldo
é esse.

## LGPD

O Financeiro não cria categoria nova de dado pessoal. Ele referencia
`customers.id` e `suppliers.id`; nome, documento e contato continuam morando no
cadastro, sob as regras já descritas em
[docs/database/lgpd.md](../../database/lgpd.md).

Valor devido é dado financeiro do titular e segue a mesma base legal de execução
de contrato que sustenta a Ordem de Serviço.
