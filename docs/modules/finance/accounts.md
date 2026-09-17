# Contas, formas de pagamento e categorias

Três cadastros, três perguntas. Confundi-los é o erro mais caro deste módulo.

| Cadastro               | Pergunta                 | Tem saldo? | Exemplo                          |
| ---------------------- | ------------------------ | ---------- | -------------------------------- |
| `financial_accounts`   | **ONDE** o dinheiro fica | **Sim**    | Caixa da loja, Banco Itaú        |
| `payment_methods`      | **COMO** se moveu        | Não        | Dinheiro, PIX, Cartão de crédito |
| `financial_categories` | **POR QUE** entrou/saiu  | Não        | Venda de serviço, Aluguel        |

Um recebimento de R$ 300 por PIX: **conta** = Banco Itaú, **forma** = PIX,
**categoria** = Venda de serviço. O saldo que sobe é o do banco.

Tratar "PIX" como conta produz quatro saldos que nunca batem com o extrato
bancário — porque o PIX cai na conta do banco.

## Contas financeiras

**Tipos:** `cash`, `bank`, `digital_wallet`, `clearing`, `other`.

**Nasce zerada, sempre.** Não existe campo "saldo inicial": saldo é consequência
dos movimentos. Para colocar dinheiro há o caminho honesto — abrir o caixa com
valor inicial, ou registrar um suprimento. Os dois geram movimento no razão.

**O tipo congela quando há movimento.** Transformar um caixa em conta bancária
no meio do mês reinterpretaria retroativamente todo o extrato.

**Alcance:** `unit_id` é _nullable_.

- **com unidade** — serve só aquela loja (o caixa da gaveta);
- **sem unidade** — compartilhada pela empresa (a conta bancária da matriz).

`accountServesUnit()` decide, e o serviço de liquidação confere no servidor:
liquidar um título da loja B numa conta exclusiva da loja A é recusado.

## Saldo materializado, e conferível

`current_balance` é **projeção**, não verdade. A verdade é a soma do razão.
`reconcileAccountBalance()` recalcula a partir de `financial_movements` e
compara — com teste de integração que o exercita depois de liquidações e
estornos concorrentes.

Cada movimento grava também `resulting_balance`, o saldo **depois** dele. É o
que torna o extrato conferível linha a linha.

## Formas de pagamento

`cash`, `pix`, `debit_card`, `credit_card`, `bank_transfer`, `boleto`, `other`.

É vocabulário do balcão. Registrar "PIX" é anotar como o dinheiro chegou — o
Nexo56 não confirma recebimento sozinho, não consulta banco e não tem PIX
automático.

`supportsCardInstallments(kind)` libera o campo de parcelas no cartão apenas
para `credit_card`.

## Categorias

`revenue` (receita) e `expense` (despesa). `categoryMatchesDirection()` garante
que uma conta a receber não receba categoria de despesa.

Categoria **agrupa, nunca bloqueia**: um lançamento sem categoria é válido.

## Nada se exclui

Uma forma usada em 400 liquidações não pode sumir — o extrato de março viraria
uma lista de lançamentos sem forma. Existe apenas **desativar**: some dos
formulários novos, continua explicando o passado.

`ensureFinanceDefaults()` semeia o básico de uma assistência técnica: dinheiro,
PIX, cartões, e as categorias mais comuns.
