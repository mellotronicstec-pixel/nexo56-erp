# Architecture Decision Records — Nexo56

Registro das decisões arquiteturais do Nexo56 (Prompt 00, item 109).
Cada ADR informa **contexto**, **decisão**, **motivo**, **alternativas** e
**consequências**.

Um ADR não é reescrito quando a decisão muda: cria-se um novo ADR que o
substitui, e o antigo passa a `Substituído por ADR-XXX`.

| ADR                                       | Assunto                                          | Status |
| ----------------------------------------- | ------------------------------------------------ | ------ |
| [001](ADR-001-stack-principal.md)         | Stack principal                                  | Aceito |
| [002](ADR-002-monolito-modular.md)        | Monólito modular                                 | Aceito |
| [003](ADR-003-mariadb-e-orm.md)           | MariaDB/MySQL e ORM                              | Aceito |
| [004](ADR-004-multi-tenancy.md)           | Estratégia multi-tenant compartilhada            | Aceito |
| [005](ADR-005-isolamento-tenant-aware.md) | Isolamento tenant-aware                          | Aceito |
| [006](ADR-006-autenticacao-e-sessoes.md)  | Autenticação e sessões                           | Aceito |
| [007](ADR-007-rbac.md)                    | RBAC                                             | Aceito |
| [008](ADR-008-effective-access.md)        | Feature Catalog, Entitlements e Effective Access | Aceito |
| [009](ADR-009-eventos-internos.md)        | Eventos internos                                 | Aceito |
| [010](ADR-010-background-jobs.md)         | Background jobs e evolução cron → queue          | Aceito |
| [011](ADR-011-design-system.md)           | Design System e identidade                       | Aceito |
| [012](ADR-012-deploy-hostinger.md)        | Deploy Hostinger                                 | Aceito |
