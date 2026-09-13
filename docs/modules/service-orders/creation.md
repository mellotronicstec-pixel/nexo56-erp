# Abertura e idempotência

## Dois caminhos, um preferido

```
Recebimento → Criar Ordem de Serviço     ← caminho normal do balcão
Equipamento → Abrir Ordem de Serviço     ← quando não houve recebimento formal
```

O primeiro é o que a interface oferece: na ficha do recebimento (e na lista de
recebimentos) existe a ação **Criar Ordem de Serviço**, que já leva cliente,
equipamento e unidade resolvidos.

### Por que o segundo caminho existe

Abrir OS direto de um equipamento já cadastrado é um caso real: o aparelho que
já estava na bancada de um atendimento anterior, o retorno combinado por
telefone, a empresa que traz a máquina sem passar pelo balcão. Recusar isso
obrigaria o atendente a **inventar um recebimento que não aconteceu** — dado
falso para satisfazer o sistema.

Quando há recebimento, o vínculo é histórico e a unidade tem de bater.

## Coerência de unidade

Um recebimento da Unidade A **não** gera OS na Unidade B. Barrado em dois
lugares:

1. no serviço, com mensagem útil ("troque para a unidade do recebimento");
2. no banco, pela FK composta `(intake_id, unit_id)`.

O segundo existe porque o primeiro some no dia em que alguém escrever outro
caminho de criação.

## Uma OS por recebimento

Cardinalidade **1:1** — ver [ADR-035](../../adr/ADR-035-cardinalidade-recebimento-ordem.md).
Garantida por `uq_service_order_intake`. A interface reflete isso: quando o
recebimento já tem ordem, o atalho deixa de oferecer "criar" e passa a levar
para a OS existente.

## Idempotência

O problema concreto: o atendente clica duas vezes, a rede cai depois do envio,
ou ele aperta F5. Sem proteção, nascem duas OS para o mesmo aparelho — com dois
números, duas etiquetas e um cliente confuso.

**Três camadas, da mais barata para a mais definitiva:**

1. **Navegador** — o botão desabilita enquanto o envio está em curso.
2. **Chave de comando** — o formulário gera uma chave (`crypto.randomUUID`) uma
   única vez por montagem. Reenviar o mesmo formulário manda a mesma chave; o
   serviço reencontra a ordem já criada e devolve `reused: true`, **sem gastar um
   número da sequência**.
3. **Banco** — `uq_service_order_idempotency (tenant_id, idempotency_key)`. Dois
   envios verdadeiramente simultâneos passam juntos pela consulta antecipada; o
   segundo bate no UNIQUE, e em vez de erro o serviço devolve a ordem que o
   primeiro criou.

A chave **não** é compartilhada entre empresas: ela é única por tenant.

Testado: cinco aberturas simultâneas com a mesma chave produzem **uma** ordem;
comandos diferentes produzem ordens diferentes; a mesma chave em dois tenants
produz duas ordens independentes, ambas numeradas 1.

Se o navegador não tiver `crypto.randomUUID` (contexto não seguro antigo), o
formulário gera uma chave alternativa e o envio continua funcionando — ali a
proteção volta a ser a do banco.

## O que é validado no servidor

O frontend é conveniência. O serviço revalida tudo:

- relato do cliente obrigatório e dentro do limite;
- unidade ativa obrigatória;
- equipamento existente **no tenant** (senão: "não encontrado", sem revelar);
- recebimento, quando informado, existente, do mesmo equipamento e da mesma
  unidade;
- cliente derivado do equipamento — enviar `customerId` no corpo não muda nada.

## Tudo numa transação

Na mesma transação: alocação do número, `INSERT` da ordem, primeiro fato da
linha do tempo, registro de auditoria e evento no outbox. Se qualquer parte
falhar, não sobra número alocado sem documento nem documento sem trilha.
