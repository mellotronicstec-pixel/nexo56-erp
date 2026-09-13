# Modelo de dados — Clientes

Migration: `drizzle/0003_customers.sql` (puramente aditiva; nenhuma migration
anterior foi tocada).

## `customers`

| Coluna                      | Tipo                           | Obrig. | Significado                         |
| --------------------------- | ------------------------------ | ------ | ----------------------------------- |
| `id`                        | `CHAR(36)`                     | NN, PK | UUIDv7, como no resto do produto    |
| `tenant_id`                 | `CHAR(36)`                     | NN, FK | **Dono do cadastro**                |
| `kind`                      | `ENUM('individual','company')` | NN     | PF ou PJ, explícito no modelo       |
| `name`                      | `VARCHAR(200)`                 | NN     | PF: nome. PJ: razão social          |
| `name_normalized`           | `VARCHAR(200)`                 | NN     | Minúsculas, sem acento — para busca |
| `trade_name`                | `VARCHAR(200)`                 | —      | PJ: nome fantasia                   |
| `trade_name_normalized`     | `VARCHAR(200)`                 | —      | Idem, para busca                    |
| `document_type`             | `ENUM('cpf','cnpj')`           | —      | Preenchido junto com os dígitos     |
| `document_digits`           | `VARCHAR(14)`                  | —      | **Somente dígitos**                 |
| `state_registration`        | `VARCHAR(32)`                  | —      | PJ; texto livre (há "ISENTO")       |
| `birth_date`                | `VARCHAR(10)`                  | —      | PF; data civil ISO, sem fuso        |
| `notes` 🔒                  | `TEXT`                         | —      | Observações **internas**            |
| `status`                    | `ENUM('active','inactive')`    | NN     | Nunca exclusão física               |
| `origin_unit_id`            | `CHAR(36)`                     | —      | Procedência. **Nunca filtro**       |
| `created_by` / `updated_by` | `CHAR(36)`                     | —      | Autoria                             |
| `created_at` / `updated_at` | `DATETIME(3)`                  | NN     | UTC                                 |

### Por que o tipo é explícito

Deduzir PF/PJ pela presença de CPF ou CNPJ quebra no caso mais comum: o cliente
que ainda não informou documento. Sem o tipo, a interface não saberia se pede
"nome" ou "razão social", nem qual documento validar.

### Por que existem colunas normalizadas

A busca compara texto já preparado dos **dois lados**. Aplicar `LOWER()` sobre a
coluna a cada consulta descartaria o índice — com dezenas de milhares de
clientes, é a diferença entre uma busca útil no balcão e uma tela travada.

## `customer_contacts`

| Coluna                | Tipo                    | Significado                                       |
| --------------------- | ----------------------- | ------------------------------------------------- |
| `type`                | `ENUM('phone','email')` |                                                   |
| `value`               | `VARCHAR(190)`          | Como a pessoa digitou, preservado                 |
| `value_normalized` 🔒 | `VARCHAR(190)`          | Telefone: dígitos. E-mail: minúsculas             |
| `is_whatsapp`         | `BOOLEAN`               | **Característica do telefone**, não outro contato |
| `label`               | `VARCHAR(80)`           | "Celular", "Telefone da esposa"…                  |
| `is_primary`          | `BOOLEAN`               | O que a aplicação lê                              |
| `primary_marker`      | `TINYINT`               | `1` no principal, `NULL` nos demais               |

### O truque do `primary_marker`

`UNIQUE (customer_id, primary_marker)`. Como o MySQL considera cada `NULL`
distinto, o índice permite **N** contatos comuns e no máximo **um** principal.

A garantia fica no banco, não numa sequência "apaga os outros, marca este" que
duas requisições simultâneas conseguem furar. É o mesmo raciocínio das FKs
compostas do Prompt 02.

## `customer_addresses`

CEP (dígitos), logradouro, número, complemento, bairro, cidade, UF e país.
**Nada é obrigatório** além do vínculo: endereço incompleto é melhor do que
endereço não cadastrado.

Tabela própria desde o início, ainda que a interface trate de um endereço só —
retirada, entrega, cobrança e visita técnica são endereços diferentes da mesma
pessoa, e essas funções chegam nos próximos módulos.

## Restrições

| Restrição                               | Garante                                                |
| --------------------------------------- | ------------------------------------------------------ |
| `uq_customers_tenant_document`          | Documento único **por tenant**; vários `NULL` convivem |
| `uq_customers_id_tenant`                | Alvo das FKs compostas das tabelas filhas              |
| `fk_customer_contacts_customer_tenant`  | Contato e cliente no **mesmo tenant**                  |
| `fk_customer_addresses_customer_tenant` | Idem para endereço                                     |
| `uq_customer_contacts_primary`          | No máximo um contato principal                         |
| `uq_customer_addresses_primary`         | No máximo um endereço principal                        |

`uq_customers_tenant_document` resolve três coisas de uma vez: bloqueia o
documento repetido, permite quantos clientes sem documento existirem, e barra a
**corrida** entre dois cadastros simultâneos — que "consultar antes de inserir"
não resolve. Verificado por teste com duas gravações concorrentes.

## Transações

Criar e editar gravam cliente, contatos, endereço, auditoria e evento **na mesma
transação** (`runInTransaction`). O evento só é despachado após o commit.
Nenhum cliente fica meio salvo.

## O que **não** muda depois de criado

O **tipo PF/PJ**. Trocá-lo mudaria a natureza do documento (CPF vira CNPJ), o
significado do nome (pessoa vira razão social) e, mais adiante, a regra fiscal
das notas já emitidas. Um erro de digitação se resolve cadastrando o cliente
certo e inativando o errado — sem reescrever a história de quem ele era.
