# ADR-068 — Reclassificar passa pela máquina de estados, com motivo

**Status:** Aceito
**Data:** Prompt 13 — Garantias
**Itens atendidos:** 32, 69, 89, 100

## Contexto

Acontece: o aparelho volta, é aberto como retorno em garantia, e a bancada
descobre que o defeito novo não tem relação com o serviço garantido — queda,
líquido, outro componente. A OS foi aberta como garantia e precisa virar
atendimento comercial normal.

O caminho de menor esforço seria um `UPDATE service_orders SET status =
'awaiting_technical_opinion', classification = 'standard'`. Ele é proibido por
dois motivos: escreve direto em `service_orders.status`, e apaga a informação de
que a ordem **já foi** considerada garantia.

## Decisão

**A reclassificação é uma transição como qualquer outra, com regra própria na
matriz, permissão própria e motivo obrigatório.**

```ts
{
  from: 'awaiting_repair',
  to: 'awaiting_technical_opinion',
  label: 'Reclassificar para orcamento',
  permission: PERMISSIONS.SERVICE_ORDERS_TRANSITION,
  requiresReason: true,
  actionOnly: true,
  hint: 'O defeito nao esta coberto pela garantia e precisa de novo parecer.',
}
```

`actionOnly: true` — o mesmo mecanismo de "Informar Ordem Disponível" — mantém a
regra **fora** do seletor genérico de status: ela só é alcançável pela ação
dedicada, que exige `via: 'warranty_reclassification'`.

`reclassifyWarrantyServiceOrder` usa `planTransition` / `applyTransition`: a
mesma máquina, o mesmo registro de timeline, a mesma concorrência otimista.

## Três permissões, três atos

- `warranties.return.create` — registrar o retorno (balcão);
- `warranties.reclassify` — dizer que não é garantia (autoridade técnica);
- `service_orders.transition` — mover a ordem no fluxo.

A autorização é sempre por **chave de permissão**, nunca pelo nome textual do
cargo. "Técnico sênior" é rótulo de organograma; permissão é o que o sistema
verifica.

## O motivo é obrigatório e tem tamanho mínimo

`RECLASSIFY_REASON_MIN = 15`. Não é burocracia: reclassificar contraria uma
decisão anterior da própria loja, e quem ler a OS daqui a seis meses — ou o
cliente que reclamar — precisa encontrar a justificativa escrita, não um campo
que mudou sozinho. O motivo entra na timeline da OS **e** na da garantia.

## O que a reclassificação NÃO faz

Não envia mensagem. Não cancela a garantia. Não cria orçamento. Não cobra.
Avisar o cliente de que o conserto deixou de ser gratuito é ato humano, e a tela
diz isso em texto.

## Consequências

**Ganhamos:** o erro é corrigível sem apagar o histórico, e a correção é
auditável.

**Pagamos:** mais um passo para quem reclassifica. É o passo que registra a
decisão.
