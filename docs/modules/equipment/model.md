# Modelo de dados — Equipamentos e Recebimento

Migration: `drizzle/0004_equipment_and_intake.sql` (puramente aditiva — nenhum
`DROP`, nenhum `TRUNCATE`, nenhuma tabela do Prompt 05 tocada).

## Tabelas

| Tabela                         | Dono            | Papel                                      |
| ------------------------------ | --------------- | ------------------------------------------ |
| `equipment`                    | tenant          | o aparelho físico, ligado a um cliente     |
| `equipment_intakes`            | **unidade**     | uma entrada do aparelho na assistência     |
| `equipment_intake_accessories` | via recebimento | o que veio junto                           |
| `equipment_intake_conditions`  | via recebimento | checklist de estado físico                 |
| `equipment_media`              | tenant          | metadados da foto (bytes ficam no storage) |
| `equipment_label_readings`     | tenant          | tentativa de leitura automática            |

## `equipment`

Campos de identificação: `kind` (obrigatório), `brand`, `model`, `serial`,
`voltage`, `notes`.

Cada campo pesquisável tem um par normalizado (`kind_normalized`,
`brand_normalized`, `model_normalized`, `serial_normalized`). O valor exibido é
sempre o digitado; a coluna normalizada existe só para busca.

**O modelo não sofre normalização destrutiva.** `RX-V385` e `RXV385` são
identificações técnicas diferentes para quem procura peça; a normalização
remove acento e caixa para a busca, mas o original fica intacto na tela e no
relatório.

`serial` é **opcional e não é chave**. Etiqueta ilegível, arrancada ou ausente é
rotina numa assistência. Não há índice único: fabricantes reaproveitam formatos,
e recusar um cadastro por série repetida travaria o atendimento. A busca por
série usa `serial_normalized` (só letras e dígitos, maiúsculas), de modo que
`sn-123/456` encontra `SN123456`.

### Tensão não é booleano

`VOLTAGES = v110 | v127 | v220 | bivolt | not_applicable | unknown`.

"Bivolt" não é "110 ou 220": é um aparelho que aceita as duas. "Não
identificada" não é "não se aplica". Reduzir isso a um sim/não perderia
justamente a informação que evita queimar o aparelho do cliente.

## `equipment_intakes`

`unit_id` é **obrigatório** e vem de `context.activeUnitId` — nunca do corpo da
requisição. Um contexto sem unidade ativa recusa o recebimento com erro
explícito, em vez de escolher uma unidade qualquer.

Campos: `received_at`, `received_by` (quem atendeu, complementa a auditoria sem
substituí-la), `power_cable` (`yes | no | not_applicable`), `inspection_notes`
(relato livre do estado físico) e `notes` (observações do atendimento).

Trocar de unidade ativa depois **não** reescreve `unit_id`: o recebimento
guarda para sempre onde o aparelho foi entregue.

## Acessórios e condições

`equipment_intake_accessories` tem `label` (texto livre; a lista sugerida
acelera mas não limita) e `quantity` **inteira** — acessório se conta por
unidade; o decimal de estoque aqui abriria "1,5 controle remoto".

`equipment_intake_conditions` guarda `condition_key` do catálogo de dez itens
(`scratches`, `dents`, `cracks`, `broken_parts`, `missing_screws`,
`disassembled`, `loose_parts`, `oxidation`, `liquid`, `dirt`) e uma `note`
opcional por condição. `uq_intake_condition (intake_id, condition_key)` impede
a mesma condição duas vezes no mesmo recebimento.

O catálogo é deliberadamente **de estado, não de defeito**: "carcaça trincada" é
estado de entrada; "placa principal queimada" é diagnóstico, e diagnóstico
pertence à Ordem de Serviço. Misturar os dois faria o atendente do balcão emitir
parecer técnico sem abrir o aparelho.

## Proteção cross-tenant no banco

Toda FK deste módulo é **composta**, carregando `tenant_id` junto:

| Constraint                                              | Garante                          |
| ------------------------------------------------------- | -------------------------------- |
| `fk_equipment_customer_tenant (customer_id, tenant_id)` | o cliente é da mesma empresa     |
| `fk_intake_equipment_tenant (equipment_id, tenant_id)`  | o equipamento é da mesma empresa |
| `fk_intake_unit_tenant (unit_id, tenant_id)`            | a unidade é da mesma empresa     |
| `fk_intake_accessories_intake_tenant`                   | acessório e recebimento juntos   |
| `fk_intake_conditions_intake_tenant`                    | condição e recebimento juntos    |
| `fk_media_equipment_tenant` / `fk_media_intake_tenant`  | a foto é da mesma empresa        |
| `fk_label_reading_equipment_tenant`                     | a leitura é da mesma empresa     |

Uma FK simples `customer_id -> customers.id` diria apenas que o cliente existe,
não que ele pertence a esta empresa. Os alvos dessas FKs são as UNIQUE
compostas `uq_equipment_id_tenant`, `uq_intake_id_tenant` e `uq_media_id_tenant`.

Há teste de integração que tenta a associação cruzada por SQL direto e espera
`ER_NO_REFERENCED_ROW` (1452) — a proteção é do banco, não da aplicação.

`ON DELETE`: `restrict` do equipamento para cliente e do recebimento para
equipamento/unidade (não se apaga um cliente que tem aparelho na bancada);
`cascade` de acessórios, condições e fotos para o recebimento.

## Índices

| Índice                            | Serve a                                        |
| --------------------------------- | ---------------------------------------------- |
| `ix_equipment_tenant_customer`    | equipamentos de um cliente (ficha do cliente)  |
| `ix_equipment_tenant_serial`      | busca por número de série                      |
| `ix_equipment_tenant_brand_model` | busca por marca + modelo                       |
| `ix_equipment_tenant_kind`        | busca/filtro por tipo                          |
| `ix_equipment_tenant_created`     | listagem paginada (`created_at DESC, id DESC`) |
| `ix_intake_tenant_unit_received`  | fila da unidade por data                       |
| `ix_intake_equipment`             | histórico de um aparelho                       |

Todo índice começa por `tenant_id`: é a coluna que aparece em **toda** cláusula
de filtro, e um índice que não comece por ela obrigaria o banco a varrer linhas
de outras empresas antes de descartá-las.

A paginação é por offset com ordenação determinística (`created_at DESC, id
DESC`): sem o desempate por `id`, dois registros no mesmo milissegundo podem
trocar de lugar entre páginas e um deles some da listagem.

## Upgrade

`tests/integration/migration-upgrade.test.ts` prova o caminho real: um banco no
estado do Prompt 05, **com clientes, contatos e endereços dentro**, recebe a
migration 0004 e sai com os mesmos dados, os mesmos valores, mais as seis
tabelas novas. O mesmo teste verifica, já no banco migrado, que um equipamento
de outra empresa é recusado pela FK composta e que um cliente com aparelho não
pode ser apagado.

Instalação limpa (banco vazio → todas as migrations) é verificada no mesmo
arquivo.
