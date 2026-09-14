# Catálogo de peças e localizações

## A peça é do TENANT

`parts` não tem `unit_id`, e isso é a regra — não um esquecimento. Uma peça
cadastrada pela empresa pode ser usada por qualquer unidade dela. Quem tem
quantidade é o **saldo**.

## Identificação

| Campo                      | Obrigatório         | Unicidade            | Observação                                   |
| -------------------------- | ------------------- | -------------------- | -------------------------------------------- |
| `code` (código interno)    | **sim**             | **única por tenant** | como a loja chama a peça                     |
| `name`                     | **sim**             | —                    |                                              |
| `description`              | não                 | —                    |                                              |
| `brand` (fabricante)       | não                 | —                    | texto livre; não há catálogo de marcas       |
| `part_number` (referência) | não                 | **nenhuma**          | fabricantes diferentes reusam o mesmo número |
| `barcode`                  | não                 | nenhuma              | qualquer formato; **não** presume EAN        |
| `unit_of_measure`          | sim (padrão `unit`) | —                    |                                              |
| `suggested_price`          | não                 | —                    | informação comercial                         |
| `notes`                    | não                 | —                    | recado de bancada                            |

Só **dois** campos são obrigatórios. Exigir fabricante e referência faria o
balcão inventar valor para cadastrar um parafuso.

### Normalização

O valor exibido é sempre o que a pessoa digitou. A comparação usa formas
normalizadas, guardadas em colunas próprias:

- `code_normalized` — compacto e maiúsculo. `"tela 01"` e `"TELA-01"` são o
  mesmo código, e é sobre essa coluna que a UNIQUE por tenant atua;
- `name_search` / `brand_search` — sem acento, minúsculo, espaços colapsados;
- `part_number_normalized`, `barcode_normalized` — compactos, para busca.

### Código de barras: o que existe e o que não existe

- **Implementado:** a coluna, a normalização e a busca por ela.
- **Pendente:** leitor de câmera. Não há scanner neste prompt, e a tela do
  cadastro diz isso.

## Unidades de medida

Conjunto pequeno e deliberado: `unit`, `package`, `meter`, `gram`, `kilogram`,
`liter`. Um catálogo com as 40 unidades do SI transformaria um `select` de três
opções úteis numa lista que ninguém lê.

`unit` e `package` **não aceitam fração** — meia tela de LCD não existe; meio
metro de cabo existe. A verificação mora no domínio porque a coluna é a mesma
`DECIMAL(14,4)` para todas as peças: quem decide se `0.5` faz sentido é a
unidade da peça.

A coluna é texto: acrescentar uma unidade depois é aditivo.

## Situação

`active` / `inactive`. **Inativar não apaga nada**: saldo, movimentações e
reservas permanecem e o histórico continua legível. A peça inativa apenas deixa
de aceitar movimentação nova e some do seletor do orçamento.

## Localizações

`stock_locations` pertence à **unidade** (item 10): unidade é o
estabelecimento; localização é onde, dentro dele, a peça está.

- nome obrigatório; código curto opcional e **único dentro da unidade** —
  a prateleira "A1" de uma loja não é a da outra;
- `active` / `inactive`;
- **não há enum** de "prateleira / gaveta / bancada". A tela oferece sugestões
  só para não começar em branco; nada no domínio consulta essa lista.

A FK composta `(location_id, unit_id) → stock_locations(id, unit_id)` torna
impossível, no banco, uma movimentação da unidade A apontar para a prateleira da
unidade B.

## Busca (itens 94 e 95)

Cada campo é procurado na **sua própria forma normalizada**: nome e fabricante
sem acento; código, referência e código de barras compactos e em maiúscula.
Jogar tudo num `LIKE` sobre o texto cru faria `"TELA-01"` não encontrar a peça
cadastrada como `"tela 01"`.

**Não é busca inteligente.** Não há sinônimo, correção ortográfica nem IA — é
`LIKE` sobre colunas indexadas, que é o que a etiqueta da prateleira precisa.

## Filtros e paginação

Filtros: abaixo do mínimo, sem saldo, com reserva, ativas, inativas, e por
localização. Paginação **por offset no servidor**, com ordenação determinística
(`name_search`, desempate por `id`). A listagem é **um `LEFT JOIN`** com o saldo
da unidade ativa — não uma consulta de saldo por linha.
