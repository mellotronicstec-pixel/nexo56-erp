# Retorno em garantia

## O fato e a ordem

Registrar o retorno grava um **fato** em `warranty_returns`. Quando a garantia é
interna, está acionável no dia e o defeito é avaliado como coberto, o mesmo ato
cria uma **Ordem de Serviço nova**.

A OS original **nunca reabre** e o número dela **nunca é reaproveitado**
([ADR-065](../../adr/ADR-065-retorno-cria-os-nova.md)).

## Atomicidade — o que é verdade e o que não é

A criação do retorno e a criação da OS acontecem **na mesma transação**, pela
primitiva `planServiceOrderCreation` / `applyServiceOrderCreation`. Não há
janela entre "retorno gravado" e "OS criada": ou os dois existem, ou nenhum.

O módulo de Garantias **não duplica** a lógica de criação de OS e **não abre**
transação aninhada — chama a primitiva oficial de dentro da própria transação.

## O estado inicial

A OS de garantia nasce em `awaiting_repair`, não em
`awaiting_technical_opinion`: o diagnóstico já foi feito e o serviço já foi
prestado.

A exceção mora na primitiva, não num campo. `planServiceOrderCreation` aceita
uma **origem** (`ServiceOrderOrigin`), nunca um `status`; e a origem
`warranty_return` exige `warrantyId` e `originalServiceOrderId`. Ver
[ADR-066](../../adr/ADR-066-excecao-de-estado-inicial-pela-primitiva.md).

`createServiceOrder` — o caminho do formulário web — não repassa `origin`, e um
teste passa `status`/`classification`/`origin` por ali para provar que a OS
nasce em `awaiting_technical_opinion` assim mesmo.

## O que fica congelado

| Coluna                | Por quê                                 |
| --------------------- | --------------------------------------- |
| `reference_date`      | a data civil do dia, no fuso da empresa |
| `was_enforceable`     | a garantia valia **naquele** dia        |
| `coverage_assessment` | o que a bancada decidiu **naquele** dia |

Uma garantia que vence na semana seguinte não transforma retroativamente um
retorno aceito em recusado.

## Retorno recusado também é registrado

Quando a garantia não vale, ou o defeito não está coberto, o retorno **é
gravado assim mesmo**, sem OS de garantia, com o motivo da recusa dito na tela.
O atendimento pode seguir pelo caminho comercial normal.

Esconder a recusa deixaria a lista bonita e a loja cega: quando o cliente voltar
pela terceira vez discutindo a mesma coisa, é o registro das duas recusas
anteriores que permite responder com fato.

## Idempotência

`registerWarrantyReturn` aceita `idempotencyKey`. O formulário gera uma chave
por montagem (`crypto.randomUUID`), então:

- **duplo clique** → um retorno, uma OS, e a segunda chamada **responde** com o
  mesmo resultado (`reused: true`) em vez de erro;
- **recarregar a página** → chave nova, porque aí a pessoa realmente quis
  começar outra vez.

A garantia é do banco: `uq_warranty_return_new_order` impede dois retornos
apontando para a mesma OS, e a chave de idempotência tem UNIQUE próprio.

## Reclassificação

Quando a bancada descobre que o defeito não era coberto, a OS de garantia volta
para `awaiting_technical_opinion` — **pela máquina de estados**, com permissão
própria (`warranties.reclassify`) e motivo obrigatório de no mínimo 15
caracteres. Ver
[ADR-068](../../adr/ADR-068-reclassificacao-passa-pela-maquina-de-estados.md).

A regra é `actionOnly: true`: ela não aparece no seletor genérico de status e só
é alcançável pela ação dedicada, com `via: 'warranty_reclassification'`.

A reclassificação **não** envia mensagem, **não** cancela a garantia, **não**
cria orçamento e **não** cobra. Avisar o cliente de que o conserto deixou de ser
gratuito é ato humano, e a tela diz isso.

## Recorrência

`countsAsRecurrence()` define, no domínio, o que conta como retorno recorrente —
e a definição é a mesma que a tela e o painel usam. Não é "qualquer OS nova do
mesmo cliente".
