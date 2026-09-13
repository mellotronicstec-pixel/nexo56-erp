# ADR-034 — Numeração da OS: sequência do tenant, valor sem formatação

**Status:** Aceito · **Data:** Prompt 07

## Contexto

A OS precisa de um número que uma pessoa consiga dizer ao telefone. UUID não
serve para isso.

O Prompt 02 já criou `tenant_sequences` e o mecanismo atômico de alocação
(ADR-013), testado sob concorrência. Restavam três decisões: o escopo da
contagem, o que persistir e como garantir unicidade.

## Decisão

1. **Escopo: por tenant.** Uma sequência `service_order` por empresa,
   compartilhada por todas as unidades.
2. **Mecanismo: o existente.** `allocateSequenceNumber` sobre
   `tenant_sequences`, dentro da transação que grava a ordem. Nenhum segundo
   mecanismo.
3. **Persistência: só o inteiro.** Prefixo e zeros à esquerda ficam em
   `tenant_sequences` e são aplicados na apresentação.
4. **Unicidade no banco:** `uq_service_order_tenant_number`.

## Motivo

**Por que não por unidade.** Numeração por unidade produziria duas "OS 1001" na
mesma empresa. Quem atende o telefone ouviria o número e não saberia de qual
ordem o cliente fala sem antes perguntar em que loja ele esteve — e o cliente
frequentemente não sabe dizer. O ownership é da unidade (ADR-033); a numeração
não precisa segui-lo, porque ela resolve outro problema: identificar o documento
para um humano.

**Por que reusar `tenant_sequences`.** O mecanismo já existe, já é atômico
(`INSERT … ON DUPLICATE KEY UPDATE current_value = LAST_INSERT_ID(current_value + 1)`)
e já foi testado sob concorrência. Um segundo mecanismo significaria duas
implementações de uma mesma garantia — e a segunda seria a que ninguém lembra de
manter. `SELECT MAX(number) + 1` está fora de questão: duas requisições
simultâneas leem o mesmo máximo.

**Por que persistir só o inteiro.** Gravar `"OS 001024"` acoplaria uma decisão de
apresentação ao dado. Mudar a sigla amanhã exigiria reescrever linhas históricas,
e dois formatos conviveriam na mesma empresa. Com o inteiro, a apresentação é
recalculada; com o texto, ela é irreversível.

## Consequências

- **Lacunas são aceitas** (ADR-013). Transação abortada devolve o incremento;
  retentativa interna pode consumir um valor. Eliminar furos exigiria segurar o
  lock até o fim da operação de negócio, serializando toda a abertura de OS da
  empresa — unicidade vale mais.
- A exibição custa **uma consulta por página** (prefixo e padding do tenant), não
  por linha.
- A busca pelo número aceita `1234`, `OS 1234` e `OS #001234`, e vira igualdade
  sobre índice — não `LIKE`.
- O formato fica configurável por empresa sem migration, porque já mora em
  `tenant_sequences`.

## Verificação

Testes reais com `Promise.all` contra MariaDB: 20 aberturas simultâneas geram
20 números distintos e contíguos; dois tenants em paralelo mantêm contagens
independentes; duas unidades da mesma empresa compartilham a contagem sem
colidir; `INSERT` direto com número repetido é recusado pelo banco.
