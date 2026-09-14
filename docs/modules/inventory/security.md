# Segurança do Estoque

## Isolamento de tenant

Toda consulta carrega `tenant_id`. Não existe `findById(id)` sem escopo — é o
atalho que, um refactor depois, vira IDOR entre empresas.

No banco, FKs **compostas** em todas as relações críticas:

| Relação                                 | FK                        |
| --------------------------------------- | ------------------------- |
| saldo → peça                            | `(part_id, tenant_id)`    |
| saldo → unidade                         | `(unit_id, tenant_id)`    |
| movimento → peça / unidade / ator       | compostas com `tenant_id` |
| reserva → peça / unidade                | compostas com `tenant_id` |
| transferência → origem / destino / peça | compostas com `tenant_id` |
| linha de orçamento → peça               | `(part_id, tenant_id)`    |

Testes tentam o `INSERT` cruzado **direto no banco** e provam a recusa.

## Isolamento de unidade

Onde a coerência de unidade é invariante, a FK inclui `unit_id`:

| Relação                       | FK                               | Impede                                |
| ----------------------------- | -------------------------------- | ------------------------------------- |
| movimento → OS                | `(service_order_id, unit_id)`    | OS da unidade A consumir estoque da B |
| reserva → OS                  | `(service_order_id, unit_id)`    | reserva cruzando unidades             |
| movimento → localização       | `(location_id, unit_id)`         | prateleira de outra unidade           |
| saldo → localização preferida | `(primary_location_id, unit_id)` | idem                                  |

**Não é só a UI escondendo ação** (item 175): os testes chamam os casos de uso
diretamente e, além disso, tentam o `INSERT` cruzado no banco.

## Concorrência

Ver [concurrency.md](concurrency.md) e
[ADR-044](../../adr/ADR-044-concorrencia-de-saldo.md). Resumo: a condição vai no
`WHERE`; CHECK constraints são a retaguarda; e há teste concorrente real.

## Ajustes

A operação mais sensível do módulo — reescreve o saldo sem que nada tenha
entrado ou saído. Permissão própria, motivo obrigatório, AuditLog **e**
movimentação no ledger. A tela mostra um aviso explícito antes de confirmar.

## Integridade do ledger

- Append-only: sem `updated_at`, sem `version`, sem `UPDATE`, sem `DELETE`.
- Teste de arquitetura falha se qualquer arquivo passar a escrever nela.
- Correção por movimentação compensatória, com motivo.
- `resulting_on_hand` permite reconciliar sem recalcular a tabela inteira.

## AuditLog ≠ ledger

O ledger é história de **negócio**: quanto entrou, quanto saiu, para qual OS.
O AuditLog é história de **acesso**: quem executou uma ação sensível.

Auditar no AuditLog o que já está no ledger duplicaria o dado e faria as duas
trilhas divergirem na primeira correção. Por isso entram no AuditLog apenas:
catálogo, localização, **ajuste**, **transferência** e estoque mínimo.

## LGPD

Dados de estoque **não são dados pessoais**. As exceções são indiretas:

- `stock_movements.actor_id` e as colunas de autoria referenciam usuários;
- `reference` e `reason` são texto livre — a orientação é registrar nota
  fiscal, fornecedor ou motivo operacional, nunca dado de cliente.

Nenhuma coluna do módulo guarda nome, documento, telefone ou endereço.
