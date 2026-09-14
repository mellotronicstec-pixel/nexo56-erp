# Revisões e imutabilidade

## O problema

O cliente achou caro. A loja refaz a conta. Se os valores forem alterados no
lugar, a proposta que o cliente recebeu **deixa de existir** — e com ela a
resposta para "quanto foi que eu te mandei mesmo?".

## A estratégia escolhida

**Linha nova, mesmo número, revisão seguinte.** Ver
[ADR-041](../../adr/ADR-041-estrategia-de-revisao-de-orcamento.md).

```
ORC #000045          → enviado → recusado     (permanece, com os valores que teve)
ORC #000045 rev. 2   → rascunho → …           (supersedes_quote_id aponta para a 1)
```

O cliente continua falando do "orçamento 45": o número que ele tem na mão não
muda quando a loja refaz a conta. E `uq_quote_tenant_number_revision` garante
que número + revisão são únicos na empresa.

### As alternativas, e por que não

| Alternativa                    | Por que não                                                    |
| ------------------------------ | -------------------------------------------------------------- |
| Versionar o mesmo registro     | Exigiria tabela de versões para não perder o histórico         |
| Novo orçamento com número novo | "ORC 45 e ORC 51 são a mesma proposta" fica obscuro para todos |
| Editar no lugar                | Apaga o que o cliente viu — exatamente o que se quer evitar    |

## O que acontece com a versão anterior

Depende de ela ainda estar viva:

| Situação anterior | Vira           | Por quê                                                |
| ----------------- | -------------- | ------------------------------------------------------ |
| `sent`            | `superseded`   | deixou de ser o que está valendo                       |
| `rejected`        | **`rejected`** | a recusa do cliente é fato histórico; não se reescreve |
| `approved`        | **`approved`** | o cliente aprovou aquilo; não se apaga                 |
| `expired`         | **`expired`**  | o prazo venceu de verdade                              |

**Os valores nunca são tocados.** Coberto por teste: depois de criar a revisão e
alterar o preço nela, a versão anterior continua com o valor que propunha e com
a situação que tinha.

## Os itens são copiados

Revisar quase sempre é ajustar, não recomeçar. A revisão nasce com as linhas da
anterior, prontas para edição.

## Imutabilidade

| Situação        | Valores editáveis? |
| --------------- | ------------------ |
| `draft`         | **sim**            |
| todas as outras | **não**            |

Tentar editar uma proposta enviada recebe:

> Este orçamento não é mais um rascunho. Crie uma revisão para propor outros
> valores.

A regra vive no domínio (`isQuoteEditable`), é verificada no caso de uso **e**
reforçada pelo `WHERE status = 'draft'` do próprio `UPDATE` — a interface só
esconde o editor, que é a camada menos confiável das três.

## Uma proposta viva por vez

`uq_quote_active (service_order_id, active_marker)` garante no banco que uma OS
tem no máximo **um** orçamento em rascunho ou enviado. Para criar uma revisão, a
anterior precisa sair do ar primeiro — e é por isso que `reviseQuote` marca a
anterior como `superseded` **antes** de inserir a nova, na mesma transação.

Não se cria revisão de um rascunho: edita-se o próprio rascunho. Tentar recebe
mensagem dizendo isso.

A ficha da OS diz por que o botão não está lá:

> Já existe uma proposta em aberto nesta Ordem de Serviço. Conclua ou cancele
> ORC #000045 antes de criar outra.

## Uma aprovação por vez

`uq_quote_approved (service_order_id, approved_marker)`: no máximo **uma** versão
aprovada por OS (item 66).

Na prática o caminho já é fechado antes disso — depois de aprovar, a OS está em
Aguardando Conserto, e a matriz do workflow não tem transição de lá para
Aguardando Aprovação, então uma segunda revisão não chega a ser enviada. O
UNIQUE é a garantia de banco por trás da garantia de fluxo.

### O que isso deixa em aberto

Um **orçamento complementar** — o técnico abre o aparelho e encontra outro
defeito depois da aprovação — não tem caminho hoje: exigiria uma transição
`Aguardando Conserto → Aguardando Aprovação` que a matriz do Prompt 08 não tem,
e criá-la é decisão de negócio, não de implementação. Está registrado em
[future-integrations](future-integrations.md) como pendência declarada.
