# ADR-015 — Ownership entre tenant e unidade

**Status:** Aceito · **Data:** Prompt 02

## Contexto

Um ERP multiempresa e multiunidade precisa responder, para cada entidade: ela
pertence à empresa ou à filial? Errar isso cria duplicação de cadastro ou
vazamento entre filiais — e corrigir depois é migração dolorosa.

## Decisão

### Todo tenant tem pelo menos uma unidade

Empresa de loja única opera com uma unidade padrão. **Não existem duas
arquiteturas** (uma para loja única, outra para rede).

### Ownership por entidade

| Entidade                    | Escopo                           | Motivo                                                               |
| --------------------------- | -------------------------------- | -------------------------------------------------------------------- |
| **Cliente**                 | tenant                           | A mesma pessoa é atendida em qualquer filial, sem cadastro duplicado |
| **Equipamento**             | tenant + cliente                 | Não se duplica por passar em outra unidade                           |
| **Ordem de Serviço**        | tenant + **unidade obrigatória** | A OS acontece fisicamente em um lugar                                |
| **Estoque físico**          | tenant + **unidade obrigatória** | Peça está em uma prateleira específica                               |
| **Movimentação de estoque** | tenant + **unidade obrigatória** | Herda o local do estoque                                             |
| **Pagamento / caixa**       | tenant + **unidade obrigatória** | Dinheiro entra em um caixa concreto                                  |
| **Compra / recebimento**    | tenant + unidade                 | Recebimento é físico                                                 |
| **Agenda operacional**      | tenant + unidade                 | Compromisso acontece em um lugar                                     |

A unidade de origem de um cliente pode ser registrada como informação
(`origin_unit_id`), **nunca** como ownership.

### `unit_id` nunca aparece sozinho

Quando existir, a FK é composta `(unit_id, tenant_id) → units(id, tenant_id)`
— ver ADR-018.

## Motivo

A pergunta que separa os dois casos: **"se a empresa fechar esta filial, este
registro deixa de fazer sentido?"**

- Cliente: não. Ele continua sendo cliente da empresa.
- OS: sim. Ela aconteceu naquela unidade, com aquele estoque e aquele caixa.

## Alternativas consideradas

| Alternativa                                   | Por que não                                                   |
| --------------------------------------------- | ------------------------------------------------------------- |
| Cliente por unidade                           | Duplicaria cadastro e histórico da mesma pessoa entre filiais |
| Tudo por tenant, sem unidade                  | Impossibilita estoque e caixa por filial                      |
| `unit_id` opcional na OS                      | Deixaria a OS "sem lugar", quebrando estoque e fechamento     |
| Unidade só para empresas com mais de uma loja | Duas arquiteturas; toda consulta precisaria dos dois caminhos |

## Consequências

- `platform.multi_unit` continua sendo feature **opcional**: controla a
  administração de várias unidades e a troca de unidade pelo usuário, não a
  existência da unidade.
- O escopo de unidade hoje limita **qual unidade o usuário seleciona**, não
  quais registros ele vê — porque ainda não há entidade de negócio com
  `unit_id`. Extensão prevista em ADR-016 e documentada como limite conhecido.
