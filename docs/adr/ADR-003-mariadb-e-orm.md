# ADR-003 — MariaDB/MySQL e ORM

**Status:** Aceito · **Data:** Prompt 01

## Contexto

A decisão do proprietário (D2) fixa MariaDB/MySQL da Hostinger. O ORM precisa
de migrations versionadas, transações, constraints, índices e tipagem
TypeScript, e precisa rodar em hospedagem compartilhada.

## Decisão

- Banco: **MariaDB 10.11** (InnoDB, `utf8mb4_unicode_ci`)
- ORM: **Drizzle ORM 0.45** + driver **mysql2**
- Migrations: **drizzle-kit** gerando SQL versionado em `drizzle/`

## Motivo

O fator decisivo foi a **ausência de binário nativo**:

- O Prisma depende de um _query engine_ em Rust distribuído como binário por
  plataforma (glibc/openssl). Em hospedagem compartilhada não há controle sobre
  esse ambiente, e uma incompatibilidade de binário derruba **toda** a
  aplicação, não apenas uma função.
- Drizzle é TypeScript puro sobre `mysql2` (JavaScript puro). O que roda no
  servidor é o mesmo código que roda em desenvolvimento.
- Drizzle gera **SQL versionado legível**, revisável em code review, aplicado
  por um comando explícito — sem `db push` em produção.
- A tipagem sai do próprio schema, sem etapa de geração de cliente no deploy.

## Alternativas consideradas

| Alternativa         | Por que não                                                                                                                                                                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prisma              | Aceito pelo prompt "caso a compatibilidade seja confirmada" — não é possível confirmar sem acesso ao ambiente real da Hostinger, e o modo de falha é total. Além disso `prisma generate` acrescenta uma etapa de build frágil no deploy. |
| PostgreSQL          | Vedado nesta etapa pela decisão do proprietário.                                                                                                                                                                                         |
| SQL puro            | Sem tipagem nem migrations versionadas; retrabalho garantido.                                                                                                                                                                            |
| TypeORM / Sequelize | Menos aderência a TypeScript moderno; migrations mais frágeis.                                                                                                                                                                           |

## Consequências

- Perdemos o Prisma Studio e o `include` aninhado; em troca, ganhamos SQL
  explícito e previsível.
- Alguns recursos (por exemplo `RETURNING`) não existem no MySQL — o código já
  assume isso.
- Migrar para PostgreSQL no futuro exigiria adaptar o dialeto; o schema está
  isolado em `infrastructure/`, o que limita o impacto.
