# Autenticação, RBAC e Effective Access

Decisões e alternativas: [ADR-006](../adr/ADR-006-autenticacao-e-sessoes.md),
[ADR-007](../adr/ADR-007-rbac.md), [ADR-008](../adr/ADR-008-effective-access.md).

## Senha

scrypt da biblioteca padrão do Node — `N=2^16, r=8, p=2, keyLength=64`, salt de
16 bytes. Formato armazenado:

```
scrypt$65536$8$2$<salt-base64>$<hash-base64>
```

O algoritmo e os parâmetros ficam **dentro** do hash, e `needsRehash()` detecta
os defasados. O login re-hasheia de forma transparente quando a senha correta é
informada — trocar de algoritmo depois não obriga ninguém a redefinir a senha.

## Sessão

| Aspecto        | Decisão                                                    |
| -------------- | ---------------------------------------------------------- |
| Token          | 256 bits (CSPRNG), `base64url`                             |
| Armazenamento  | apenas SHA-256 do token no banco                           |
| Cookie         | `HttpOnly`, `SameSite=Lax`, `Secure` em produção, `Path=/` |
| Expiração      | `SESSION_TTL_HOURS` (padrão 12h)                           |
| Revogação      | imediata (`revoked_at`), via logout ou suspensão           |
| Dados pessoais | IP e user-agent **não** são gravados                       |

Conta ou empresa desativada invalida o contexto **mesmo com sessão válida** —
verificado em teste.

## Resolução de tenant no login

O e-mail é único **por tenant**, então a mesma pessoa pode existir em empresas
diferentes:

```
e-mail informado
  ├── 0 candidatos → erro genérico (+ verificação de senha simulada)
  ├── 1 candidato  → prossegue
  └── N candidatos → pede o identificador da empresa,
                     sem revelar em quais empresas o e-mail existe
```

## RBAC

```
User ──< user_roles >── Role ──< role_permissions >── Permission
                         │                              (catálogo global)
                    (por tenant)
```

Permissões da fundação (`<recurso>.<acao>`):

`admin.access` · `users.view` · `users.manage` · `roles.view` · `roles.manage`
· `units.view` · `units.manage` · `features.view` · `features.manage` ·
`audit.view`

## Effective Access

```
featureExists AND planAllows AND tenantEnabled AND userAuthorized
```

Implementado em `effective-access.ts`, responsabilidade única. Retorna decisão
**com motivo**, para a interface poder explicar em vez de só esconder:

| Motivo                   | Significado                      |
| ------------------------ | -------------------------------- |
| `ALLOWED`                | acesso permitido                 |
| `UNKNOWN_FEATURE`        | chave não existe no catálogo     |
| `FEATURE_DEPRECATED`     | funcionalidade descontinuada     |
| `PLAN_NOT_ENTITLED`      | fora do plano contratado         |
| `TENANT_DISABLED`        | a empresa não ativou             |
| `DEPENDENCY_UNSATISFIED` | depende de outra feature inativa |
| `PERMISSION_DENIED`      | o usuário não tem a permissão    |

`CORE` é sempre _entitled_ e sempre ativo — estrutural, não desativável.

### Interface não é barreira

O menu usa `checkManyAccess` (um snapshot, sem N+1) apenas para **UX**.
Cada página e cada Server Action revalida no servidor. Verificado em navegador:
com `platform.multi_unit` desativada, o item some do menu **e** o acesso direto
a `/administracao/unidades` termina em `/acesso-negado`.
