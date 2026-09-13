# Arquitetura do Nexo56 — visão geral

Documentação da fundação técnica (**Prompt 01**), da camada de dados
(**Prompt 02**), do controle de acesso (**Prompt 03**), do Design System
(**Prompt 04**) e dos módulos de negócio (**Prompt 05** em diante).
Decisões e alternativas ficam nos [ADRs](../adr/README.md).

## Índice

- [Módulos e dependências](modules.md)
- [Multi-tenancy e isolamento](multi-tenancy.md)
- [Autenticação e sessões](auth.md)
- [Eventos, jobs e auditoria](events-jobs-audit.md)
- [Segurança](security.md)
- [Design System e identidade](design-system.md)
- [Deploy](../hostinger.md)

### Módulos de negócio

- [Clientes](../modules/customers/overview.md) — modelo, busca, permissões
- [Equipamentos e Recebimento](../modules/equipment/overview.md) — modelo, mídia, leitura de etiqueta, permissões
- [Ordens de Serviço](../modules/service-orders/overview.md) — ownership, numeração, abertura, ficha, histórico

### Design System e interface (Prompt 04)

- [Visão geral](../design-system/overview.md)
- [Tokens](../design-system/tokens.md)
- [Tipografia](../design-system/typography.md)
- [Cores](../design-system/colors.md)
- [Componentes](../design-system/components.md)
- [Padrões de tela](../design-system/patterns.md)
- [Responsividade](../design-system/responsive.md)
- [Acessibilidade](../design-system/accessibility.md)
- [Navegação e shell](../design-system/navigation.md)

### Controle de acesso (Prompt 03)

- [Papéis, permissões e escopo por unidade](access-control.md)
- [Matriz de acesso](access-matrix.md)

### Camada de dados (Prompt 02)

- [Convenções de modelagem](../database/conventions.md)
- [Schema físico](../database/schema.md)
- [Data Dictionary](../database/data-dictionary.md)
- [Matriz de ownership](../database/ownership-matrix.md)
- [Sensibilidade de dados](../database/data-sensitivity.md)
- [ERD](../database/erd.md)
- [Governança e LGPD](../database/lgpd.md)

## Forma geral

Monólito modular em Next.js, um processo Node, um banco MariaDB.

```
Navegador
   │
   ▼
Next.js (Server Components · Server Actions · Route Handlers)
   │
   ├── src/app/            apresentação (páginas, ações, shell)
   ├── src/design-system/  componentes e tokens
   │
   ├── src/modules/<m>/    domínio de negócio
   │      domain/          regras e tipos puros, sem I/O
   │      application/     casos de uso e serviços
   │      infrastructure/  schema e acesso a dados
   │
   └── src/core/           infraestrutura compartilhada
          config/ db/ errors/ logging/ ids/ context/ rate-limit/
   │
   ▼
MariaDB (InnoDB, utf8mb4)
```

Fora do processo web:

```
cron do hPanel → npm run jobs:run → JobExecutor → handlers
```

## Fluxo de uma requisição autenticada

1. `runWithContext` abre o contexto de execução e gera o **correlation ID**.
2. `getCurrentContext()` lê o cookie, valida a sessão **no banco** e monta o
   `TenantContext` (tenant, usuário, unidades autorizadas, papéis, permissões).
3. O **AuthorizationService** decide, com negação por padrão: a unidade está
   autorizada? a permissão vale **naquele escopo**? o recurso alvo pertence ao
   contexto? E o **Effective Access**: a feature existe, o plano permite, o
   tenant ativou, as dependências estão satisfeitas?
4. O serviço executa a operação com consultas **escopadas por tenant**.
5. Escrita relevante roda em transação com **auditoria** e **evento**; o evento
   só é despachado após o commit.
6. O log estruturado sai em JSON com correlation ID, tenant e usuário.

## Princípios que o código aplica

| Princípio                          | Onde está                                                   |
| ---------------------------------- | ----------------------------------------------------------- |
| O backend é a autoridade final     | `authorization-service.ts`, revalidação em cada página/ação |
| Nenhum superusuário embutido       | `permissions.ts` — Administrador é papel com permissões     |
| Vínculo de unidade não é permissão | `user_units` × `user_roles`/`user_unit_roles`               |
| Tenant nunca vem do cliente        | `current-context.ts`, `tenant-scoped.ts`                    |
| Desativar não apaga dados          | `tenant-configuration.ts`                                   |
| Evento só depois do commit         | `unit-of-work.ts`                                           |
| Domínio não conhece cron           | `job-queue.ts` / `job-executor.ts`                          |
| Segredo nunca em log ou auditoria  | `logger.ts` (`redact`), `audit-service.ts`                  |
| Core não depende de IA             | nenhuma dependência de IA no projeto                        |
