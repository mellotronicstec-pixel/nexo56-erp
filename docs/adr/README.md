# Architecture Decision Records — Nexo56

Registro das decisões arquiteturais do Nexo56 (Prompt 00, item 109).
Cada ADR informa **contexto**, **decisão**, **motivo**, **alternativas** e
**consequências**.

Os ADRs 001–012 vêm do Prompt 01 (fundação técnica); 013–018 do Prompt 02
(camada de dados); 019–022 do Prompt 03 (acesso, papéis e sessões); 023–025 do
Prompt 04 (Design System e interface); 026–028 do Prompt 05 (Clientes);
029–032 do Prompt 06 (Equipamentos, recebimento, mídia e leitura de etiqueta);
033–036 do Prompt 07 (Ordem de Serviço: ownership, numeração, cardinalidade e
fronteira com o workflow); 037–039 do Prompt 08 (workflow centralizado,
concorrência otimista e follow-up); 040–042 do Prompt 09 (Orçamentos); 043–047
do Prompt 10 (Estoque e Peças).

Um ADR não é reescrito quando a decisão muda: cria-se um novo ADR que o
substitui, e o antigo passa a `Substituído por ADR-XXX`.

| ADR                                                                        | Assunto                                               | Status |
| -------------------------------------------------------------------------- | ----------------------------------------------------- | ------ |
| [001](ADR-001-stack-principal.md)                                          | Stack principal                                       | Aceito |
| [002](ADR-002-monolito-modular.md)                                         | Monólito modular                                      | Aceito |
| [003](ADR-003-mariadb-e-orm.md)                                            | MariaDB/MySQL e ORM                                   | Aceito |
| [004](ADR-004-multi-tenancy.md)                                            | Estratégia multi-tenant compartilhada                 | Aceito |
| [005](ADR-005-isolamento-tenant-aware.md)                                  | Isolamento tenant-aware                               | Aceito |
| [006](ADR-006-autenticacao-e-sessoes.md)                                   | Autenticação e sessões                                | Aceito |
| [007](ADR-007-rbac.md)                                                     | RBAC                                                  | Aceito |
| [008](ADR-008-effective-access.md)                                         | Feature Catalog, Entitlements e Effective Access      | Aceito |
| [009](ADR-009-eventos-internos.md)                                         | Eventos internos                                      | Aceito |
| [010](ADR-010-background-jobs.md)                                          | Background jobs e evolução cron → queue               | Aceito |
| [011](ADR-011-design-system.md)                                            | Design System e identidade                            | Aceito |
| [012](ADR-012-deploy-hostinger.md)                                         | Deploy Hostinger                                      | Aceito |
| [013](ADR-013-numeracao-humana.md)                                         | Numeração humana por tenant                           | Aceito |
| [014](ADR-014-dinheiro.md)                                                 | Representação monetária                               | Aceito |
| [015](ADR-015-ownership-tenant-unidade.md)                                 | Ownership entre tenant e unidade                      | Aceito |
| [016](ADR-016-soft-delete-e-historico.md)                                  | Soft delete, arquivamento e histórico                 | Aceito |
| [017](ADR-017-datas-e-timezone.md)                                         | Datas, horários e fuso                                | Aceito |
| [018](ADR-018-constraints-cross-tenant.md)                                 | Constraints cross-tenant no banco                     | Aceito |
| [019](ADR-019-escopo-de-atribuicao-de-perfil.md)                           | Escopo de atribuição de perfil (TENANT × UNIT)        | Aceito |
| [020](ADR-020-vinculo-de-unidade-nao-e-autorizacao.md)                     | Vínculo de unidade não é autorização                  | Aceito |
| [021](ADR-021-politica-de-autorizacao.md)                                  | Política de autorização (deny by default)             | Aceito |
| [022](ADR-022-ciclo-de-vida-da-sessao.md)                                  | Ciclo de vida da sessão e revogação                   | Aceito |
| [023](ADR-023-conjunto-de-icones.md)                                       | Conjunto de ícones próprio                            | Aceito |
| [024](ADR-024-estrategia-de-tema.md)                                       | Estratégia de tema                                    | Aceito |
| [025](ADR-025-shell-responsivo.md)                                         | Shell responsivo                                      | Aceito |
| [026](ADR-026-cliente-pertence-ao-tenant.md)                               | Cliente pertence ao tenant                            | Aceito |
| [027](ADR-027-contatos-de-cliente.md)                                      | Contatos de cliente                                   | Aceito |
| [028](ADR-028-duplicidade-de-cliente.md)                                   | Duplicidade de cliente                                | Aceito |
| [029](ADR-029-equipamento-tenant-recebimento-unidade.md)                   | Equipamento no tenant, recebimento na unidade         | Aceito |
| [030](ADR-030-armazenamento-de-arquivos.md)                                | Armazenamento de arquivos fora de `public/`           | Aceito |
| [031](ADR-031-processamento-de-imagem-no-navegador.md)                     | Preparo de imagem no navegador                        | Aceito |
| [032](ADR-032-provider-de-leitura-de-etiqueta.md)                          | Provider de leitura de etiqueta                       | Aceito |
| [033](ADR-033-ordem-de-servico-pertence-a-unidade.md)                      | Ordem de Serviço pertence à unidade                   | Aceito |
| [034](ADR-034-numeracao-da-ordem-de-servico.md)                            | Numeração da OS sobre `tenant_sequences`              | Aceito |
| [035](ADR-035-cardinalidade-recebimento-ordem.md)                          | Um recebimento origina uma OS                         | Aceito |
| [036](ADR-036-fronteira-entidade-workflow.md)                              | Fronteira entre entidade e workflow                   | Aceito |
| [037](ADR-037-maquina-de-estados-centralizada.md)                          | Máquina de estados centralizada da OS                 | Aceito |
| [038](ADR-038-concorrencia-otimista.md)                                    | Concorrência otimista por versão                      | Aceito |
| [039](ADR-039-follow-up-como-data-civil.md)                                | Follow-up como data civil, pendência por consulta     | Aceito |
| [040](ADR-040-orcamento-pertence-a-ordem-de-servico.md)                    | Orçamento pertence à Ordem de Serviço                 | Aceito |
| [041](ADR-041-estrategia-de-revisao-de-orcamento.md)                       | Revisão de orçamento com mesmo número                 | Aceito |
| [042](ADR-042-fronteira-orcamento-workflow.md)                             | Orçamento move a OS pelo workflow, na mesma transação | Aceito |
| [043](ADR-043-ledger-e-saldo-materializado.md)                             | Ledger append-only com saldo materializado            | Aceito |
| [044](ADR-044-concorrencia-de-saldo.md)                                    | A condição de negócio vai no `WHERE` do `UPDATE`      | Aceito |
| [045](ADR-045-reserva-e-entidade-propria.md)                               | Reserva é entidade própria, não movimentação          | Aceito |
| [046](ADR-046-transferencia-imediata.md)                                   | Transferência entre unidades é imediata na V1         | Aceito |
| [047](ADR-047-snapshot-do-orcamento-e-catalogo.md)                         | Orçamento continua sendo snapshot comercial           | Aceito |
| [048](ADR-048-necessidade-e-pedido-sao-coisas-diferentes.md)               | Necessidade de compra ≠ pedido de compra              | Aceito |
| [049](ADR-049-recebimento-entra-no-estoque-pela-primitiva-do-inventory.md) | Recebimento entra pela primitiva do Inventory         | Aceito |
| [050](ADR-050-recebimento-parcial-e-o-caso-normal.md)                      | Recebimento parcial é o caso normal                   | Aceito |
| [051](ADR-051-custo-comercial-e-custo-de-estoque.md)                       | Frete e desconto ficam no pedido, não no custo        | Aceito |
| [052](ADR-052-fornecedor-pertence-ao-tenant.md)                            | Fornecedor é do tenant; pedido é da unidade           | Aceito |
