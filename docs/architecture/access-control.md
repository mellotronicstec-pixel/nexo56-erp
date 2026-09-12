# Controle de acesso — papéis, permissões e escopo por unidade

Decisões e alternativas: [ADR-007](../adr/ADR-007-rbac.md),
[ADR-008](../adr/ADR-008-effective-access.md),
[ADR-019](../adr/ADR-019-escopo-de-atribuicao-de-perfil.md),
[ADR-020](../adr/ADR-020-vinculo-de-unidade-nao-e-autorizacao.md),
[ADR-021](../adr/ADR-021-politica-de-autorizacao.md).

A matriz operacional — quem pode o quê, com exemplos permitidos e negados —
está em [access-matrix.md](access-matrix.md).

## Os quatro conceitos, separados de propósito

| Conceito            | Responde                           | Onde vive                         |
| ------------------- | ---------------------------------- | --------------------------------- |
| **Identidade**      | quem é a pessoa                    | `users`                           |
| **Vínculo**         | **onde** ela pode operar           | `user_units`                      |
| **Autorização**     | **o que** ela pode fazer           | `user_roles`, `user_unit_roles`   |
| **Disponibilidade** | o que a empresa contratou e ativou | Effective Access (plano + tenant) |

Misturar vínculo com autorização é o erro clássico de ERP multiempresa: dar
acesso à filial acaba dando poder na filial. Aqui vínculo **nunca** concede
capacidade — ver [ADR-020](../adr/ADR-020-vinculo-de-unidade-nao-e-autorizacao.md).

## Modelo

```
User ──< user_units >────────── Unit          (vínculo: onde opera)

User ──< user_roles >────────── Role          (papel válido no tenant)
       └ escopo TENANT

User ──< user_unit_roles >───── Role          (papel válido só naquela unidade)
       └ escopo UNIT             │
                                 └ exige vínculo em user_units (FK no banco)

Role ──< role_permissions >──── Permission    (catálogo global do produto)
```

`permissions` é catálogo **global**: a chave `users.manage` significa a mesma
coisa em todas as empresas. `roles` é **por tenant**: cada empresa monta os
seus perfis.

### Escopo pertence à atribuição, não ao perfil

O mesmo perfil "Técnico" pode valer no tenant inteiro para uma pessoa e apenas
na Unidade Norte para outra. Por isso o escopo é propriedade da **atribuição**:

| Escopo   | Tabela            | Significado                                                     |
| -------- | ----------------- | --------------------------------------------------------------- |
| `TENANT` | `user_roles`      | vale nas unidades que o usuário **já** acessa                   |
| `UNIT`   | `user_unit_roles` | vale **somente** na unidade indicada; exige vínculo prévio nela |

Um papel de escopo TENANT **não** concede vínculo a novas unidades. Ampliar
alcance continua sendo um ato explícito e auditado de vincular unidade.

### Proteções no próprio banco

`user_unit_roles` carrega quatro foreign keys compostas:

| FK                                  | Garante                 |
| ----------------------------------- | ----------------------- |
| `(user_id, tenant_id)` → `users`    | usuário é do tenant     |
| `(role_id, tenant_id)` → `roles`    | perfil é do tenant      |
| `(unit_id, tenant_id)` → `units`    | unidade é do tenant     |
| `(user_id, unit_id)` → `user_units` | **vínculo obrigatório** |

Como as três primeiras compartilham a mesma coluna `tenant_id`, o InnoDB
recusa qualquer combinação entre empresas diferentes — inclusive por `INSERT`
direto em SQL. A quarta faz da regra "papel por unidade exige vínculo" uma
restrição do banco, não uma checagem da aplicação; o `ON DELETE CASCADE` dela
garante que remover o vínculo não deixe atribuição órfã concedendo acesso.

Comprovado em `tests/integration/privilege-escalation.test.ts` e
`role-scope.test.ts`.

## Permissões da fundação

`<recurso>.<ação>` — `view` lê, `manage` cria/edita/desativa.

