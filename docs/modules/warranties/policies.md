# Políticas de garantia

Uma política é o **padrão que a casa oferece**: "3 meses de mão de obra, não
cobre mau uso". Ela existe para que o balcão não digite tudo à mão a cada
emissão.

## Ela NÃO é a verdade da garantia emitida

`issueWarranty` **copia** os termos da política para a linha da garantia:
duração, unidade, resumo de cobertura, exclusões, termos e itens. `policy_id`
fica gravado como **procedência**, nunca como fonte de leitura.

Se em março a empresa reduzir o padrão de 3 meses para 30 dias, o cliente que
recebeu certificado em janeiro continua com 3 meses. Ver [ADR-062](../../adr/ADR-062-politica-e-padrao-garantia-e-snapshot.md).

A tela diz isso em texto, abaixo do formulário — porque "se eu mudar aqui, muda
lá atrás?" é a primeira dúvida de quem edita, e a resposta errada faria alguém
hesitar em corrigir um texto ruim.

## Campos

| Coluna             | Tipo         | Nota                                         |
| ------------------ | ------------ | -------------------------------------------- |
| `name`             | varchar(120) | nome interno, visível na emissão             |
| `type`             | varchar(20)  | `internal` / `factory` / `part` / `extended` |
| `duration_amount`  | int unsigned | 1 a 120, CHECK no banco                      |
| `duration_unit`    | varchar(10)  | `days` ou `months`                           |
| `coverage_summary` | text         | o que cobre, em português de balcão          |
| `exclusions`       | text         | o que **não** cobre                          |
| `terms`            | text         | condições completas, impressas               |
| `status`           | varchar(20)  | `active` / `inactive`                        |
| `version`          | int unsigned | concorrência otimista na edição              |

## Desativar não é apagar

A política desativada some das emissões novas e **continua explicando as
antigas**: quem abrir uma garantia de dois anos atrás ainda encontra a política
que a originou. Não há exclusão.

## Concorrência

A edição usa `version` com comparação no `WHERE` do `UPDATE` (ADR-044): se outra
pessoa salvou enquanto a tela estava aberta, o servidor recusa em vez de
sobrescrever o trabalho dela em silêncio. O formulário leva `expectedVersion`
num campo oculto.

## Permissão

`warranties.settings.manage` — separada de `warranties.issue` e de
`warranties.view`. Quem atende no balcão emite; quem decide o padrão da casa é
outra pessoa.
