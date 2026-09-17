# ADR-060 — Caixa operacional: um aberto por conta, e a contagem vem às cegas

**Status:** Aceito
**Data:** Prompt 12 — Financeiro
**Itens atendidos:** 21, 22, 23, 24, 25, 26, 27

## Contexto

O caixa da gaveta é o único lugar do sistema onde o dinheiro é físico, e onde a
diferença entre o registrado e o real aparece todo dia.

Duas decisões definem se o fechamento serve para alguma coisa.

## Decisão 1 — Um caixa aberto por conta, garantido pelo banco

Na troca de turno, dois atendentes tocam "Abrir caixa" no mesmo segundo. Um
`SELECT ... WHERE status = 'open'` seguido de `INSERT` deixa passar os dois: as
duas transações leem "não há sessão aberta" antes de qualquer uma inserir.

O MySQL trata cada `NULL` como distinto num índice único, então
`UNIQUE (financial_account_id, status)` não resolve — todas as sessões fechadas
colidiriam entre si, ou nenhuma restrição valeria.

A solução é a coluna marcadora:

```sql
open_marker TINYINT,   -- 1 enquanto aberta, NULL depois de fechada
CONSTRAINT uq_cash_session_open UNIQUE (financial_account_id, open_marker)
```

Enquanto aberta, `open_marker = 1` e o par colide. Ao fechar, vira `NULL` e sai
do índice — quantas sessões fechadas houver, nenhuma atrapalha.

`openCashSession()` captura `ER_DUP_ENTRY` e o traduz em `ConflictError` com
texto de balcão. A recusa vem do banco, não de uma leitura que já podia estar
velha.

## Decisão 2 — O campo de contagem vem VAZIO

Esta é a decisão que dá sentido ao fechamento inteiro.

Preencher o campo com o valor esperado economizaria dois segundos e destruiria o
único propósito do ato: **descobrir a diferença**. Com o número já lá, todo
caixa fecha certinho — inclusive o que está com R$ 50 a menos.

A interface vai além: o campo **nem aparece** antes de a pessoa confirmar que já
contou. O valor esperado fica atrás de um `<details>`, depois.

```
[ Conte o dinheiro ANTES de ver o valor esperado ]
        │
        └── "Já contei, quero informar o valor" ──► campo vazio
                                                    └── ▸ Ver o valor esperado
```

Há teste de componente que falha se o campo vier preenchido.

## A diferença não desaparece

```ts
expectedCashAmount({ openingAmount, inflow, outflow }); // abertura + entradas - saídas
cashDifference({ expectedAmount, countedAmount }); // contado - esperado
```

Sobra e falta são gravadas em `difference_amount` e ditas em voz alta na
resposta da ação: _"Caixa fechado com FALTA de R$ 50,00. A diferença foi
registrada."_

Um sistema que engole a diferença ensina a equipe que o caixa nunca erra — e
aí o primeiro erro de verdade passa despercebido por semanas.

## Corolário aprendido no navegador: a tela tem de fazer a MESMA pergunta

Duas decisões acima são verificadas por conta, e a interface chegou a
perguntá-las por **loja**. Em ambos os casos o servidor estava certo e a tela
é que oferecia o que ia ser negado — a pessoa contava o dinheiro e só então
levava a recusa.

**1. Qual conta pode abrir caixa.** Filtrar só por `kind = 'cash'` deixava
passar a conta em espécie _compartilhada pela empresa_. Caixa é gaveta física:
precisa de `unit_id`. O filtro da tela passou a exigir as duas condições.

**2. Qual conta está com caixa aberto.** `requireOpenCashSession()` verifica a
sessão **daquela conta**. A ficha do título perguntava _"há algum caixa aberto
nesta unidade?"_: com duas contas em espécie na mesma loja, a resposta era sim
enquanto a conta escolhida continuava fechada. A ficha passou a receber o
**conjunto** das contas abertas, e o painel abre na primeira conta que vai
funcionar — para que o aviso só apareça quando a pessoa escolhe de propósito um
caixa fechado.

A regra geral: **quando o caso de uso decide por X, a tela não pode decidir por
Y.** Oferecer o que será recusado é pior do que não oferecer nada, porque gasta
o trabalho da pessoa antes de dizer não.

## Suprimento e sangria

Dinheiro que entra na gaveta sem ser venda (troco do cofre) e que sai sem ser
pagamento (retirada de segurança). Os dois viram movimento no razão, com
**motivo obrigatório** entre 5 e 300 caracteres. É justamente o dinheiro que
anda "por fora" que inviabiliza a conferência quando não fica registrado.

## Só conta em espécie tem sessão

`supportsCashSession(kind)` devolve `true` apenas para `cash`. Conta bancária não
tem gaveta para contar. E liquidar em conta `cash` **exige sessão aberta** — a
tela avisa antes do envio, em vez de deixar a pessoa contar o dinheiro e só
então receber uma recusa.

## Consequências

**Ganhamos:** um fechamento que mede o que se propõe a medir, e uma abertura
que não duplica na troca de turno.

**Pagamos:** dois cliques a mais no fechamento. É o custo de não ensinar a
equipe a fechar no automático.