| Grupo na interface  | Permissões                                                                                         |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| Usuários            | `users.view` · `users.manage` · `users.manage_access` · `users.reset_password` · `sessions.revoke` |
| Perfis de acesso    | `roles.view` · `roles.manage` · `roles.manage_permissions` · `admin.access`                        |
| Unidades            | `units.view` · `units.manage`                                                                      |
| Módulos e auditoria | `features.view` · `features.manage` · `audit.view`                                                 |

Três permissões são separadas de propósito, por serem os vetores reais de
escalonamento:

- **`users.manage_access`** — vincular unidade e atribuir perfil. Conceder
  acesso é mais perigoso que editar um nome, então não vem junto de
  `users.manage`.
- **`roles.manage_permissions`** — alterar **quais** permissões um perfil
  concede. É o vetor clássico: sem separá-la, quem pode renomear um perfil
  poderia se dar todas as capacidades do sistema.
- **`users.reset_password`** — iniciar redefinição de senha alheia.

`HIGH_RISK_PERMISSIONS` marca essas e outras na interface, que exibe aviso
explícito antes de conceder.

## Perfis criados no provisionamento

| Perfil        | `is_system` | Permissões iniciais  |
| ------------- | ----------- | -------------------- |
| Administrador | sim         | todas as do catálogo |
| Atendente     | não         | nenhuma              |
| Técnico       | não         | nenhuma              |
| Financeiro    | não         | nenhuma              |

Os três perfis iniciais nascem **sem permissões** deliberadamente: o catálogo
atual só tem capacidades estruturais (usuários, perfis, unidades, módulos,
auditoria), e atribuir qualquer uma delas a "Técnico" seria arbitrário. Cada
módulo posterior acrescenta capacidades reais e então eles passam a fazer
sentido prático. Não são `is_system` — a empresa pode renomear, ajustar ou
excluir. Apenas o Administrador é protegido, por ser o caminho administrativo
do tenant.

`syncSystemRolePermissions()` mantém o perfil Administrador em dia: permissões
acrescentadas ao catálogo em versões novas chegam aos tenants já existentes,
sem migração manual.

### O Administrador não tem superpoder embutido

Não existe `if (user.role === 'admin')` em página, action ou repository. O
Administrador é um papel como outro qualquer — apenas com todas as permissões
atribuídas. Tirar uma permissão dele tira a capacidade de verdade.

## Decisão de autorização

Pipeline único, **negação por padrão**, em
`access-control/application/authorization-service.ts`:

```
Autenticado
  AND tenant válido
  AND usuário ativo            ─┐ garantidos na montagem do TenantContext:
  AND sessão válida             ─┘ sem isso o contexto simplesmente não existe
  AND unidade autorizada quando a ação é de unidade
  AND permissão concedida NO ESCOPO da ação
  AND feature disponível quando exigida
  AND recurso pertence ao contexto
⇒ PERMITIR — caso contrário NEGAR
```

Escopo da permissão:

- ação **sem** unidade → valem apenas os papéis TENANT. Um papel concedido só
  na Unidade Norte **não** autoriza ação de nível tenant;
- ação **com** unidade → valem os papéis TENANT mais os papéis UNIT daquela
  unidade.

### Motivos de negação

| Motivo                  | Mensagem ao usuário                                         |
| ----------------------- | ----------------------------------------------------------- |
| `NOT_AUTHENTICATED`     | Sessão expirada ou inexistente. Faça login novamente.       |
| `UNIT_REQUIRED`         | Esta operação exige uma unidade selecionada.                |
| `UNIT_NOT_AUTHORIZED`   | Você não tem acesso a esta unidade.                         |
| `PERMISSION_DENIED`     | Você não tem permissão para executar esta ação.             |
| `FEATURE_UNAVAILABLE`   | Esta funcionalidade não está disponível para a sua empresa. |
| `RESOURCE_OUT_OF_SCOPE` | **Registro não encontrado.**                                |

A última é intencional: um ID válido de **outro tenant** devolve "não
encontrado", nunca "sem permissão" — responder "sem permissão" confirmaria que
o registro existe. É a defesa contra IDOR por enumeração, verificada em teste e
em navegador.

### Interface não é barreira

O menu e os botões consultam `can()` apenas para **UX**. Cada página e cada
Server Action revalida no servidor com `requireAuthorization()` /
`requireUnitAuthorization()`. Acesso por URL direta a rota administrativa sem
permissão termina em `/acesso-negado`; com ID de outra empresa, em 404.

