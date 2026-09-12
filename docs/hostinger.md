# Deploy na Hostinger — Nexo56 ERP

> **Aviso de veracidade.** Esta sessão **não teve acesso à conta Hostinger**.
> Nada aqui foi validado contra o hPanel. O documento separa claramente o que
> foi **verificado localmente**, o que vem da **documentação pública** e o que
> **ainda precisa ser confirmado** no painel.

## 1. O que foi verificado localmente

| Item            | Resultado                                             |
| --------------- | ----------------------------------------------------- |
| Node.js 22      | v22.22.2 — aplicação roda                             |
| MariaDB         | 10.11.14 — migrations aplicadas, 17 tabelas criadas   |
| `npm run build` | build de produção conclui                             |
| `npm start`     | servidor sobe e responde                              |
| Migrations      | aplicadas por comando explícito                       |
| Bootstrap       | cria empresa e administrador; idempotente             |
| Cron/jobs       | `npm run jobs:run` executa e registra log estruturado |
| Health check    | `/api/health` e `/api/health?check=ready`             |
| Login completo  | verificado em navegador (desktop e mobile)            |

## 2. O que vem da documentação pública da Hostinger

- O Business Web Hosting suporta **aplicação Node.js** com comando de start
  próprio e porta fornecida pela plataforma (`PORT`).
- Deploy por **Git/GitHub** a partir do hPanel.
- **Variáveis de ambiente** configuráveis no painel.
- **MariaDB** incluso, com criação de banco e usuário pelo hPanel.
- **Cron jobs** configuráveis, normalmente no fuso **UTC**.

## 3. O que PRECISA ser confirmado no hPanel

| #   | A confirmar                                                       | Por que importa                                   |
| --- | ----------------------------------------------------------------- | ------------------------------------------------- |
| 1   | Versão exata de Node disponível (22.x?)                           | `engines` exige `>=22 <23`                        |
| 2   | Comando de start aceito e como a porta é passada                  | `next start` precisa ler `PORT`                   |
| 3   | Se o build roda no servidor ou se é preciso enviar `.next` pronto | Turbopack e `next/font` precisam de rede no build |
| 4   | **Limite de conexões simultâneas** do usuário MariaDB             | define `DB_POOL_SIZE` (hoje 5)                    |
| 5   | Versão do MariaDB do plano                                        | o projeto foi validado em 10.11                   |
| 6   | Granularidade mínima do cron                                      | `RECURRING_JOBS` assume disparo ~1/min            |
| 7   | Caminho absoluto do binário Node para o cron                      | a linha de cron precisa do caminho completo       |
| 8   | Limite de memória/processo                                        | scrypt usa ~64 MB por verificação de senha        |
| 9   | Se há reverse proxy terminando TLS                                | `APP_URL` deve ser a URL pública https            |
| 10  | Persistência de disco entre deploys                               | logs e artefatos                                  |

**O item 4 é o mais relevante:** hospedagem compartilhada costuma limitar
conexões por usuário de banco. Se o limite for menor que 5, reduza
`DB_POOL_SIZE`.

**O item 8 merece atenção:** os parâmetros de scrypt foram escolhidos pela
segurança (OWASP). Se o plano tiver memória apertada e o login ficar lento ou
falhar, reduza `N` para `2^15` em `src/modules/auth/domain/password.ts` —
`needsRehash()` cuida da migração dos hashes existentes. **Não troque o
algoritmo sem registrar um ADR.**

## 4. Configuração prevista de deploy

### Variáveis de ambiente (hPanel)

```
APP_URL=https://SEU-DOMINIO
DATABASE_URL=mysql://USUARIO:SENHA@localhost:3306/BANCO
SESSION_SECRET=<openssl rand -base64 48>
JOB_SECRET=<openssl rand -base64 48>
SESSION_TTL_HOURS=12
LOG_LEVEL=info
DB_POOL_SIZE=5
```

