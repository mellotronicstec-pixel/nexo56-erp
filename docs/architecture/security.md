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

O Prompt 01 pede apenas preparação arquitetural. Não há segundo fator nem
bloqueio após N tentativas (só rate limit por janela). O modelo comporta ambos
sem reconstrução.

### Sem escopo de permissão por unidade

A permissão vale no tenant. `user_units` já delimita quais unidades o usuário
acessa, e o `TenantContext` carrega essa lista, mas ainda não há permissão
específica por unidade.

### Auditoria sem proteção contra adulteração privilegiada

`audit_logs` é somente-inserção **por convenção da aplicação**. Quem tiver
acesso direto ao banco com privilégio de escrita pode alterá-la. Proteção real
exigiria replicação append-only ou assinatura encadeada — fora do escopo desta
fase.

## Dados pessoais (LGPD)

- Sessões **não** guardam IP nem user-agent.
- Logs e auditoria redigem `password`, `token`, `secret`, `cpf` e variantes.
- O cadastro de usuário tem o mínimo: nome, e-mail, situação e vínculos.
- O cookie carrega apenas um token opaco — nenhum dado pessoal.
