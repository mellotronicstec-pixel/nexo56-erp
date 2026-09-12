# Arquitetura do Nexo56 — visão geral

Documentação da fundação técnica entregue no **Prompt 01**.
Decisões e alternativas ficam nos [ADRs](../adr/README.md).

## Índice

- [Módulos e dependências](modules.md)
- [Multi-tenancy e isolamento](multi-tenancy.md)
- [Autenticação, RBAC e Effective Access](auth.md)
- [Eventos, jobs e auditoria](events-jobs-audit.md)
- [Segurança](security.md)
- [Design System e identidade](design-system.md)
- [Deploy](../hostinger.md)

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
3. O guard (`requireAccess` / `requireAccessForPage`) consulta o
   **Effective Access**: a feature existe? o plano permite? o tenant ativou?
   as dependências estão satisfeitas? o usuário tem permissão?
4. O serviço executa a operação com consultas **escopadas por tenant**.
5. Escrita relevante roda em transação com **auditoria** e **evento**; o evento
   só é despachado após o commit.
6. O log estruturado sai em JSON com correlation ID, tenant e usuário.

## Princípios que o código aplica

| Princípio                         | Onde está                                   |
| --------------------------------- | ------------------------------------------- |
| O backend é a autoridade final    | `guard.ts`, revalidação em cada página/ação |
| Tenant nunca vem do cliente       | `current-context.ts`, `tenant-scoped.ts`    |
| Desativar não apaga dados         | `tenant-configuration.ts`                   |
| Evento só depois do commit        | `unit-of-work.ts`                           |
| Domínio não conhece cron          | `job-queue.ts` / `job-executor.ts`          |
| Segredo nunca em log ou auditoria | `logger.ts` (`redact`), `audit-service.ts`  |
| Core não depende de IA            | nenhuma dependência de IA no projeto        |
