# O que ficou preparado — e o que não existe

## Implementado e testado

Políticas, emissão, cobertura total e parcial, vigência derivada, cancelamento,
revogação, certificado com snapshot e token opaco, retorno com OS nova na mesma
transação, reclassificação pela máquina de estados, custos, timeline, eventos,
auditoria, interface completa.

## Preparado, não implementado

| O quê                  | O que existe hoje                                                                                                                                              |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PDF do certificado** | `format` é coluna; o snapshot é completo e determinístico. Um provider futuro lê o mesmo snapshot e grava `format = 'pdf'`. Hoje é HTML — o navegador imprime. |
| **Custo por período**  | `sumWarrantyCosts` soma no banco. Nenhuma tela o consome ainda.                                                                                                |
| **Garantia estendida** | o tipo `extended` existe e funciona como registro. Não há contrato, cobrança nem renovação.                                                                    |
| **Acionar fabricante** | `manufacturer`, `external_reference` e `supplier_id` guardam a quem recorrer. O encaminhamento é humano.                                                       |

## Deliberadamente não feito

- **Envio de mensagem** (WhatsApp, e-mail, SMS). Avisar o cliente é ato humano.
- **Cobrança automática** em garantia válida. Seria cobrar quem tem direito a
  não pagar.
- **Compra automática de peça.**
- **Rule Engine** para decidir cobertura.
- **Nexo56 AI.**
- **Fiscal e bancário.**
- **Ranking de técnico / índice de qualidade.** Número que aponta pessoas muda o
  comportamento antes de melhorar o processo.
- **DRE ou margem de garantia.** Receita menos algumas despesas não é lucro, e
  um número grande com nome errado é pior que número nenhum.

## O que mudaria se um desses entrasse

**PDF:** um provider novo, lendo o snapshot existente, gravando `format` e um
arquivo. Nada do que já foi emitido muda.

**Custo por período na tela:** consumir `sumWarrantyCosts` numa visão nova, com
a definição escrita antes do número.

**Consumo de `SERVICE_ORDER_FINANCIAL_SETTLED`:** exigiria revisitar ADR-063 —
e a resposta continuaria sendo que pagar não é retirar o aparelho.
