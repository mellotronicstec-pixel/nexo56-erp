# Segurança

## Implementado e verificado

| Proteção                   | Como                                                                                            | Verificação                    |
| -------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------ |
| Hash de senha              | scrypt `N=2^16, r=8, p=2`, salt por senha                                                       | teste unitário                 |
| Senha em texto puro        | nunca armazenada nem logada                                                                     | teste unitário                 |
| Token de sessão            | só o SHA-256 vai ao banco                                                                       | teste de integração            |
| Revogação de sessão        | imediata, por `revoked_at`                                                                      | teste de integração            |
| Conta/empresa desativada   | invalida o contexto mesmo com sessão válida                                                     | teste de integração            |
| Enumeração de usuário      | mensagem única + verificação de senha simulada                                                  | teste de integração            |
| Força bruta no login       | rate limit 5/5min por e-mail, antes do banco                                                    | teste de integração            |
| Isolamento entre tenants   | escopo obrigatório + testes de travessia                                                        | suíte dedicada                 |
| Autorização                | Effective Access revalidado no servidor                                                         | teste + navegador              |
| Validação de entrada       | zod em toda entrada não confiável                                                               | teste de integração            |
| CSRF                       | proteção nativa de Server Actions + checagem de `Origin`                                        | código                         |
| Cookies                    | `HttpOnly`, `SameSite=Lax`, `Secure` em produção                                                | verificado em navegador        |
| Cabeçalhos HTTP            | CSP, `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy`, COOP | verificado por `curl -I`       |
| `X-Powered-By`             | desligado (`poweredByHeader: false`)                                                            | verificado                     |
| Stack trace ao usuário     | nunca; `IntegrationError`/`InternalError` têm `expose: false`                                   | código                         |
| Segredo em log/auditoria   | `redact()` em ambos                                                                             | teste unitário e de integração |
| Segredo de dev em produção | startup falha                                                                                   | verificado                     |
| Injeção de SQL             | consultas parametrizadas pelo Drizzle                                                           | —                              |

## Implementado e verificado — controle de acesso (Prompt 03)

| Proteção                          | Como                                                             | Verificação                  |
| --------------------------------- | ---------------------------------------------------------------- | ---------------------------- |
| Negação por padrão                | pipeline único em `authorization-service.ts`                     | suíte dedicada               |
| Sem superusuário embutido         | Administrador é papel com permissões, não exceção no código      | teste de integração          |
| Autoescalonamento                 | `assertNotSelfEscalation()` — ninguém amplia o próprio acesso    | teste de integração          |
| Delegação além do próprio         | `assertCanGrantPermissions()` — não concede o que não tem        | teste de integração          |
| Empresa sem administrador         | `assertTenantKeepsAdmin()`, com serialização por linha do tenant | teste, inclusive concorrente |
| IDOR entre tenants                | recurso fora do contexto responde "não encontrado"               | teste + navegador            |
| Papel por unidade sem vínculo     | FK composta `(user_id, unit_id) → user_units`                    | teste de integração          |
| Papel de unidade em outra unidade | permissões resolvidas por escopo, nunca somadas globalmente      | teste de integração          |
| Unidade forjada no formulário     | ignorada se não estiver em `authorizedUnitIds`                   | teste + navegador            |
| Política de senha                 | mínimo 10, máximo 512 sem truncar, lista de senhas óbvias        | teste de integração          |
| Token de redefinição              | só o SHA-256 no banco, uso único, 60 min                         | teste de integração          |
| Revogação de sessão               | imediata em todos os gatilhos (senha, reset, desativação, admin) | teste de integração          |
| Segredo na auditoria de acesso    | senha inicial, token e hash nunca aparecem                       | teste de integração          |

## Limitações conhecidas

### Rate limit conta por processo

O store é em memória (`MemoryRateLimitStore`). Com um único processo Node — o
caso da hospedagem compartilhada — é efetivo. Com várias instâncias, o limite
se multiplica pelo número de processos, e reinício zera os contadores.

**Evolução:** a interface `RateLimitStore` já existe; basta uma implementação
Redis quando houver Redis. Nada no código chamador muda.

### CSP permite `'unsafe-inline'` em `script-src`

O runtime do Next injeta scripts inline de bootstrap e hidratação sem nonce no
modo `next start`. Uma CSP sem `'unsafe-inline'` quebra a aplicação.

**Evolução:** CSP baseada em nonce via middleware, quando for validada contra o
comportamento do Next 16 sem regressão.

### Sem 2FA e sem bloqueio de conta

**Não há segundo fator de autenticação** e não há bloqueio de conta após N
tentativas — só rate limit por janela (5 tentativas / 5 min por e-mail). O
modelo comporta ambos sem reconstrução: o 2FA entraria como mais uma condição
no pipeline do `authorization-service.ts`, e o bloqueio como colunas em
`users`. Nenhum dos dois foi implementado.

### Sem autoatendimento de redefinição de senha

**Nenhum serviço de e-mail está configurado no projeto**, então não existe
"esqueci minha senha" pelo próprio usuário. A redefinição é iniciada por quem
tem `users.reset_password`, que entrega o código pessoalmente. O token, sua
validade e o efeito de revogar todas as sessões já funcionam — falta só o canal
de entrega.

### Rate limit apenas no login

Troca de senha, consumo de token de redefinição e operações administrativas não
têm rate limit próprio. O risco é baixo: os tokens têm 256 bits, e as operações
administrativas exigem sessão autenticada com permissão. Ainda assim, é uma
superfície que um `RateLimitStore` compartilhado deveria cobrir quando existir.

### Auditoria sem proteção contra adulteração privilegiada

`audit_logs` é somente-inserção **por convenção da aplicação**. Quem tiver
acesso direto ao banco com privilégio de escrita pode alterá-la. Proteção real
exigiria replicação append-only ou assinatura encadeada — fora do escopo desta
fase.

## Dados pessoais (LGPD)

- Sessões **não** guardam IP; do user-agent, só um resumo curto ("Chrome no
  Windows", 120 caracteres), para a pessoa reconhecer o próprio dispositivo.
- Logs e auditoria redigem `password`, `token`, `secret`, `cpf` e variantes.
- O cadastro de usuário tem o mínimo: nome, e-mail, situação e vínculos.
- O cookie carrega apenas um token opaco — nenhum dado pessoal.
