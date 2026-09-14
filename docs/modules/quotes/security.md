# Segurança — Orçamentos

## Implementado e verificado

| Proteção                                            | Como                                                         | Verificação                         |
| --------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------- |
| Orçamento ligado a OS de outra empresa              | FK composta `(service_order_id, tenant_id)`                  | teste com SQL direto                |
| Orçamento na unidade errada                         | **FK composta `(service_order_id, unit_id)`**                | teste com SQL direto                |
| `unitId` forjado no formulário                      | derivado da OS, nunca da entrada                             | teste de integração                 |
| Cliente/equipamento forjados                        | não existem no orçamento: são lidos da OS                    | revisão de modelo                   |
| Acesso a orçamento de outra empresa pelo UUID       | consulta escopada; responde "não encontrado"                 | teste de integração                 |
| Acesso a orçamento de unidade sem vínculo           | escopo por `authorizedUnitIds`; "não encontrado"             | teste de integração                 |
| Operar orçamento com papel de outra unidade         | autorização na unidade **da ordem**                          | teste de integração                 |
| **`service_orders.status` escrito pelo orçamento**  | **não existe caminho**: `planTransition` + `applyTransition` | **teste arquitetural sobre `src/`** |
| Envio com a OS em estado incompatível               | plano validado antes de qualquer gravação                    | teste de integração                 |
| Envio sem permissão de mover a OS                   | `planTransition` autoriza antes de gravar                    | teste de integração                 |
| Total forjado no formulário                         | recalculado no backend; o enviado é ignorado                 | teste de integração                 |
| Float impreciso definindo valores                   | `Money` com inteiro de centavos, ponta a ponta               | testes unitários de dinheiro        |
| `1.234,56` lido como R$ 1,23                        | `normalizeAmountInput` na Server Action                      | testes unitários + componente       |
| Valor negativo, quantidade zero, desconto excessivo | validado no domínio                                          | testes unitários + integração       |
| Edição de proposta já enviada                       | domínio + caso de uso + `WHERE status='draft'`               | teste de integração                 |
| Perda do valor que o cliente aprovou                | revisão é linha nova; a anterior não é tocada                | teste de integração + E2E           |
| Duas propostas vivas na mesma OS                    | UNIQUE `(service_order_id, active_marker)`                   | teste com SQL direto                |
| Duas versões aprovadas na mesma OS                  | UNIQUE `(service_order_id, approved_marker)`                 | constraint + fluxo                  |
| Número + revisão repetidos na empresa               | UNIQUE `(tenant_id, number, revision)`                       | teste com SQL direto                |
| Colisão de número sob concorrência                  | alocação atômica em `tenant_sequences`                       | 8 alocações simultâneas             |
| Duplo clique criando dois orçamentos                | chave de idempotência + UNIQUE                               | teste de integração                 |
| Duas aprovações simultâneas                         | `version` + compare-and-swap                                 | **teste com duas simultâneas**      |
| Gravação concorrente sobrescrevendo o rascunho      | `version` + compare-and-swap                                 | teste de integração                 |
| Evento de expiração duplicado                       | `status='sent'` no próprio `WHERE` do `UPDATE`               | duas varreduras simultâneas         |
| Valores do cliente em log                           | log registra operação, nunca o formulário                    | revisão de código                   |
| Relato do cliente no payload do evento              | payload só com chaves técnicas                               | teste com frase reconhecível        |

## O que NÃO está protegido porque não existe

- **Não há envio de comunicação externa.** "Enviar orçamento" formaliza a
  proposta; nenhuma mensagem sai. Não há, portanto, superfície de envio para
  proteger — quando houver (Prompt 16), terá seu próprio quadro.
- **Não há Portal do cliente.** Nenhuma aprovação chega de fora; a origem
  gravada é sempre `internal`.
- **Não há PDF.** Nenhum documento é gerado, então não há arquivo para proteger
  nem link para vazar.
- **Nenhum evento é consumido.** Sem handler, sem automação, sem Rule Engine.

## Dado sensível

O orçamento **não** guarda dado pessoal do cliente: nome, contato e equipamento
vivem na OS e no cadastro. O que ele tem de sensível é **comercial**:

| Campo                     | Classificação | Observação                                     |
| ------------------------- | ------------- | ---------------------------------------------- |
| `customer_notes`          | Interno       | texto que o cliente verá quando houver canal   |
| `internal_notes`          | Interno       | recado da equipe; nunca vai ao cliente         |
| `decision_reason`         | Interno       | texto livre de pessoa — pode conter incidental |
| `quote_items.description` | Interno       | escrito pela equipe                            |
| valores                   | Interno       | preço praticado é informação comercial         |

A separação entre `customer_notes` e `internal_notes` é estrutural, não
convenção: o futuro PDF e o futuro Portal leem só o primeiro.
