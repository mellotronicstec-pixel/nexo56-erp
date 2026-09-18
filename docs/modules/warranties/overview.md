# Garantias — visão geral

Garantia, no Nexo56, é **domínio de primeira classe**: tem entidade própria,
vigência própria, cobertura descrita, certificado, histórico e permissões
separadas. Não é um campo na Ordem de Serviço, não é um status e não é um
booleano "tem garantia".

## O que este módulo responde

| Pergunta do balcão               | Onde está a resposta                   |
| -------------------------------- | -------------------------------------- |
| "Este aparelho tem garantia?"    | ficha do equipamento → seção Garantias |
| "O que exatamente está coberto?" | ficha da garantia → itens de cobertura |
| "Ainda está no prazo?"           | classe temporal, calculada na hora     |
| "Posso consertar de graça?"      | **acionável** = ativa **E** vigente    |
| "Já voltou antes?"               | retornos da garantia / da OS original  |
| "Quanto isso nos custou?"        | custos (permissão separada)            |

## Os quatro tipos

- **`internal`** — a loja garante o serviço que executou. Único tipo que gera OS
  de garantia automaticamente.
- **`factory`** — o fabricante garante o aparelho. A loja intermedeia.
- **`part`** — o fornecedor/fabricante garante a peça instalada. Prazo próprio,
  independente da mão de obra (ADR-069).
- **`extended`** — contrato estendido.

## Duas dimensões de estado

**Situação administrativa** (persistida): `draft`, `active`, `cancelled`,
`revoked` — o que a empresa decidiu.

**Classe temporal** (derivada): `future`, `valid`, `expired` — o que o
calendário diz. Nunca persistida (ADR-064).

Uma garantia revogada dentro do prazo não vale. Uma garantia ativa e vencida
também não. **Acionável** é a conjunção, calculada contra a data civil de hoje
no fuso da empresa.

## O caminho completo

```
OS concluída
   └─ emitir garantia (ato humano, permissão warranties.issue)
        ├─ termos COPIADOS da política (ADR-062)
        ├─ itens de cobertura listados
        └─ certificado (snapshot + checksum + token opaco)

aparelho volta
   └─ registrar retorno (permissão warranties.return.create)
        ├─ referenceDate e wasEnforceable congelados
        ├─ avaliação de cobertura: covered | not_covered | undetermined
        └─ se vigente E coberto E interna:
             OS NOVA em `awaiting_repair`, na MESMA transação (ADR-065, ADR-066)

defeito não era coberto
   └─ reclassificar (permissão warranties.reclassify, motivo obrigatório)
        └─ transição pela máquina de estados → awaiting_technical_opinion
```

## O que este módulo NÃO faz

Não envia WhatsApp, e-mail ou SMS. Não cria título financeiro nem cobrança. Não
compra peça. Não escreve em `service_orders.status`, `stock_balances`,
`stock_movements`, `stock_reservations` nem `financial_movements`. Não gera PDF.
Não implementa Rule Engine nem IA.

Cada uma dessas ausências é deliberada e tem ADR ou seção própria nesta pasta.

## Documentos

| Arquivo                            | Assunto                                    |
| ---------------------------------- | ------------------------------------------ |
| [policies.md](policies.md)         | Políticas e por que elas não são a verdade |
| [coverage.md](coverage.md)         | Cobertura total e parcial                  |
| [lifecycle.md](lifecycle.md)       | Emissão, cancelamento, revogação           |
| [returns.md](returns.md)           | Retorno, nova OS e reclassificação         |
| [certificates.md](certificates.md) | Certificado, snapshot, QR — e o que falta  |
| [costs.md](costs.md)               | Custo de garantia sem tocar no Financeiro  |
| [interface.md](interface.md)       | Telas, navegação e responsividade          |
| [permissions.md](permissions.md)   | As dez permissões e por que são dez        |
| [integrations.md](integrations.md) | OS, Estoque, Compras e Financeiro          |
| [modularity.md](modularity.md)     | O que acontece com Garantias desligado     |
| [concurrency.md](concurrency.md)   | Idempotência, corrida e duplo clique       |
| [security.md](security.md)         | Tenant, unidade, token e dado pessoal      |
| [future.md](future.md)             | O que ficou preparado e o que não existe   |