Não defina `NODE_ENV` — o Next cuida disso.
Nunca defina `ALLOW_SEED` nem `ALLOW_INSECURE_APP_URL` em produção.

A aplicação **se recusa a subir** em produção com segredo de exemplo ou com
`APP_URL` em http.

### Sequência de deploy

```bash
npm ci                 # instala exatamente o lockfile
npm run build          # build de produção
npm run db:migrate     # migrations — passo EXPLÍCITO, nunca no boot
npm start              # next start
```

Migrations nunca rodam automaticamente no boot: duas instâncias subindo juntas
migrariam em paralelo.

### Banco

1. Criar banco e usuário no hPanel.
2. Charset `utf8mb4`, collation `utf8mb4_unicode_ci`.
3. Conceder ao usuário apenas o necessário (SELECT, INSERT, UPDATE, DELETE,
   CREATE, ALTER, INDEX, REFERENCES) — migrations precisam de DDL.
4. Preencher `DATABASE_URL`.
5. Rodar `npm run db:migrate`.
6. Rodar o bootstrap (seção 5).

### Cron

Uma única entrada:

```
* * * * * cd ~/domains/SEU-DOMINIO/app && /caminho/para/node --conditions=react-server --import tsx scripts/run-jobs.ts >> ~/logs/nexo56-jobs.log 2>&1
```

ou, mais simples:

```
* * * * * cd ~/domains/SEU-DOMINIO/app && /caminho/para/npm run jobs:run >> ~/logs/nexo56-jobs.log 2>&1
```

Características:

- **Fuso:** o agendador opera em UTC. Não há problema: os jobs da fundação são
  periódicos, não em horário do dia. Job futuro que dependa de horário local
  deve converter pelo timezone do tenant, nunca pelo do servidor.
- **Segurança:** não há rota HTTP de jobs. Sem rota, sem superfície a proteger.
- **Idempotência:** chave derivada da janela de tempo; disparo repetido na mesma
  janela não duplica execução.
- **Execução simultânea:** reivindicação por UPDATE condicional; dois processos,
  apenas um pega o job.
- **Falha:** backoff exponencial até `maxAttempts`, depois `failed` com o erro
  registrado. A rodada sai com código 1 se algum job falhou.

## 5. Bootstrap em produção

```bash
BOOTSTRAP_TENANT_NAME="Nome da Empresa" \
BOOTSTRAP_TENANT_SLUG="nome-da-empresa" \
BOOTSTRAP_ADMIN_NAME="Nome do Administrador" \
BOOTSTRAP_ADMIN_EMAIL="admin@empresa.com.br" \
npm run bootstrap
```

Sem `BOOTSTRAP_ADMIN_PASSWORD`, uma senha aleatória é gerada e exibida **uma
única vez** no terminal. Ela não vai para log, auditoria nem repositório.
Guarde em gerenciador de senhas e troque no primeiro acesso.

O comando é idempotente: se a empresa já existe, nada é recriado nem
sobrescrito.

## 6. Monitoramento

| Verificação                  | Endpoint                              |
| ---------------------------- | ------------------------------------- |
| Aplicação viva               | `GET /api/health` → `{"status":"ok"}` |
| Aplicação pronta (com banco) | `GET /api/health?check=ready`         |

Nenhum dos dois expõe versão, host, credencial ou detalhe interno.

Logs saem em **JSON por linha**, com `correlationId`, `tenantId`, `userId`,
módulo, operação e duração — prontos para um coletor futuro.

## 7. Migração futura

Nada aqui cria dependência permanente da Hostinger:

| Hoje                  | Depois                                                |
| --------------------- | ----------------------------------------------------- |
| cron + CLI            | worker persistente ou fila (Redis/serviço gerenciado) |
| rate limit em memória | store Redis (a interface já existe)                   |
| MariaDB do plano      | banco gerenciado                                      |
| disco local           | storage externo/CDN                                   |
| um processo           | várias instâncias atrás de proxy                      |

As trocas acontecem na infraestrutura, não na regra de negócio.