## Unidade ativa

O `TenantContext` carrega `authorizedUnitIds` (todas as autorizadas) e
`activeUnitId` (a selecionada). A seleção vem de um cookie, mas **nunca** é
aceita sem verificação: se a unidade pedida não estiver em `authorizedUnitIds`,
ela é ignorada em silêncio — sem confirmar que a unidade existe.

Trocar de unidade muda as permissões efetivas, e isso é o comportamento
correto: quem é Técnico só na Unidade Norte perde essas capacidades ao operar
na Unidade Sul.

## Effective Access

```
featureExists AND planAllows AND tenantEnabled AND dependenciesSatisfied AND userAuthorized
```

Camada anterior à permissão: mesmo com a permissão certa, a ação é negada se a
empresa não contratou ou não ativou o módulo.

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

## Gestão administrativa

Telas em `/administracao/usuarios`, `/administracao/usuarios/[userId]`
(ficha de acesso), `/administracao/perfis` e `/administracao/perfis/[roleId]`
(editor de permissões agrupado por área).

Regras que a aplicação impõe em toda operação administrativa:

| Regra                                              | Onde                                        |
| -------------------------------------------------- | ------------------------------------------- |
| Ninguém concede permissão que não possui           | `assertCanGrantPermissions()`               |
| Ninguém amplia o próprio acesso                    | `assertNotSelfEscalation()`                 |
| A empresa nunca fica sem administrador             | `assertTenantKeepsAdmin()`                  |
| Perfil `is_system` não pode ser excluído           | `deleteRole()`                              |
| Papel por unidade exige vínculo                    | banco (FK) + `assignRole()`                 |
| Remover vínculo remove os papéis daquela unidade   | `revokeUnitMembership()` + cascade          |
| Desativar usuário encerra todas as sessões         | `deactivateUser()`                          |
| Alvo sempre resolvido dentro do tenant do contexto | `findUserInTenant()` / `findRoleInTenant()` |

### Último administrador

`assertTenantKeepsAdmin()` roda **dentro da transação** e serializa pela linha
do tenant (`SELECT id FROM tenants WHERE id = ? FOR UPDATE`) antes de contar os
administradores restantes com leitura travada. Sem essa serialização, duas
revogações simultâneas — cada uma removendo um administrador diferente — dois
commits válidos, zero administradores. O teste
`tests/integration/last-admin.test.ts` reproduz exatamente esse cenário.

A proteção cobre: revogar o papel, desativar o usuário e remover as permissões
administrativas do perfil.

## Auditoria

Toda operação de acesso grava trilha na mesma transação da escrita:

`user.created` · `user.updated` · `user.activated` · `user.deactivated` ·
`user.unit.granted` · `user.unit.revoked` · `role.created` · `role.updated` ·
`role.deleted` · `role.assigned` · `role.revoked` · `role.permissions_changed` ·
`password.changed` · `password.reset_requested` · `password.reset_completed` ·
`session.revoked` · `session.all_revoked` · `unit.switched` ·
`user.login.succeeded` · `user.login.failed` · `user.logged_out`

A trilha registra **quem**, **o quê**, **quando**, **em qual tenant/unidade** e
o **antes/depois** da mudança de acesso — e nunca senha, hash, token, cookie ou
segredo.

## Testes

| Arquivo                                              | Cobre                                             |
| ---------------------------------------------------- | ------------------------------------------------- |
| `tests/integration/role-scope.test.ts`               | escopo TENANT × UNIT                              |
| `tests/integration/privilege-escalation.test.ts`     | autoescalonamento, conceder além do próprio, IDOR |
| `tests/integration/last-admin.test.ts`               | último administrador, inclusive concorrência      |
| `tests/integration/account-security.test.ts`         | senha, redefinição, sessões, revogação            |
| `tests/integration/user-administration.test.ts`      | CRUD de usuários, vínculos, perfis iniciais       |
| `tests/integration/tenant-isolation.test.ts`         | isolamento entre empresas                         |
| `tests/integration/cross-tenant-constraints.test.ts` | recusa do banco a combinações entre tenants       |
