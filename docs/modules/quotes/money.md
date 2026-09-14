# Dinheiro, cálculo e arredondamento

## Nenhum valor passa por ponto flutuante

`0.1 + 0.2 === 0.30000000000000004`. Num orçamento isso vira centavo errado, e
centavo errado vira discussão no balcão.

O módulo usa o `Money` da fundação (Prompt 02), que guarda **inteiro de
centavos em `bigint`** e nunca converte para `number` no caminho. O
`DECIMAL(14,2)` do MariaDB chega como string, vira `bigint` direto, e volta para
string ao gravar.

```ts
Money.parse('149.90').multiply('2').toString(); // "299.80"
```

Não existe `parseFloat` em nenhum ponto do cálculo — nem no servidor, nem na
prévia do editor, que usa **o mesmo `Money`**.

## Onde o total é calculado

**No servidor, sempre.** O que o formulário manda como total é ignorado:
`saveQuoteDraft` recalcula a partir das linhas e grava o resultado dele.

O editor mostra uma prévia enquanto a pessoa digita, com a mesma aritmética — e
diz em texto que é prévia:

> Prévia. O valor gravado é recalculado pelo servidor ao salvar.

## A ordem das contas

```
linha.bruto    = round(valor_unitario × quantidade)     ← arredonda UMA vez
linha.total    = linha.bruto − linha.desconto
subtotal       = Σ linha.total
total          = subtotal − desconto_global
```

**O arredondamento acontece uma vez só**, no produto. Quebrar a quantidade em
parcelas e arredondar cada uma produz diferença de centavos que aparece linha a
linha e, no fechamento do mês, ninguém consegue explicar de onde veio.

## Regra de arredondamento

**Half-up** (2,345 → 2,35), a convenção comercial brasileira, aplicada pelo
`Money`. Coberto por teste:

| Entrada                 | Resultado    | Por quê                           |
| ----------------------- | ------------ | --------------------------------- |
| 2,5 × R$ 0,33           | R$ 0,83      | 0,825 → half-up                   |
| 0,5 × R$ 90,00          | R$ 45,00     | fração exata                      |
| 100 × R$ 0,01           | R$ 1,00      | soma de centavos não acumula erro |
| valor unitário R$ 0,335 | lido R$ 0,34 | `unit_price` é `DECIMAL(14,2)`    |

A última linha é uma consequência de projeto, não um bug: o preço unitário tem
duas casas porque numa assistência ele é sempre em centavos. Sub-centavo é
problema de atacado e de combustível.

## Precisão das colunas

| Coluna       | Tipo            | Por quê                                      |
| ------------ | --------------- | -------------------------------------------- |
| `unit_price` | `DECIMAL(14,2)` | preço em centavos                            |
| `discount`   | `DECIMAL(14,2)` | desconto em valor                            |
| `total`      | `DECIMAL(14,2)` | resultado final                              |
| `quantity`   | `DECIMAL(14,4)` | meia hora de bancada é `0.5`; 1/3 é `0.3333` |

## Limites e casos de borda

| Regra                                | Comportamento                                |
| ------------------------------------ | -------------------------------------------- |
| Valor unitário negativo              | **recusado**                                 |
| Quantidade zero ou negativa          | **recusado** — linha esquecida, não cortesia |
| Desconto de linha maior que a linha  | **recusado**                                 |
| Desconto global maior que o subtotal | **recusado**                                 |
| **Valor zero**                       | **permitido** — cortesia existe              |
| Quantidade acima de 9 999            | recusada (teto defensivo)                    |

Cortesia se expressa com **valor** zero, não com quantidade zero. Uma linha
"Limpeza (cortesia) — R$ 0,00" é informação para o cliente; uma linha com
quantidade zero é engano de digitação.

## Desconto: valor, não percentual

O desconto — por linha e global — é em **valor (R$)**, e só.

Percentual é comum no balcão, mas suportar os dois exigiria uma coluna de
"tipo de desconto" e uma decisão sobre arredondamento de percentual que ninguém
tomou ainda. O item 39 pede para evitar ambiguidade, e a escolha é registrar
exatamente o que foi combinado: um valor. A interface diz isso:

> Em valor. Percentual chega quando houver decisão comercial.

Quando a decisão existir, entra como coluna aditiva.

## Entrada em pt-BR

A pessoa digita `1.234,56`. Mandar essa string crua ao backend faria
`Money.parse` falhar — ou pior, ler `1.234` como um real e vinte e três
centavos, e o orçamento sairia mil vezes menor sem ninguém perceber até o
cliente chegar para pagar.

`normalizeAmountInput` ([`src/core/money/format.ts`](../../../src/core/money/format.ts))
resolve isso na Server Action, antes do domínio:

| Digitado    | Normalizado | Regra                                  |
| ----------- | ----------- | -------------------------------------- |
| `1.234,56`  | `1234.56`   | vírgula é decimal, ponto é milhar      |
| `1234,56`   | `1234.56`   | vírgula é decimal                      |
| `1234.56`   | `1234.56`   | ponto decimal também é aceito          |
| `1.234`     | `1234`      | três dígitos após o ponto ⇒ **milhar** |
| `1.23`      | `1.23`      | duas casas após o ponto ⇒ **centavos** |
| `R$ 149,90` | `149.90`    | símbolo e espaço ignorados             |
| `R$`, `abc` | `null`      | sem número, o chamador decide          |

## Formatação

Um módulo, dois formatadores instanciados **uma vez**. Espalhar
`new Intl.NumberFormat('pt-BR', …)` pelas telas produz divergência silenciosa —
uma mostra `R$ 1.234,56`, outra `1234,56` — e instancia um formatador caro por
linha de lista.

## Moeda

BRL apenas. O `Money` recusa operar moedas diferentes entre si, e a coluna
`currency` existe para o dia em que houver uma segunda — sem multimoeda
implementada, e sem fingir que há.

## O que NÃO existe

Nenhuma tributação, nenhum cálculo fiscal, nenhuma NF-e/NFS-e. O item 44 pede
preparar a extensão, não implementá-la: as colunas de valor são as de sempre, e
imposto entrará como estrutura própria quando houver o módulo fiscal.
