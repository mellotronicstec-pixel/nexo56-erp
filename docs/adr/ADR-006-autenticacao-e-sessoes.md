# ADR-006 — Autenticação e sessões

**Status:** Aceito · **Data:** Prompt 01

## Decisão

### Hash de senha: scrypt (`node:crypto`)

Parâmetros: `N=2^16, r=8, p=2, keyLength=64`, salt aleatório de 16 bytes.
Formato: `scrypt$<N>$<r>$<p>$<salt-b64>$<hash-b64>`.

**Motivo:** argon2 e bcrypt exigem binário nativo (node-gyp ou napi
pré-compilado). Em hospedagem compartilhada não há controle sobre a toolchain,
e falha de binário derruba o login inteiro. scrypt é memory-hard, recomendado
pelo OWASP e vem na biblioteca padrão do Node — zero dependência nativa.

**Migração futura:** o prefixo do algoritmo está no próprio hash e
`needsRehash()` detecta parâmetros defasados; o login re-hasheia de forma
transparente quando a senha correta é informada. Trocar para argon2 depois não
exige redefinir a senha de ninguém.

### Sessões: server-side, token opaco

- Token de 256 bits (CSPRNG), transportado em cookie `nexo56_session`.
- O banco guarda **apenas o SHA-256** do token — vazamento de leitura do banco
  não permite assumir sessões.
- Cookie: `HttpOnly`, `SameSite=Lax`, `Secure` em produção, `Path=/`,
  expiração explícita.
- IP e user-agent **não** são armazenados (dado pessoal que a fundação não
  precisa — LGPD, Prompt 00 item 92).

**Motivo para não usar JWT:** revogação imediata (logout, suspensão de usuário,
troca de senha) é requisito de ERP. Um JWT válido continua válido até expirar.

### Resolução de tenant no login

`uq_users_tenant_email` permite o mesmo e-mail em empresas diferentes. O login
busca candidatos por e-mail: com um, prossegue; com mais de um, exige o
identificador da empresa — **sem revelar em quais empresas o e-mail existe**.

### Proteções

- Mensagem única para e-mail inexistente, senha errada, usuário inativo e
  empresa suspensa.
- Verificação de senha simulada quando o e-mail não existe (anti-enumeração por
  timing).
- Rate limit por e-mail (5 tentativas / 5 min) antes de tocar no banco.
- CSRF: proteção nativa de Server Actions do Next **mais** verificação
  explícita de `Origin` contra `APP_URL` (defesa em profundidade).

## Alternativas consideradas

| Alternativa      | Por que não                                                                                                                   |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| NextAuth/Auth.js | Camada grande para o que a fundação precisa, com adaptador próprio de banco e menos controle sobre auditoria e multi-tenancy. |
| JWT stateless    | Impede revogação imediata.                                                                                                    |
| bcrypt/argon2    | Dependência nativa — risco de deploy quebrado.                                                                                |

## Consequências

- Cada requisição autenticada faz uma consulta à tabela `sessions` (custo baixo,
  índice único no hash do token).
- `SESSION_TTL_HOURS` controla a expiração; o job `session.prune-expired`
  limpa a tabela periodicamente.
