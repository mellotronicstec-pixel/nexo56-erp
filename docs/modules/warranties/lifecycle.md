# Ciclo de vida da garantia

## Emissão

A garantia interna exige a Ordem de Serviço em **`completed`** e é sempre um ato
humano explícito. O motivo está em
[ADR-063](../../adr/ADR-063-garantia-interna-comeca-na-entrega.md): a cobertura
começa quando o cliente leva o aparelho, não quando paga.

O workflow já tinha o ato formal de entrega — a transição
`awaiting_customer_pickup → completed`, rotulada "O cliente retirou o aparelho".
Nenhum marco novo foi inventado.

`SERVICE_ORDER_FINANCIAL_SETTLED` (Prompt 12) **não é consumido**. O comentário
do evento registra que a omissão é deliberada.

### O que a emissão faz, na mesma transação

1. aloca o número (`allocateSequenceNumber`, nunca `MAX+1`);
2. copia os termos da política, se houver (ADR-062);
3. grava os itens de cobertura;
4. escreve a timeline (`created` + `activated`);
5. registra auditoria;
6. emite os eventos `WARRANTY_CREATED` e `WARRANTY_ACTIVATED` pelo outbox.

### Vigência

`starts_on` é a data civil de hoje no fuso da empresa (ou a informada).
`ends_on` sai de `warrantyEndDate(startsOn, amount, unit)`:

- `months` usa `addMonths`, que **trunca para o último dia do mês** quando o dia
  de origem não existe no destino (31 de janeiro + 1 mês = 28 ou 29 de
  fevereiro);
- `days` usa `addDays`;
- o fim é **inclusivo**: o dia `ends_on` ainda é dia coberto.

O banco tem `CHECK (starts_on <= ends_on)` e `CHECK (duration_amount > 0)`.

## Cancelamento

**Cancelar é admitir que a garantia não deveria ter sido emitida** — vale para
trás. Permitido em `draft` e `active` (`canCancel`). Exige motivo com no mínimo
10 caracteres.

## Revogação

**Revogar é dizer que a garantia deixa de valer de agora em diante** — conduta
do cliente, violação de termo, lacre rompido. Permitido apenas em `active`
(`canRevoke`). Exige motivo.

Os retornos já registrados **continuam no histórico**: revogar não apaga um
atendimento que aconteceu, e `was_enforceable` daquele retorno continua sendo o
que era no dia.

## Por que dois atos e não um

Apagar a distinção faria "emiti errado" e "o cliente abriu o aparelho" virarem o
mesmo registro. São histórias diferentes, e quem lê o histórico seis meses
depois precisa saber qual das duas aconteceu.

## Timeline

Toda mudança escreve em `warranty_timeline`, com ator, instante, resumo e
motivo. A ficha mostra os 100 eventos mais recentes, com os nomes dos atores
resolvidos em **uma** consulta — nunca uma por linha.
