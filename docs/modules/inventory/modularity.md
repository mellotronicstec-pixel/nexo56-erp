# Modularidade do Estoque

## Classificação

`operations.inventory` — **OPTIONAL**.

O prefixo nomeia a **área do produto**; o `type` decide se o tenant pode
desligar. Estoque é a primeira capacidade de negócio genuinamente opcional:
assistência que compra peça por atendimento não mantém estoque, e o Orçamento
continua inteiro com linha PART manual. Chamá-la de `core.inventory` sendo
OPTIONAL faria a constante contradizer o tipo.

## As 12 perguntas obrigatórias (item 165)

**1. Qual a classificação do módulo?**
OPTIONAL, chave `operations.inventory`.

**2. Pode ser desativado?**
Sim. É a primeira feature de negócio que pode.

**3. Quais dependências?**
`core.service_orders` — reserva e consumo se vinculam a uma OS da unidade.
Transitivamente, Clientes e Equipamentos. **Não** depende de `core.quotes`, e
não pode: o vínculo peça × linha PART é opcional nos dois sentidos, e uma
dependência mútua seria um ciclo.

**4. Quais módulos dependem dele?**
Nenhum. `core.quotes` referencia `parts` por FK anulável, mas **não** declara
dependência de feature: com Estoque desligado, o orçamento funciona inteiro.
O Prompt 11 (Compras) dependerá.

**5. O que acontece com os dados quando desativado?**
Nada é apagado. Peças, localizações, saldos, movimentações, reservas e
transferências permanecem. A linha em `tenant_features` fica com
`enabled = false` e `disabled_at` preenchido.

**6. Como o frontend reage?**
O item "Estoque e peças" some do menu. A seção de Peças some da ficha da OS. O
seletor de peça some do editor de orçamento. As páginas `/estoque*` respondem
com acesso negado. Nenhuma tela quebra.

**7. Como a API reage?**
Toda operação é recusada por `AuthorizationError` com razão `TENANT_DISABLED` —
inclusive para o administrador. Verificado em teste.

**8. Como automações futuras reagem?**
Não há automações. Os eventos (`STOCK_*`, `LOW_STOCK_DETECTED`) continuam
existindo no catálogo, e o job de estoque baixo continua registrado — ele apenas
não encontra saldo para marcar em tenant que não opera estoque. Não há Rule
Engine (item 171).

**9. Quais permissões?**
As oito de [permissions.md](permissions.md). Elas continuam existindo no
catálogo quando o módulo está desligado; o que barra é o Effective Access.

**10. Quais restrições de plano?**
`operations.inventory` precisa estar nos `plan_entitlements` do plano do tenant.
Sem isso, ativar é recusado com `PLAN_NOT_ENTITLED`.

**11. Como a reativação funciona?**
Revalida plano e dependências, marca `enabled = true` e limpa `disabled_at`. O
que volta:

- **localizações** — com a situação que tinham;
- **permissões** — voltam a valer;
- **jobs** — a varredura volta a encontrar saldos;
- **reservas abertas** — continuam abertas, com o mesmo `remaining`;
- **alertas** — a marca `low_stock_alerted_at` permanece, então não há enxurrada
  de eventos repetidos na reativação;
- **configurações** — estoque mínimo por peça e unidade permanece.

**12. Como a integridade histórica é preservada?**
O ledger é append-only e nunca é apagado. Os orçamentos guardam o próprio
snapshot comercial, então continuam legíveis mesmo sem o módulo. A linha do
tempo da OS guarda os fatos de peça já registrados.

## Orçamento sem Estoque (item 86)

Regra importante para a modularidade: **o Orçamento precisa continuar
funcionando se o módulo de Estoque estiver indisponível**, mantendo linhas PART
manuais.

Verificado em `tests/integration/inventory-quote.test.ts`: com o módulo
desligado, o orçamento histórico continua legível com peça vinculada, e ainda
aceita edição com linha PART escrita à mão.
