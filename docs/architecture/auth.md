# Autenticação e sessões

Decisões e alternativas: [ADR-006](../adr/ADR-006-autenticacao-e-sessoes.md),
[ADR-022](../adr/ADR-022-ciclo-de-vida-da-sessao.md).

Controle de acesso (papéis, permissões, escopo por unidade) está em
[access-control.md](access-control.md); a matriz operacional está em
[access-matrix.md](access-matrix.md).

## Senha

scrypt da biblioteca padrão do Node — `N=2^16, r=8, p=2, keyLength=64`, salt de
16 bytes. Formato armazenado:

```
scrypt$65536$8$2$<salt-base64>$<hash-base64>
```

O algoritmo e os parâmetros ficam **dentro** do hash, e `needsRehash()` detecta
os defasados. O login re-hasheia de forma transparente quando a senha correta é
informada — trocar de algoritmo depois não obriga ninguém a redefinir a senha.

### Política de senha

| Regra                    | Valor                                            |
| ------------------------ | ------------------------------------------------ |
| Comprimento mínimo       | 10 caracteres                                    |
| Comprimento máximo       | 512 caracteres (recusa explícita, nunca truncar) |
| Maiúscula/número/símbolo | **não** exigidos                                 |
| Lista de senhas óbvias   | recusada (`senha123456`, `password123`, …)       |
| Somente espaços          | recusada                                         |

Comprimento é o fator que realmente encarece um ataque; regras de composição
empurram as pessoas para `Senha@123`. O trabalho pesado fica com scrypt e o
rate limit. Implementado em `password-service.ts` (`passwordSchema`).

## Sessão

| Aspecto        | Decisão                                                    |
| -------------- | ---------------------------------------------------------- |
| Token          | 256 bits (CSPRNG), `base64url`                             |
| Armazenamento  | apenas SHA-256 do token no banco                           |
| Cookie         | `HttpOnly`, `SameSite=Lax`, `Secure` em produção, `Path=/` |
| Expiração      | `SESSION_TTL_HOURS` (padrão 12h)                           |
| Revogação      | imediata (`revoked_at`)                                    |
| `last_used_at` | atualizado a cada validação                                |
| Dados pessoais | IP **não** é gravado; user-agent só como resumo curto      |

`user_agent_summary` guarda algo como `Chrome no Windows`, truncado em 120
caracteres, com um único propósito: a pessoa reconhecer o próprio dispositivo
na lista de sessões ativas. Não é fingerprint — não há user-agent completo,
versão detalhada nem IP.

Conta ou empresa desativada invalida o contexto **mesmo com sessão válida** —
verificado em teste.

### Ciclo de vida

```
login ──► sessão criada (token novo, cookie HttpOnly)
            │
            ├── uso normal ──► last_used_at atualizado
            │
            ├── logout ─────────────────► revoked_at = agora
            ├── "encerrar esta sessão" ─► revoked_at = agora
            ├── "encerrar as outras" ───► revoked_at nas demais
            ├── troca de senha ─────────► revoked_at nas demais (padrão)
            ├── redefinição concluída ──► revoked_at em TODAS
            ├── admin encerra sessões ──► revoked_at em todas do usuário
            ├── usuário desativado ─────► revoked_at em todas
            └── expiração (TTL) ────────► sessão deixa de validar
```

Revogar é sempre gravar `revoked_at`, nunca apagar a linha: a trilha de quem
entrou e quando permanece auditável. A validação exige, na mesma consulta,
`revoked_at IS NULL AND expires_at > agora`.

Todos os pontos acima têm teste de integração em
`tests/integration/account-security.test.ts`.

### Gestão das próprias sessões

`/minha-conta` lista as sessões ativas, marca **esta sessão** e permite
encerrar uma específica ou todas as outras. A lista é sempre escopada pelo
`userId` do contexto — não existe caminho para listar ou encerrar a sessão de
outra pessoa por essa tela.

### Revogação administrativa

Quem tem `sessions.revoke` pode encerrar as sessões de outro usuário da mesma
empresa (`revokeUserSessionsAsAdmin`). A operação é auditada e o alvo é
resolvido **dentro do tenant do contexto** — ID de outra empresa devolve
"registro não encontrado", sem confirmar existência.

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

O e-mail é normalizado (`trim` + minúsculas) **antes** da validação de formato,
tanto no login quanto no cadastro — `"  Ana@Empresa.com "` e
`"ana@empresa.com"` são a mesma pessoa.

## Troca de senha

`changeOwnPassword` exige a senha atual, confirma a nova, recusa repetir a
atual e — por padrão — encerra as demais sessões. A senha atual é verificada
com a mesma função do login; nenhum caminho permite trocar a senha de outra
pessoa por aqui.

## Redefinição de senha

| Aspecto            | Decisão                                             |
| ------------------ | --------------------------------------------------- |
| Token              | 256 bits (CSPRNG), `base64url`                      |
| Armazenamento      | apenas SHA-256 (`password_reset_tokens.token_hash`) |
| Validade           | 60 minutos (`RESET_TOKEN_TTL_MINUTES`)              |
| Uso                | único — `used_at` marca o consumo                   |
| Efeito ao concluir | senha trocada **e todas as sessões revogadas**      |
| Entrega            | **código exibido ao administrador** (ver abaixo)    |

Quem tem `users.reset_password` gera o código pela ficha do usuário; o código
aparece **uma única vez** na tela e é entregue pessoalmente. `created_by`
registra qual administrador iniciou o reset.

> **Não há envio por e-mail.** Nenhum serviço de e-mail está configurado no
> projeto. Autoatendimento ("esqueci minha senha" pelo próprio usuário) depende
> desse canal e está **planejado**, não implementado.

## Proteção contra força bruta

| Superfície            | Proteção                                       |
| --------------------- | ---------------------------------------------- |
| Login                 | rate limit 5 tentativas / 5 min por e-mail     |
| Enumeração de usuário | mensagem única + verificação de senha simulada |
| Token de sessão       | 256 bits — adivinhar é inviável                |
| Token de redefinição  | 256 bits, uso único, 60 min                    |

O rate limit conta **por processo** (store em memória) — ver as limitações
conhecidas em [security.md](security.md).

## O que nunca é gravado

Senha em texto puro · hash de senha em log ou auditoria · token bruto de
sessão · token bruto de redefinição · cookie · segredo de integração.

`logger.redact()` e o `audit-service` aplicam a mesma lista de campos
sensíveis; há teste unitário e de integração para os dois.
