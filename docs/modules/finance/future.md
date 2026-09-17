# Financeiro — o que ficou para depois

O Prompt 12 entrega o **núcleo operacional**. Esta página lista, de forma
explícita, o que **não** foi feito — para que ninguém leia o módulo como mais
completo do que ele é.

## Deliberadamente fora do Prompt 12

| Assunto                               | Situação                | Por quê                                                                        |
| ------------------------------------- | ----------------------- | ------------------------------------------------------------------------------ |
| Juros, multa e correção por atraso    | **pendente**            | exige a política da empresa cadastrada; calcular sem ela seria inventar número |
| Desconto e acréscimo na liquidação    | **pendente**            | muda o valor devido, e isso precisa de regra e de autorização própria          |
| Conciliação bancária / OFX            | **fora de escopo**      | o Nexo56 não fala com banco                                                    |
| Integração PIX real                   | **proibido** (item 118) | não há infraestrutura de custódia                                              |
| Antecipação de recebível de cartão    | **fora de escopo**      | não há integração com adquirente                                               |
| Emissão fiscal                        | **fora de escopo**      | módulo próprio, prompt próprio                                                 |
| DRE, margem, lucro                    | **fora de escopo**      | receita − despesas não é lucro; um KPI sem fonte da verdade engana             |
| Centro de custo                       | **pendente**            | categoria já agrupa; centro de custo é outra dimensão                          |
| Score de crédito, limite, bloqueio    | **fora de escopo**      | o sistema mostra, não julga                                                    |
| Cobrança automática (WhatsApp/e-mail) | **proibido** (item 118) | Comunicação externa é prompt próprio                                           |
| Rule engine / automações              | **proibido** (item 118) | prompt próprio                                                                 |
| Nexo56 AI                             | **proibido** (item 118) | prompt próprio                                                                 |
| Garantias                             | **proibido** (item 118) | Prompt 13                                                                      |

## O gancho preparado

`SERVICE_ORDER_FINANCIAL_SETTLED` é emitido quando todos os recebíveis de uma OS
ficam quitados.

**Situação: preparado, sem consumidor.** Ele existe para o Prompt 13, e está
documentado assim no próprio `event.ts` para que não seja confundido com uma
automação já em funcionamento.

## Dívidas técnicas conhecidas

- **`listAccountMovements` não pagina.** Devolve no máximo 200 linhas. Para um
  extrato de um ano isso não basta, e a paginação por cursor é o caminho — mas
  não era necessária para o extrato do caixa do dia, que é o uso real hoje.
- **O fluxo de caixa agrupa por dia.** Uma visão mensal ou semanal exigiria
  agregação diferente; hoje a tela mostra o mês corrente por dia.
- **Não há relatório exportável.** Nem CSV, nem PDF.
