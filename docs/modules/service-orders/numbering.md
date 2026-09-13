# Numeração humana

## A decisão

**Uma sequência por empresa, compartilhada por todas as unidades.**

A loja Centro abre a OS 1001; a próxima aberta na loja Norte é a 1002. Não há
contagem por unidade.

O motivo é telefônico, não técnico: numeração por unidade produziria duas
"OS 1001" na mesma empresa, e quem atende o telefone não teria como saber de
qual o cliente está falando sem perguntar em que loja ele esteve.

## O mecanismo é o do Prompt 02

Nenhum mecanismo novo foi criado. A alocação usa
`allocateSequenceNumber(tx, tenantId, 'service_order', { prefix: 'OS', padding: 6 })`
sobre a tabela `tenant_sequences`, com o idioma atômico do MariaDB:

```sql
INSERT INTO tenant_sequences (...) VALUES (..., LAST_INSERT_ID(1), ...)
ON DUPLICATE KEY UPDATE current_value = LAST_INSERT_ID(current_value + 1)
```

Uma única instrução lê e incrementa, sem janela entre as duas coisas. Há teste
verificando que **nenhuma outra linha de sequência** foi inventada para a OS.

A alocação acontece **dentro da transação** que grava a ordem: número e
documento nascem ou falham juntos.

## Concorrência — o que foi testado

| Cenário                                                       | Resultado                          |
| ------------------------------------------------------------- | ---------------------------------- |
| 20 aberturas simultâneas na mesma empresa                     | 20 números distintos, de 1 a 20    |
| 10 aberturas simultâneas, conferindo o banco                  | 10 linhas, 10 números distintos    |
| 8 + 8 aberturas simultâneas em dois tenants                   | cada empresa com 1..8, sem mistura |
| 6 + 6 aberturas simultâneas em duas unidades da mesma empresa | 12 números distintos, 1..12        |
| `INSERT` direto repetindo um número                           | recusado (`ER_DUP_ENTRY`)          |

Executados de verdade, com `Promise.all`, contra MariaDB — não simulados.

## Lacunas

São aceitas, conforme o Prompt 02. Se a transação do chamador abortar depois de
alocar, o incremento volta atrás com ela; uma retentativa interna pode, em
teoria, consumir um valor. Perseguir ausência absoluta de furos exigiria segurar
o lock até o fim da operação de negócio, serializando toda a abertura de OS da
empresa. Unicidade vale mais do que numeração sem furos.

## Formato: valor persistido ≠ apresentação

O banco guarda **apenas o inteiro**. Prefixo e zeros à esquerda vivem em
`tenant_sequences` e são aplicados na exibição por
`formatServiceOrderNumber(valor, prefixo, padding)` → `OS #001024`.

Acoplar o prefixo ao valor persistido tornaria irreversível uma decisão de
apresentação: mudar "OS" para outra sigla exigiria reescrever linhas históricas,
e dois formatos conviveriam na mesma empresa.

A leitura do prefixo custa **uma consulta por página**, não por linha.

## Busca pelo número

`parseServiceOrderNumber` aceita `1234`, `OS 1234`, `OS #001234` e `os#1234` —
como aparece impresso, não como o inteiro cru. A condição resultante é uma
**igualdade** sobre a coluna indexada, não um `LIKE '%1234%'` que varreria a
tabela e ainda traria a OS 21024 junto.

O ID técnico continua sendo UUIDv7. O número humano nunca substitui a PK.
