# Ordens de Serviço

O documento operacional da assistência: o que foi recebido, de quem, em qual
unidade, e o que o cliente relatou. É a entidade em torno da qual orçamento,
peças, garantia e financeiro serão construídos.

Decisões: [ADR-033](../../adr/ADR-033-ordem-de-servico-pertence-a-unidade.md),
[ADR-034](../../adr/ADR-034-numeracao-da-ordem-de-servico.md),
[ADR-035](../../adr/ADR-035-cardinalidade-recebimento-ordem.md),
[ADR-036](../../adr/ADR-036-fronteira-entidade-workflow.md).

## Índice

- [Modelo de dados](model.md)
- [Numeração humana](numbering.md)
- [Abertura e idempotência](creation.md)
- [Busca e listagem](search.md)
- [Histórico estrutural](history.md)
- [Permissões, auditoria e eventos](access.md)
- [Etiqueta física e QR — o que existe e o que falta](label.md)
- [12 perguntas de modularidade](modularity.md)
- [Fronteira com o Prompt 08](workflow-boundary.md)

## A decisão que define o módulo

**A Ordem de Serviço pertence ao TENANT e à UNIDADE.**

```
Tenant ──< Cliente ──< Equipamento          (atravessam lojas e anos)
                            │
                            ├──< Recebimento >── Unidade   (a entrega, num lugar)
                            │         │
                            │         └──< Ordem de Serviço >── Unidade
                            │
                            └──< Ordem de Serviço  (também sem recebimento)
```

Cliente e equipamento são do tenant porque atravessam as lojas: a mesma pessoa,
o mesmo aparelho. A Ordem de Serviço é da unidade porque é **o trabalho
assumido** — tem bancada, prazo e responsável, e nada disso é compartilhado
entre filiais.

`unit_id` é obrigatório, sai de `context.activeUnitId` e **não muda depois**.

## O que o módulo faz

| Capacidade                                                     | Estado                                          |
| -------------------------------------------------------------- | ----------------------------------------------- |
| Abrir OS a partir de um recebimento                            | implementado                                    |
| Abrir OS direto de um equipamento cadastrado                   | implementado                                    |
| Numeração humana única por empresa, segura sob concorrência    | implementado                                    |
| Vínculo com cliente, equipamento, recebimento, unidade e autor | implementado                                    |
| Relato do cliente, separado de observação interna              | implementado                                    |
| Idempotência do comando de abertura                            | implementado                                    |
| Listagem da unidade, busca e filtros                           | implementado                                    |
| Ficha operacional, utilizável no celular                       | implementado                                    |
| Histórico estrutural (linha do tempo)                          | implementado                                    |
| Correção auditada dos dados de abertura                        | implementado                                    |
| Contrato de dados da etiqueta física                           | implementado                                    |
| **Etiqueta física imprimível**                                 | **não — faltam QR e classificação de garantia** |
| **Máquina de estados / workflow**                              | **não — Prompt 08**                             |
| Orçamento, peças, financeiro, garantia                         | fora do escopo (Prompts 09+)                    |

## O que o módulo deliberadamente não faz

- **Não muda de estado.** Existe um único estado, o inicial
  (`awaiting_technical_opinion`), e nenhuma transição. O Prompt 08 é a
  autoridade sobre a máquina de estados.
- **Não troca cliente, equipamento nem unidade.** São a identidade do
  atendimento; mudá-los como edição trivial migraria o histórico de um aparelho
  para outro sem registro.
- **Não se exclui.** A OS é registro histórico operacional. Não há botão de
  excluir, e cancelamento será estado do workflow, não `DELETE`.
- **Não copia o recebimento.** Acessórios, inspeção e fotos continuam morando no
  recebimento; a ficha os lê de lá.

## Fluxo real de balcão

1. Cliente identificado (módulo Clientes).
2. Equipamento cadastrado ou já existente (módulo Equipamentos).
3. **Recebimento** registrado na unidade (Prompt 06).
4. Na ficha do recebimento, **Criar Ordem de Serviço**.
5. A tela mostra o **resumo** — cliente, equipamento, unidade, recebimento — e
   pede uma coisa só: o relato do cliente.
6. Confirmação → número humano alocado → ficha da OS.

Percorrido de ponta a ponta em navegador real contra o build de produção
(73 verificações automatizadas).

## Mobile

A ficha foi feita para ser usada no celular, não redimensionada para caber:

- cabeçalho responde primeiro "qual OS, de quem, qual aparelho";
- seções progressivas em vez de tabela horizontal;
- cartões substituem a tabela abaixo de 768px;
- ações principais com 40px ou mais; qualquer link com no mínimo 24px (WCAG 2.2
  AA 2.5.8);
- sem rolagem horizontal em 360, 390, 768, 1024, 1280, 1440 e 1920px.

Validado redimensionando um navegador real. **Não** foi validado em aparelho
físico nem em iOS/Safari.
