# ADR-013 — Numeração humana por tenant

**Status:** Aceito · **Data:** Prompt 02

## Contexto

Documentos do ERP (OS, orçamento, pedido de compra, garantia) precisam de um
número que uma pessoa consiga falar ao telefone, escrever numa etiqueta e
procurar no sistema. UUID não serve para isso.

A decisão do proprietário (Prompt 02, item 15) fixa: **sequência única por
tenant**, não reiniciada por unidade.

## Decisão

Tabela `tenant_sequences`, com uma linha por `(tenant_id, sequence_type)`,
guardando `current_value`, `prefix` e `padding`.

Alocação pelo **idioma atômico do MariaDB**, uma única instrução:

```sql
INSERT INTO tenant_sequences (...) VALUES (..., LAST_INSERT_ID(1), ...)
ON DUPLICATE KEY UPDATE current_value = LAST_INSERT_ID(current_value + 1)
```

seguida de `SELECT LAST_INSERT_ID()` na **mesma conexão** (garantida porque a
alocação roda dentro de uma transação, que fixa a conexão do pool).

A chamada recebe o `tx` da transação que grava o documento: número e documento
nascem ou falham juntos.

## Motivo

- **Único por tenant** elimina ambiguidade: "OS 000123" identifica um único
  atendimento no balcão, no QR, no portal, no suporte e na garantia. Reiniciar
  por unidade exigiria carregar a unidade junto do número em toda comunicação.
- **Atômico** porque `MAX(numero) + 1` é uma condição de corrida óbvia, e
  porque a primeira implementação — `INSERT IGNORE` seguido de
  `SELECT ... FOR UPDATE` — **gerou deadlock real** no teste de 20 alocações
  simultâneas: várias transações pegavam lock compartilhado na mesma chave e
  tentavam subir para exclusivo ao mesmo tempo. O idioma atômico não tem essa
  escalada de lock.
- **Retentativa limitada** (5 tentativas, espera crescente com jitter) para
  deadlock e lock timeout residuais, que o próprio manual do MariaDB trata como
  parte normal da operação sob contenção.

## Lacunas na sequência

Decisão explícita (Prompt 02, item 18): **unicidade vale mais que ausência de
buracos**. Se a transação do chamador abortar, o incremento volta atrás junto
com ela; uma retentativa interna pode, em tese, consumir um valor.

Garantir sequência sem furo algum exigiria segurar o lock até o fim da operação
de negócio inteira, serializando toda a abertura de OS da empresa — custo
operacional desproporcional ao benefício estético.

## Alternativas consideradas

| Alternativa             | Por que não                                   |
| ----------------------- | --------------------------------------------- |
| `AUTO_INCREMENT`        | É global por tabela, não por tenant           |
| `MAX(numero) + 1`       | Condição de corrida; proibido pelo item 17    |
| `SELECT ... FOR UPDATE` | Deadlock comprovado em teste sob concorrência |
| UUID exibido ao cliente | Ilegível; proibido pelo item 16               |
| Sequência por unidade   | Ambiguidade em QR, portal, suporte e garantia |

## Consequências

- Chamadas concorrentes à **mesma** sequência serializam; tenants e tipos
  diferentes não competem entre si.
- `tenant_sequences` nunca é apagada nem reiniciada: zerar o contador
  corromperia a referência de documentos históricos.
- Coberto por teste de concorrência real (20 alocações simultâneas produzem
  exatamente 1..20, sem colisão).
