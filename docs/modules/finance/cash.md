# Caixa operacional

A gaveta física de uma unidade. É o único lugar do sistema onde o dinheiro é
palpável — e onde a diferença entre o registrado e o real aparece todo dia.

## O ciclo

```
Abrir  ──►  (liquidações em dinheiro, suprimentos, sangrias)  ──►  Fechar
  │                                                                  │
valor inicial contado na gaveta                          valor contado ÀS CEGAS
                                                         └── diferença registrada
```

## Um caixa aberto por conta

Garantido pelo banco, não por uma checagem na tela:

```sql
open_marker TINYINT,   -- 1 enquanto aberta, NULL depois de fechada
CONSTRAINT uq_cash_session_open UNIQUE (financial_account_id, open_marker)
```

O MySQL trata cada `NULL` como distinto num índice único — por isso a coluna
marcadora existe. Enquanto aberta, o par colide; ao fechar, `open_marker` vira
`NULL` e a linha sai do índice.

Dois atendentes tocando "Abrir caixa" no mesmo segundo é rotina na troca de
turno. O segundo recebe `ConflictError` traduzido do `ER_DUP_ENTRY`.

## Só conta em espécie

`supportsCashSession(kind)` é verdadeiro apenas para `cash`. Conta bancária não
tem gaveta para contar.

E liquidar numa conta `cash` **exige sessão aberta**. A tela avisa **antes** do
envio, em vez de deixar a pessoa contar o dinheiro e só então receber a recusa.

## Suprimento e sangria

|                | O que é                                                    | Direção no razão |
| -------------- | ---------------------------------------------------------- | ---------------- |
| **Suprimento** | dinheiro que entra sem ser venda (troco do cofre)          | `inflow`         |
| **Sangria**    | dinheiro que sai sem ser pagamento (retirada de segurança) | `outflow`        |

**Motivo obrigatório**, entre 5 e 300 caracteres. É justamente o dinheiro que
anda "por fora" que inviabiliza a conferência quando não fica registrado.

## O fechamento vem às cegas

O campo de contagem **não vem preenchido** com o valor esperado, e nem aparece
antes de a pessoa confirmar que já contou. O esperado fica atrás de um
`<details>`, depois do campo.

Preencher economizaria dois segundos e destruiria o propósito do fechamento:
com o número já lá, todo caixa fecha certinho — inclusive o que está com R$ 50 a
menos.

```
esperado  = abertura + entradas − saídas   (movimentos DESTA sessão)
diferença = contado − esperado
```

A diferença é gravada em `difference_amount` e dita em voz alta:

> _"Caixa fechado com FALTA de R$ 50,00. A diferença foi registrada."_

Um sistema que engole a diferença ensina a equipe que o caixa nunca erra — e o
primeiro erro de verdade passa despercebido por semanas.

## Duas condições para uma conta servir de caixa

A tela de caixa só oferece contas que satisfazem **as duas**:

1. `kind = 'cash'` — conta em espécie;
2. `unit_id` preenchido — vinculada a **esta** loja.

A segunda foi aprendida no navegador. Filtrando só pelo tipo, a conta em
espécie **compartilhada pela empresa** aparecia na lista: a pessoa escolhia,
contava o troco, preenchia o valor inicial — e só então levava a recusa _"um
caixa pertence a uma loja"_. O erro do servidor estava certo; a tela é que
oferecia o que ia ser negado.

## Caixa aberto é por CONTA, não por loja

A mesma lição, do outro lado. `requireOpenCashSession()` verifica a sessão
**daquela conta**. A ficha do título chegou a perguntar _"há algum caixa aberto
nesta unidade?"_ — e com duas contas em espécie na mesma loja a resposta era
sim enquanto a conta escolhida no formulário continuava fechada. Nenhum aviso
aparecia, a pessoa preenchia tudo, e só o envio recusava.

Hoje a ficha recebe `listAccountsWithOpenCashSession(context, unitId)` — o
**conjunto** das contas abertas — e responde exatamente a pergunta que o caso
de uso faz. O painel ainda abre na primeira conta que vai funcionar, para que o
aviso só apareça quando significa alguma coisa: quando a pessoa escolheu de
propósito um caixa fechado.

## Permissões separadas

| Ação                 | Permissão             |
| -------------------- | --------------------- |
| Abrir                | `finance.cash.open`   |
| Fechar               | `finance.cash.close`  |
| Suprimento / sangria | `finance.cash.adjust` |

São três porque são três decisões diferentes. Quem abre o caixa de manhã não é
necessariamente quem tem autoridade para fazer uma sangria.
