# Liquidação e estorno

Liquidar é registrar que o dinheiro mudou de mãos. É a operação mais perigosa do
módulo: toca cinco tabelas numa transação e move dinheiro de verdade.

## O caminho de uma liquidação

```
1. autoriza finance.receive / finance.pay NA UNIDADE DO TÍTULO
2. procura a chave de comando (idempotência) — se achar, devolve a existente
3. confere: conta serve a unidade? forma ativa? conta 'cash' com caixa aberto?
4. ┌─ TRANSAÇÃO ─────────────────────────────────────────────┐
   │ a. SELECT ... FOR UPDATE na conta financeira            │  ordem única de lock
   │ b. UPDATE financial_installments  (condição no WHERE)   │  recusa por affectedRows
   │ c. UPDATE financial_titles        (condição no WHERE)   │
   │ d. INSERT financial_settlements                         │
   │ e. INSERT financial_movements + UPDATE saldo da conta   │  a única porta do razão
   │ f. timeline + auditoria + evento                        │
   └─────────────────────────────────────────────────────────┘
```

O passo (a) não é decorativo. Ele garante **ordem única de lock** (sem ela, duas
transações com ordens opostas dão deadlock) e **leitura fresca** (em REPEATABLE
READ, um `SELECT` simples lê do read view do primeiro `SELECT` da transação).

## Sem over-settlement

A condição vai no `WHERE` do `UPDATE`, e `affectedRows() === 0` é a recusa:

```sql
UPDATE financial_installments
   SET settled_amount = settled_amount + :q, status = CASE ... END
 WHERE id = :id AND tenant_id = :t
   AND status IN ('open','partially_settled')
   AND settled_amount + :q <= amount
```

Duas pessoas recebendo R$ 600 cada num saldo de R$ 1.000: a segunda encontra
`affectedRows = 0` e recebe `ConflictError`. Nenhuma das duas precisa ter lido o
saldo antes.

Há ainda a rede de segurança no schema:
`CHECK (settled_amount <= amount)`, nas duas tabelas.

## A armadilha do `SET` — leia antes de mexer

**`SET` avalia da esquerda para a direita, e cada atribuição vê o valor NOVO das
anteriores.** O `WHERE`, não: ele vê a pré-imagem.

```sql
-- ERRADO: quando o CASE roda, settled_amount JÁ foi somado. Conta duas vezes.
SET settled_amount = settled_amount + :q,
    status = CASE WHEN settled_amount + :q >= amount THEN 'settled' ELSE ... END

-- CERTO: compara a coluna já atualizada.
SET settled_amount = settled_amount + :q,
    status = CASE WHEN settled_amount >= amount THEN 'settled' ELSE ... END
```

O sintoma era um título de R$ 1.000 sendo marcado `settled` ao receber R$ 600.
Detalhe completo em
[ADR-061](../../adr/ADR-061-liquidacao-idempotente-e-sem-over-settlement.md).

## Idempotência

`UNIQUE (tenant_id, idempotency_key)`. A chave nasce no cliente quando o painel
monta e **muda a cada liquidação registrada com sucesso**:

- duplo clique, botão voltar, retry após queda de rede → reencontra, não duplica;
- segundo pagamento legítimo da mesma parcela → chave nova, lançamento novo.

## Estorno

**Estornar não apaga.**

1. a liquidação vai de `confirmed` para `reversed`, com motivo obrigatório;
2. saldo da parcela e do título voltam;
3. o razão ganha **um movimento contrário**, com `reversal_of_movement_id`.

`UNIQUE (reversal_of_movement_id)` impede estornar o mesmo movimento duas vezes.
A transição `confirmed → reversed` vai no `WHERE`, então duas pessoas estornando
ao mesmo tempo: uma consegue, a outra recebe conflito.

O teste de boundary falha se **qualquer** arquivo escrever `UPDATE` ou `DELETE`
sobre `financial_movements`.

## Cartão parcelado

`card_installments` registra o que foi combinado na maquininha. O Nexo56 **não
fala com a adquirente**, não sabe a data do repasse e não gera recebíveis de
cartão. A tela diz isso, e há teste de componente que falha se a frase sair.

**Nunca armazenamos** número de cartão, CVV, senha ou token bancário.
