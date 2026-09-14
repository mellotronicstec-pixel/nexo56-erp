# Permissões do Estoque

## O corte é por consequência, não por botão

| Permissão                    | Escopo            | Capacidade                                                      |
| ---------------------------- | ----------------- | --------------------------------------------------------------- |
| `inventory.view`             | unidade           | consultar peças, saldos, reservas, localizações e movimentações |
| `inventory.catalog_manage`   | **tenant**        | criar, editar e inativar peças; definir estoque mínimo          |
| `inventory.locations_manage` | unidade           | criar, editar e inativar localizações                           |
| `inventory.receive`          | unidade           | registrar entrada                                               |
| `inventory.issue`            | unidade           | registrar saída e consumir reserva                              |
| `inventory.reserve`          | unidade           | reservar e liberar                                              |
| `inventory.transfer`         | **duas** unidades | transferir entre unidades                                       |
| `inventory.adjust`           | unidade           | ajustar saldo (ação sensível)                                   |

Consultar saldo é uma coisa; mexer no catálogo da empresa inteira é outra; e
**ajustar** saldo — reescrever quanto o sistema acredita existir — é a ação que
uma assistência quer nas mãos de pouca gente.

Entrada, saída, reserva e transferência são separadas porque, numa loja, são
papéis diferentes: quem recebe mercadoria não é necessariamente quem entrega
peça ao técnico.

## O que não existe

**Não há `inventory.count`.** Contagem de inventário não foi implementada (item
57), e declarar a permissão faria o catálogo prometer capacidade inexistente.

## Escopo TENANT × UNIDADE

- **Catálogo** é capacidade de tenant: quem só opera numa unidade não passa a
  mandar no vocabulário da empresa por estar logado nela. A autorização de
  `createPart` / `updatePart` é chamada **sem `unitId`**.
- **Movimentação, saldo, reserva e localização** são avaliados **por unidade**.
  Um papel de unidade concedido na loja A não autoriza operar na loja B —
  verificado em teste de integração.
- **Transferência** autoriza nas **duas** pontas: quem transfere precisa da
  permissão na origem e no destino.

## Effective Access

O backend é a autoridade. Toda operação passa por
`authorize(context, { permission, featureKey: 'operations.inventory', unitId })`,
que avalia, nesta ordem: feature existe → plano contempla → tenant ativou →
dependências satisfeitas → pessoa tem a permissão.

**Esconder o menu não é segurança.** Todos os testes de autorização chamam os
casos de uso **diretamente**, sem passar por tela nenhuma — que é como um
atacante chamaria.

Com o módulo desativado, até o administrador é recusado.

## Unidade sem vínculo

Responde **"não encontrada"**, nunca "sem permissão" — a segunda confirmaria a
existência do recurso.
