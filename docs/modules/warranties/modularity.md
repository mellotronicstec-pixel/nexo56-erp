# Modularidade

Garantias é feature **OPCIONAL** (`operations.warranties`), com
`dependsOn: [FEATURES.CORE_SERVICE_ORDERS]`.

## Com o módulo desligado

| Onde                      | O que acontece                                 |
| ------------------------- | ---------------------------------------------- |
| Menu lateral              | o item "Garantias" **some**                    |
| Rotas `/garantias/**`     | `requireAccessForPage` recusa                  |
| Ficha da Ordem de Serviço | a seção não aparece; **nenhuma consulta roda** |
| Ficha do Equipamento      | a seção não aparece; **nenhuma consulta roda** |
| Casos de uso              | `authorize` recusa por feature indisponível    |

A ficha da OS fica **exatamente** como era antes do Prompt 13. Isso é o que
"modular" precisa significar para valer alguma coisa: não é o item de menu que
desaparece — é a consulta que não é feita.

## O que o Prompt 13 alterou fora do seu módulo

Três colunas em `service_orders`, todas `ADD COLUMN` puro, todas com default
seguro:

```sql
ALTER TABLE service_orders ADD COLUMN classification VARCHAR(30) NOT NULL DEFAULT 'standard';
ALTER TABLE service_orders ADD COLUMN warranty_id CHAR(36) NULL;
ALTER TABLE service_orders ADD COLUMN original_service_order_id CHAR(36) NULL;
```

Nenhum `DROP`, nenhum `MODIFY`, nenhum `TRUNCATE`. As migrations `0000`–`0010`
não foram tocadas. Toda OS existente continua `standard`, que é o que ela sempre
foi.

`warranty_id` e `original_service_order_id` ficam **sem FK** por ordem de
criação de tabelas (`service_orders` existe desde a `0007`, `warranties` nasce
na `0011`); a integridade do vínculo é garantida do outro lado, em
`warranty_returns`, que tem FK composta para as duas ordens e UNIQUE em
`return_service_order_id`.

## Garantias não exige Estoque

A garantia de peça carrega `part_id` e `stock_movement_id` quando o Estoque está
ativo, e `part_description` + `part_code` quando não está. O caso funciona
inteiro sem o módulo de Estoque.

## Garantias não exige Financeiro

Não há nenhuma escrita no Financeiro (ADR-071). Custo de garantia é medição
interna.

## Dependência real

`core.service_orders`. Sem Ordens de Serviço não existe garantia interna, porque
não existe o serviço que ela garante.
