# Cobertura — total e parcial

## O caso que obriga a lista

A OS trocou a fonte, reparou uma trilha da placa e fez limpeza. A garantia
concedida cobre **apenas o reparo da fonte**.

Com um booleano "tem garantia", o retorno por defeito na placa seria garantia
aceita — e a loja consertaria de graça um serviço que nunca garantiu. Com a
lista, o atendente lê o que foi prometido antes de prometer de novo.

## Como fica no banco

```
warranties.covers_whole_service  tinyint  -- 1 = serviço inteiro, 0 = parcial
warranty_coverage_items
  kind         varchar(20)  -- labor | service | part | component | other
  description  varchar(200)
  part_id      idRef        -- opcional, quando o Estoque está ativo
  position     int          -- ordem de exibição
```

`isPartialCoverage(coversWholeService)` é a função que o resto do sistema usa —
ninguém compara o tinyint à mão.

## Na tela

**Cobertura total**: a ficha diz "cobre o serviço realizado como um todo, exceto
o que estiver nas exclusões", em `Alert tone="info"`.

**Cobertura parcial**: `Alert tone="warning"` dizendo que um defeito fora da
lista **não** está coberto mesmo dentro do prazo, mais um `Badge` "Cobertura
parcial" no cabeçalho, na lista e no certificado.

No formulário de emissão, escolher "cobre apenas os itens listados" faz o aviso
aparecer imediatamente — antes de a pessoa preencher, não depois de salvar.

## Avaliação no retorno

Cobertura é o que a garantia **promete**. Avaliação é o que a bancada **decide**
sobre um defeito concreto:

| Valor          | Significado                                 |
| -------------- | ------------------------------------------- |
| `covered`      | o defeito relatado está dentro da cobertura |
| `not_covered`  | está fora — o atendimento segue comercial   |
| `undetermined` | ainda não dá para dizer                     |

`undetermined` existe como opção real e é o **padrão** do formulário. Sem ele, o
atendente que não consegue decidir no balcão escolheria "coberto" para não
travar o atendimento — e a loja consertaria de graça por causa de um campo
obrigatório mal desenhado.

## A regra que decide a OS de garantia

```ts
shouldCreateWarrantyServiceOrder({ warrantyType, enforceable, assessment });
```

Três condições, todas necessárias: tipo `internal`, garantia acionável no dia, e
avaliação `covered`. Qualquer outra combinação registra o retorno **sem** criar
Ordem de Serviço de garantia — e diz por quê.
