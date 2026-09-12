# ADR-012 — Deploy na Hostinger

**Status:** Aceito · **Data:** Prompt 01

## Contexto

Decisão do proprietário (D2): Hostinger Business Web Hosting/Unlimited, app
Node.js, deploy via Git/GitHub, MariaDB do plano, cron para tarefas agendadas,
sem exigir VPS na primeira versão.

> **Importante:** esta sessão **não teve acesso à conta Hostinger**. O que
> segue é a configuração prevista a partir da documentação pública e do que foi
> efetivamente verificado localmente. Os parâmetros a confirmar no hPanel estão
> listados em `docs/hostinger.md`.

## Decisão

- **Build**: `npm ci && npm run build` (saída `.next/`).
- **Start**: `npm start` (`next start`), porta vinda de `PORT`.
- **Node**: 22 LTS, fixado em `engines` e `.nvmrc`.
- **Banco**: MariaDB do plano; conexão por `DATABASE_URL`, `timezone: 'Z'`
  (UTC), pool pequeno (`DB_POOL_SIZE`, padrão 5) por causa do limite de
  conexões simultâneas da hospedagem compartilhada.
- **Migrations**: passo explícito no deploy (`npm run db:migrate`). Nunca
  automático no boot da aplicação — duas instâncias subindo juntas migrariam
  em paralelo.
- **Cron**: uma entrada no hPanel chamando `npm run jobs:run`. O agendador da
  Hostinger normalmente opera em **UTC**; o fuso do tenant é aplicado na
  apresentação, não na execução.
- **Segredos**: variáveis de ambiente do hPanel. `.env` nunca versionado.
- **Validação de ambiente** no startup: produção não sobe com segredo de
  exemplo nem com `APP_URL` http (há opt-in explícito
  `ALLOW_INSECURE_APP_URL` para verificação local/staging).

## Alternativas consideradas

| Alternativa                  | Por que não                                                                                    |
| ---------------------------- | ---------------------------------------------------------------------------------------------- |
| Export estático              | Impossível: a aplicação é server-side (sessão, banco, RBAC).                                   |
| Migration automática no boot | Corrida entre instâncias e risco de aplicar schema sem intenção.                               |
| Docker                       | Não suportado no plano compartilhado; usado só localmente, se necessário, para banco de teste. |

## Consequências

- O rate limit em memória conta por processo (ver `docs/architecture/security.md`).
- Reinício da aplicação zera contadores em memória; sessões e jobs sobrevivem
  porque estão no banco.
- Migrar para VPS/Cloud depois não exige mudar a aplicação — apenas o pipeline.
