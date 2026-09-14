# Permissões, auditoria e eventos

## Feature

| Chave         | Tipo     | Depende de            |
| ------------- | -------- | --------------------- |
| `core.quotes` | **CORE** | `core.service_orders` |

**CORE** porque numa assistência técnica o cliente aprova um preço antes do
conserto. Uma empresa que desligasse isto teria Ordens de Serviço parando em
Aguardando Aprovação sem meio de sair dali pelo caminho comercial.

Depende de Ordens de Serviço porque **todo orçamento pertence a uma OS** — não
existe orçamento avulso do tenant.

## Permissões

| Chave                 | Capacidade                                      |
| --------------------- | ----------------------------------------------- |
| `quotes.view`         | consultar orçamentos                            |
| `quotes.create`       | abrir um orçamento ou uma revisão               |
| `quotes.update_draft` | alterar itens e valores **enquanto é rascunho** |
| `quotes.send`         | formalizar a proposta                           |
| `quotes.approve`      | registrar a aprovação do cliente                |
| `quotes.reject`       | registrar a recusa do cliente                   |
| `quotes.cancel`       | descartar rascunho ou retirar proposta          |

**Capacidades comerciais, não uma permissão por botão.** O corte separa quem
**monta** a proposta de quem a **formaliza** e de quem **registra a decisão do
cliente**. Numa assistência isso costuma ser gente diferente: o técnico lança os
itens, o balcão envia, e aprovar ou recusar em nome do cliente é
responsabilidade de quem falou com ele.

Verificado por teste: quem só vê não cria; quem monta não envia; quem envia não
aprova nem recusa; quem edita rascunho não mexe em proposta enviada.

## Escopo: a unidade da ORDEM

A permissão é avaliada na unidade **da Ordem de Serviço**, não na unidade ativa
da sessão — mesma decisão do Prompt 08. Alguém com acesso a duas lojas não deve
conseguir mover o trabalho da loja B por estar com a loja A selecionada.

Coberto por teste: um papel de orçamento concedido só no Norte, com o Norte
ativo, é recusado num orçamento da outra unidade. Papel de nível tenant vale nas
unidades que a pessoa acessa, e só nelas.

Orçamento de outra empresa ou de unidade sem vínculo responde **"não
encontrado"** — nunca "sem permissão", que confirmaria a existência.

## A permissão extra que enviar e aprovar exigem

`quotes.send` sozinha não basta: enviar **move** a OS, então
`service_orders.transition` também é exigida — pelo próprio workflow, no
`planTransition`. O mesmo vale para aprovar. Ver
[workflow-integration](workflow-integration.md).

## Empresas que já existiam

`syncCatalog` concede as permissões novas aos perfis **Administrador**
existentes, de forma idempotente. Sem isso, um tenant criado antes do Prompt 09
teria um administrador que não consegue orçar, e o produto teria dois tipos de
administrador dependendo da data de cadastro.

## Auditoria

Registrada **dentro da transação** da escrita.

| Ação                  | Quando                                         |
| --------------------- | ---------------------------------------------- |
| `quote.created`       | orçamento ou revisão criados                   |
| `quote.items_updated` | rascunho salvo — guarda o total antes e depois |
| `quote.sent`          | proposta formalizada                           |
| `quote.approved`      | aprovação registrada                           |
| `quote.rejected`      | recusa registrada                              |
| `quote.cancelled`     | proposta cancelada                             |
| `quote.superseded`    | versão substituída por uma revisão             |

## Eventos

Publicados pelo outbox existente, **na mesma transação** da escrita.

| Evento            | Publicado quando                              |
| ----------------- | --------------------------------------------- |
| `QUOTE_CREATED`   | orçamento criado                              |
| `QUOTE_SENT`      | proposta formalizada — **`delivered: false`** |
| `QUOTE_APPROVED`  | aprovação registrada                          |
| `QUOTE_REJECTED`  | recusa registrada                             |
| `QUOTE_CANCELLED` | proposta cancelada                            |
| `QUOTE_EXPIRED`   | prazo vencido, pelo job                       |
| `QUOTE_REVISED`   | revisão criada                                |

**Nenhum evento é consumido**: não há handler, não há Rule Engine, não há canal
de comunicação. Eles ficam no outbox preparando os Prompts 16 e 19.

`QUOTE_SENT` carrega `delivered: false` porque é exatamente isso que aconteceu:
a proposta foi formalizada, nada foi enviado.

Payload mínimo e **sem PII**: ids, números, situação e total. Há teste que
formaliza um orçamento numa OS com relato e nome reconhecíveis e falha se
qualquer um dos dois aparecer no payload.

## Linha do tempo

Duas, de propósito:

| Onde                     | O quê                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------ |
| `quote_timeline`         | criado, itens alterados, enviado, aprovado, recusado, expirado, cancelado, substituído, revisão criada |
| `service_order_timeline` | **fato resumido**: "Orçamento ORC #45 enviado"                                                         |

O motivo escrito (recusa, cancelamento) fica em coluna própria `reason`, e é
**exibido** na ficha — exigir justificativa e nunca mostrá-la transformaria a
exigência em burocracia.

## Desativação do módulo

`core.quotes` é CORE e não pode ser desligada pelo tenant — há teste
verificando que a tentativa é recusada. Se um dia houver um caminho de
desativação, ele não apaga dados: os orçamentos permanecem, o histórico
permanece, e o que muda é a possibilidade de novas operações.
