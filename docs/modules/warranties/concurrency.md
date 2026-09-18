# Concorrência e idempotência

## Duplo clique

Todo formulário que **cria** algo leva uma chave de intenção gerada no cliente
(`crypto.randomUUID`), uma por montagem do formulário:

- emissão de garantia → `warranties.idempotency_key` com UNIQUE;
- registro de retorno → `warranty_returns.idempotency_key` com UNIQUE.

Duas submissões com a mesma chave **respondem as duas**, com o mesmo resultado e
`reused: true`. Quem clicou duas vezes não merece erro; merece o mesmo
resultado.

Recarregar a página gera chave nova de propósito — aí a pessoa realmente quis
começar outra vez.

## Corrida real

Os testes de concorrência usam MariaDB de verdade, com `Promise.allSettled` e
chamadas simultâneas:

| Cenário                                      | Resultado esperado                                              |
| -------------------------------------------- | --------------------------------------------------------------- |
| duas emissões simultâneas, mesma chave       | 1 garantia, 2 respostas de sucesso                              |
| cinco emissões simultâneas, mesma chave      | 1 garantia, 1 evento de ativação                                |
| dois retornos simultâneos, mesma chave       | 1 retorno, 1 OS                                                 |
| dois retornos simultâneos, chaves diferentes | 2 retornos, 2 OS (é o comportamento correto: dois atendimentos) |

A unicidade é do **banco**, não de um `SELECT` antes do `INSERT`: a violação de
UNIQUE é capturada (`isDuplicateKeyError`) e resolvida relendo o registro
vencedor.

## Numeração

`allocateSequenceNumber(tx, tenantId, 'warranty', { prefix: 'GAR', padding: 6 })`
— `LAST_INSERT_ID` atômico. Nunca `MAX(number) + 1`, que produz duplicatas sob
concorrência.

## Concorrência otimista

Políticas usam `version` com a comparação **dentro do `WHERE` do `UPDATE`**
(ADR-044). `affectedRows() === 0` significa recusa, não sucesso silencioso.

A reclassificação usa a mesma `version` da Ordem de Serviço, pela máquina de
estados.

## Garantias do banco

| Constraint                         | O que impede                            |
| ---------------------------------- | --------------------------------------- |
| `uq_warranty_idempotency`          | emissão duplicada por retry             |
| `uq_warranty_return_new_order`     | dois retornos apontando a mesma OS      |
| `uq_warranty_certificate_warranty` | dois certificados para a mesma garantia |
| `uq_warranty_certificate_token`    | colisão de token                        |
| `ck_warranty_period_ordered`       | `starts_on > ends_on`                   |
| `ck_warranty_duration_positive`    | duração zero ou negativa                |
| `ck_warranty_cost_non_negative`    | custo negativo                          |
