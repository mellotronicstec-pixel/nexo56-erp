# Nexo56 ERP

Plataforma ERP/SaaS multiempresa para gestão de assistência técnica e reparo.

**Estado atual: fundação técnica (Prompt 01).** Autenticação, multi-tenancy,
RBAC, modularidade, auditoria, eventos, jobs e Design System base estão
implementados e testados. **Os módulos de negócio ainda não existem** — Clientes,
Equipamentos, Ordens de Serviço, Orçamentos, Estoque, Compras, Financeiro,
Garantias e demais serão construídos nos prompts seguintes.

---

## Sumário

1. [Requisitos](#1-requisitos)
2. [Instalação](#2-instalação)
3. [Variáveis de ambiente](#3-variáveis-de-ambiente)
4. [Banco de dados e migrations](#4-banco-de-dados-e-migrations)
5. [Bootstrap do primeiro administrador](#5-bootstrap-do-primeiro-administrador)
6. [Seed de desenvolvimento](#6-seed-de-desenvolvimento)
7. [Desenvolvimento](#7-desenvolvimento)
8. [Testes, lint e typecheck](#8-testes-lint-e-typecheck)
9. [Build e produção](#9-build-e-produção)
10. [Jobs em background](#10-jobs-em-background)
11. [Arquitetura](#11-arquitetura)
12. [Segurança](#12-segurança)
13. [Identidade visual](#13-identidade-visual)
14. [Dívida técnica conhecida](#14-dívida-técnica-conhecida)

---

## 1. Requisitos

| Requisito        | Versão                                |
| ---------------- | ------------------------------------- |
| Node.js          | 22 LTS (`>=22 <23`)                   |
| MariaDB ou MySQL | MariaDB 10.11+ (validado em 10.11.14) |
| npm              | 10+                                   |

A versão do Node está fixada em `engines` e `.nvmrc` — não dependa da versão
que estiver instalada por acaso.

---

## 2. Instalação

```bash
git clone <url-do-repositorio> nexo56-erp
cd nexo56-erp
npm ci
cp .env.example .env.local   # preencha os valores
```

---

## 3. Variáveis de ambiente

Copie `.env.example` para `.env.local` (desenvolvimento) e preencha.
**Nunca versione o `.env` real.**

| Variável                 | Obrigatória | Descrição                                                                                          |
| ------------------------ | ----------- | -------------------------------------------------------------------------------------------------- |
| `APP_URL`                | sim         | URL pública da aplicação. Em produção precisa ser `https://`                                       |
| `DATABASE_URL`           | sim         | `mysql://usuario:senha@host:porta/banco`                                                           |
| `TEST_DATABASE_URL`      | para testes | Banco **dedicado** a testes; os testes truncam tabelas                                             |
| `SESSION_SECRET`         | sim         | Mínimo 32 caracteres. `openssl rand -base64 48`                                                    |
| `JOB_SECRET`             | sim         | Mínimo 32 caracteres. `openssl rand -base64 48`                                                    |
| `SESSION_TTL_HOURS`      | não         | Duração da sessão. Padrão 12                                                                       |
| `LOG_LEVEL`              | não         | `debug` \| `info` \| `warn` \| `error`. Padrão `info`                                              |
| `DB_POOL_SIZE`           | não         | Conexões do pool. Padrão 5                                                                         |
| `ALLOW_SEED`             | não         | `true` libera o seed. **Nunca em produção**                                                        |
| `ALLOW_INSECURE_APP_URL` | não         | Permite `APP_URL` http em build de produção, para verificação local/staging. **Nunca em produção** |

Não defina `NODE_ENV`: o Next cuida disso, e um valor fixo no `.env` quebra o
build.

As variáveis são **validadas no startup**. Faltando uma crítica, ou com segredo
de exemplo em produção, a aplicação falha com mensagem explícita em vez de
subir silenciosamente insegura.

---

## 4. Banco de dados e migrations

Crie o banco com charset `utf8mb4` e collation `utf8mb4_unicode_ci`:

```sql
CREATE DATABASE nexo56 CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

Aplique as migrations:

```bash
npm run db:migrate
```

Para gerar uma nova migration depois de alterar o schema:

```bash
npm run db:generate      # gera o SQL em drizzle/
npm run db:migrate       # aplica
```

**Regras** (Prompt 01, itens 47 e 95):

- Toda alteração estrutural tem migration versionada.
- `db push` **não** é usado como substituto de migration.
- Nunca "apagar o banco e começar de novo" para resolver migration.
- As migrations são um passo **explícito** do deploy, nunca automáticas no boot.

### Tabelas

18 no total: `tenants`, `units`, `tenant_sequences`, `users`, `user_units`,
`sessions`, `roles`, `permissions`, `role_permissions`, `user_roles`,
`features`, `feature_dependencies`, `plans`, `plan_entitlements`,
`tenant_features`, `audit_logs`, `domain_events`, `jobs`.

### Documentação do modelo

| Documento                                                   | Conteúdo                                                                        |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------- |
| [Convenções](docs/database/conventions.md)                  | Nomenclatura, IDs, tempo, dinheiro, nulos, soft delete, FKs, índices, paginação |
| [Schema físico](docs/database/schema.md)                    | Cada tabela: finalidade, ownership, PK, FKs, índices, política de delete        |
| [Data Dictionary](docs/database/data-dictionary.md)         | Significado, tipo e obrigatoriedade das colunas                                 |
| [Matriz de ownership](docs/database/ownership-matrix.md)    | Escopo de cada entidade, existente e futura                                     |
| [Sensibilidade de dados](docs/database/data-sensitivity.md) | Classificação PII, financeiro, credencial                                       |
| [ERD](docs/database/erd.md)                                 | Diagrama Mermaid — schema atual e modelo conceitual futuro                      |
| [Governança e LGPD](docs/database/lgpd.md)                  | Finalidade, minimização, retenção, direitos do titular                          |

---

## 5. Bootstrap do primeiro administrador

```bash
BOOTSTRAP_TENANT_NAME="Minha Assistência" \
BOOTSTRAP_TENANT_SLUG="minha-assistencia" \
BOOTSTRAP_ADMIN_NAME="Nome do Administrador" \
BOOTSTRAP_ADMIN_EMAIL="admin@empresa.com.br" \
npm run bootstrap
```

Opcionais: `BOOTSTRAP_ADMIN_PASSWORD` (mínimo 12 caracteres),
`BOOTSTRAP_TENANT_TIMEZONE` (padrão `America/Sao_Paulo`), `BOOTSTRAP_UNIT_NAME`.

**Não existe credencial fixa.** Sem `BOOTSTRAP_ADMIN_PASSWORD`, uma senha
aleatória é gerada e exibida **uma única vez** no terminal — ela não vai para
log, auditoria nem repositório.

O comando é **idempotente**: se a empresa já existe, nada é recriado nem
sobrescrito.

O que ele faz: sincroniza o catálogo de funcionalidades e permissões, cria o
plano interno, a empresa, a unidade principal, o perfil `admin` com todas as
permissões estruturais e o usuário administrador — tudo com auditoria e eventos.

---

## 6. Seed de desenvolvimento

```bash
ALLOW_SEED=true npm run db:seed
```

Cria uma empresa **claramente fictícia** (`exemplo-dev`,
`admin.dev@exemplo.invalid`) com senha aleatória exibida uma vez.

Proteções: recusa `NODE_ENV=production`, exige `ALLOW_SEED=true`, não apaga nem
reseta banco, não cria senha conhecida.

---

## 7. Desenvolvimento

```bash
npm run dev          # http://localhost:3000
```

Outros comandos:

```bash
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run format       # prettier --write
npm run format:check # prettier --check
```

---

## 8. Testes, lint e typecheck

```bash
npm test             # vitest run
npm run test:watch
```

### Banco de teste

Os testes usam **exclusivamente** `TEST_DATABASE_URL` e **se recusam a rodar**
se ela for igual a `DATABASE_URL` ou se `NODE_ENV=production` — o banco de
produção nunca pode ser alcançado por um teste que trunca tabelas.

```sql
CREATE DATABASE nexo56_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

**Privilégio adicional:** o teste de upgrade de migration cria e descarta
bancos temporários com prefixo `nexo56_`. Conceda ao usuário de teste:

```sql
GRANT ALL PRIVILEGES ON `nexo56\_%`.* TO 'seu_usuario'@'localhost';
```

No CI isso já é atendido porque a suíte roda como `root` no serviço MariaDB.

A limpeza entre testes **preserva o schema** (`DELETE`, nunca `DROP DATABASE`).
Se preferir subir o MariaDB de teste em container, isso é uma escolha **local**:
produção não depende de Docker.

### Cobertura da fundação

| Área             | O que é testado                                                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Senha            | não armazena texto puro, salt por senha, verificação, hash malformado, rehash, equalização de tempo                                         |
| Login            | válido, senha errada, e-mail inexistente com a mesma mensagem, usuário inativo, entrada malformada, rate limit, e-mail em duas empresas     |
| Sessão           | token inexistente, revogação, expiração, só o hash no banco, conta desativada, limpeza idempotente                                          |
| Multi-tenancy    | os 4 cenários obrigatórios do item 22                                                                                                       |
| Effective Access | feature inexistente, bloqueada por plano, desativada pelo tenant, sem permissão, permitida, CORE não desativável, reativação preserva dados |
| Auditoria        | ação gera registro, falha também, nenhum segredo no registro, redação de campos sensíveis, antes/depois                                     |
| Eventos          | despacho após commit, rollback não emite nem chama handler, falha de handler não derruba a operação                                         |
| Jobs             | idempotência pelo UNIQUE, concorrência, handler desconhecido, backoff, recuperação de job travado                                           |

---

## 9. Build e produção

```bash
npm run build        # build de produção
npm start            # next start
```

Deploy na Hostinger: **[docs/hostinger.md](docs/hostinger.md)**.

### Health check

```
GET /api/health                 → {"status":"ok"}
GET /api/health?check=ready     → inclui o banco
```

Nenhum dos dois expõe versão, host, credencial ou detalhe interno.

---

## 10. Jobs em background

```bash
npm run jobs:run
```

O domínio **não conhece cron**: a regra de negócio enfileira um job; quem o
executa é substituível (cron hoje, worker ou fila depois) sem reescrever nada.

Detalhes, cron do hPanel e idempotência:
[docs/architecture/events-jobs-audit.md](docs/architecture/events-jobs-audit.md).

---

## 11. Arquitetura

Monólito modular, organizado por domínio:

```
src/
  app/            páginas, Server Actions, shell
  design-system/  componentes e tokens
  modules/<m>/    domain · application · infrastructure
  core/           config, db, errors, logging, ids, context, rate-limit
scripts/          migrate, bootstrap, seed, run-jobs
drizzle/          migrations versionadas
docs/             arquitetura, ADRs, Hostinger
```

- **Visão geral:** [docs/architecture/README.md](docs/architecture/README.md)
- **Decisões (ADRs):** [docs/adr/README.md](docs/adr/README.md)

---

## 12. Segurança

Resumo e **limitações conhecidas**:
[docs/architecture/security.md](docs/architecture/security.md).

Pontos centrais:

- Senha com scrypt (`N=2^16, r=8, p=2`), sem dependência nativa.
- Sessão server-side com token opaco; o banco guarda só o SHA-256.
- Isolamento de tenant garantido no backend, com testes de travessia.
- Autorização revalidada no servidor em toda página e ação.
- Segredos nunca em log nem em auditoria.
- O frontend **nunca** é barreira de segurança.

---

## 13. Identidade visual

Sora (600/700) em títulos; Inter (400/500/600) em interface. Paleta
institucional `#0066FF`, `#101828`, `#FFFFFF`, `#F2F4F7`, centralizada em
tokens.

**Os ativos oficiais de logo e ícones ainda não foram fornecidos.** A logo não
é reconstruída com fonte; enquanto isso a aplicação exibe um marcador neutro.
Instruções: [public/brand/README.md](public/brand/README.md).

---

## 14. Dívida técnica conhecida

| Item                                      | Detalhe                                                                                                               | Caminho                                 |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| ESLint na linha 9.x                       | O `eslint-plugin-react` do `eslint-config-next@16` ainda não roda em ESLint 10                                        | atualizar quando o preset suportar      |
| 4 vulnerabilidades moderadas de dev       | Cadeia `drizzle-kit → @esbuild-kit → esbuild`; afetam apenas o servidor de desenvolvimento, não o runtime de produção | aguardar atualização do drizzle-kit     |
| CSP com `'unsafe-inline'` em `script-src` | O runtime do Next injeta scripts inline sem nonce em `next start`                                                     | CSP por nonce via middleware            |
| Rate limit por processo                   | Store em memória; conta por instância                                                                                 | implementar `RateLimitStore` com Redis  |
| Sem worker de outbox                      | Eventos são despachados em processo; a tabela já tem formato de outbox                                                | worker lendo `published_at IS NULL`     |
| Build depende de rede para as fontes      | `next/font/google` baixa Sora e Inter no build                                                                        | versionar WOFF2 se houver build offline |
| Sem escopo de permissão por unidade       | A permissão vale no tenant; `user_units` já delimita as unidades                                                      | evoluir o RBAC quando um módulo exigir  |
