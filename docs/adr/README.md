# Architecture Decision Records — Nexo56

Registro das decisões arquiteturais do Nexo56 (Prompt 00, item 109).
Cada ADR informa **contexto**, **decisão**, **motivo**, **alternativas** e
**consequências**.

Os ADRs 001–012 vêm do Prompt 01 (fundação técnica); 013–018 do Prompt 02
(camada de dados).

Um ADR não é reescrito quando a decisão muda: cria-se um novo ADR que o
substitui, e o antigo passa a `Substituído por ADR-XXX`.

| ADR                                        | Assunto                                          | Status |
| ------------------------------------------ | ------------------------------------------------ | ------ |
| [001](ADR-001-stack-principal.md)          | Stack principal                                  | Aceito |
| [002](ADR-002-monolito-modular.md)         | Monólito modular                                 | Aceito |
| [003](ADR-003-mariadb-e-orm.md)            | MariaDB/MySQL e ORM                              | Aceito |
| [004](ADR-004-multi-tenancy.md)            | Estratégia multi-tenant compartilhada            | Aceito |
| [005](ADR-005-isolamento-tenant-aware.md)  | Isolamento tenant-aware                          | Aceito |
| [006](ADR-006-autenticacao-e-sessoes.md)   | Autenticação e sessões                           | Aceito |
| [007](ADR-007-rbac.md)                     | RBAC                                             | Aceito |
| [008](ADR-008-effective-access.md)         | Feature Catalog, Entitlements e Effective Access | Aceito |
| [009](ADR-009-eventos-internos.md)         | Eventos internos                                 | Aceito |
| [010](ADR-010-background-jobs.md)          | Background jobs e evolução cron → queue          | Aceito |
| [011](ADR-011-design-system.md)            | Design System e identidade                       | Aceito |
| [012](ADR-012-deploy-hostinger.md)         | Deploy Hostinger                                 | Aceito |
| [013](ADR-013-numeracao-humana.md)         | Numeração humana por tenant                      | Aceito |
| [014](ADR-014-dinheiro.md)                 | Representação monetária                          | Aceito |
| [015](ADR-015-ownership-tenant-unidade.md) | Ownership entre tenant e unidade                 | Aceito |
| [016](ADR-016-soft-delete-e-historico.md)  | Soft delete, arquivamento e histórico            | Aceito |
| [017](ADR-017-datas-e-timezone.md)         | Datas, horários e fuso                           | Aceito |
| [018](ADR-018-constraints-cross-tenant.md) | Constraints cross-tenant no banco                | Aceito |
