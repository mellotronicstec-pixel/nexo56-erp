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

## Implementado e verificado — mídia e arquivos (Prompt 06)

| Proteção                                     | Como                                                                      | Verificação                         |
| -------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------- |
| Mídia fora de diretório público              | `STORAGE_ROOT` sempre fora de `public/`                                   | teste de integração                 |
| Chave de arquivo não derivada do envio       | gerada pelo servidor: `<escopo>/<16 bytes hex>.<ext>`                     | teste com nome malicioso            |
| Path traversal                               | caminho resolvido e conferido contra a raiz                               | teste de integração                 |
| Arquivo executável disfarçado de foto        | validação por **magic bytes**, não por extensão nem `Content-Type`        | teste de integração                 |
| Imagem grande demais                         | limite de 8 MB antes de gravar                                            | teste de integração                 |
| Mídia sem sessão                             | rota autenticada responde `401` sem corpo                                 | navegador                           |
| Mídia de outro tenant                        | responde `404`, nunca `403` — 403 confirmaria a existência                | teste + navegador                   |
| Cache de imagem em proxy                     | `Cache-Control: private, max-age=300, must-revalidate`                    | navegador                           |
| Geolocalização na foto                       | a imagem é reexportada no navegador: o arquivo enviado é novo, sem EXIF   | teste de componente                 |
| Binário na auditoria                         | a auditoria de foto guarda metadado, nunca o conteúdo                     | teste de integração                 |
| Imagem em log                                | o log da leitura de etiqueta registra provider, status, duração e tamanho | revisão de código                   |
| Unidade forjada no recebimento               | serviço usa `context.activeUnitId`; sem unidade ativa, recusa             | teste de integração                 |
| Equipamento ligado a cliente de outro tenant | FK composta `(customer_id, tenant_id)`                                    | teste com SQL direto (`ERROR 1452`) |

## Implementado e verificado — Ordem de Serviço (Prompt 07)

| Proteção                                         | Como                                                          | Verificação                             |
| ------------------------------------------------ | ------------------------------------------------------------- | --------------------------------------- |
| OS ligada a cliente/equipamento de outra empresa | FKs compostas com `tenant_id`                                 | teste com SQL direto (`ERROR 1452`)     |
| OS carimbada em unidade de outra empresa         | FK composta `(unit_id, tenant_id)`                            | teste com SQL direto                    |
| Recebimento da unidade A virando OS na unidade B | FK composta `(intake_id, unit_id)`                            | teste de integração + SQL direto        |
| Unidade forjada no formulário                    | serviço usa `context.activeUnitId`; sem unidade ativa, recusa | teste de integração                     |
| Cliente forjado no formulário                    | cliente derivado do equipamento                               | teste de integração                     |
| Acesso a OS de outra unidade pelo UUID           | consulta escopada; responde "não encontrada"                  | teste de integração                     |
| Autor de outra empresa                           | FK composta `(created_by, tenant_id)`                         | teste com SQL direto                    |
| Duas ordens pelo mesmo comando                   | `uq_service_order_idempotency` + reencontro no serviço        | teste com 5 envios simultâneos          |
| Duas ordens para o mesmo recebimento             | `uq_service_order_intake`                                     | teste de integração + SQL direto        |
| Número repetido na empresa                       | `uq_service_order_tenant_number`                              | teste com SQL direto (`ERROR 1062`)     |
| Colisão de número sob concorrência               | alocação atômica em `tenant_sequences`                        | 20 aberturas simultâneas                |
| Relato do cliente em log ou evento               | auditoria guarda o tamanho; log registra só a operação        | teste de integração                     |
| Exclusão de OS                                   | não existe caminho de `DELETE` na aplicação                   | revisão de código + teste de componente |

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
- Fotos de equipamento perdem o EXIF (inclusive GPS) no preparo feito pelo
  navegador, e ficam acessíveis apenas por rota autenticada.
- A tela de fotos orienta a fotografar só o equipamento e a etiqueta, evitando
  pessoas, documentos e o ambiente ao redor. O sistema não consegue impedir uma
  foto indevida — pode pedir a foto certa e proteger o arquivo, e é o que faz.
- O **relato do cliente** é texto livre e pode conter dado pessoal incidental.
  Ele nunca vai para log nem para o payload do evento; a auditoria da abertura
  guarda apenas o tamanho. Quando o relato é corrigido, o texto anterior vai por
  inteiro para a trilha — exceção consciente, porque sem ele "relato alterado"
  não permitiria reconstruir o que o cliente disse.
