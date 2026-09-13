# Matriz de acesso — Nexo56

**Versão 1.0 — Prompt 03.** Documento versionado: cada prompt que acrescenta
permissões acrescenta linhas aqui e sobe a versão. Linhas não são reescritas
silenciosamente — mudança de regra vira nova versão com a data.

| Versão | Data      | Mudança                                                      |
| ------ | --------- | ------------------------------------------------------------ |
| 1.0    | Prompt 03 | Primeira versão: capacidades estruturais e escopo de unidade |

Conceitos e implementação: [access-control.md](access-control.md).

---

## 1. Capacidades por permissão

Legenda de escopo: **T** = ação de nível tenant (papel TENANT);
**U** = ação de unidade (papel TENANT ou papel UNIT daquela unidade).

| Permissão                       | Permite                                          | Escopo | Risco |
| ------------------------------- | ------------------------------------------------ | ------ | ----- |
| `admin.access`                  | abrir a área de administração                    | T      | —     |
| `users.view`                    | listar e abrir usuários da empresa               | T      | —     |
| `users.manage`                  | criar, editar, ativar e desativar usuários       | T      | alto  |
| `users.manage_access`           | vincular unidades e atribuir/revogar perfis      | T      | alto  |
| `users.reset_password`          | gerar código de redefinição de senha de terceiro | T      | alto  |
| `sessions.revoke`               | encerrar sessões de outro usuário                | T      | alto  |
| `roles.view`                    | consultar perfis e suas permissões               | T      | —     |
| `roles.manage`                  | criar, renomear e excluir perfis                 | T      | alto  |
| `roles.manage_permissions`      | alterar **quais** permissões um perfil concede   | T      | alto  |
| `units.view`                    | consultar unidades                               | T      | —     |
| `units.manage`                  | criar e alterar unidades                         | T      | alto  |
| `features.view`                 | consultar módulos disponíveis                    | T      | —     |
| `features.manage`               | ativar e desativar módulos da empresa            | T      | alto  |
| `audit.view`                    | consultar a trilha de auditoria                  | T      | —     |
| `customers.view`                | listar e abrir clientes                          | T      | —     |
| `customers.manage`              | cadastrar e corrigir clientes                    | T      | médio |
| `customers.change_status`       | ativar e inativar cliente                        | T      | médio |
| `equipment.view`                | consultar equipamentos e suas fotos              | T      | —     |
| `equipment.manage`              | cadastrar e corrigir a identificação do aparelho | T      | médio |
| `equipment_intake.view`         | consultar os recebimentos **da unidade**         | **U**  | —     |
| `equipment_intake.create`       | registrar a entrada de um aparelho na unidade    | **U**  | médio |
| `equipment_intake.manage_media` | anexar e remover fotos                           | **U**  | médio |

Até o Prompt 04 todas as capacidades eram de nível **tenant** — o catálogo
continha apenas administração estrutural. O Prompt 06 trouxe as primeiras de
nível **unidade**: recebimento é um acontecimento que pertence a um lugar, e as
três permissões de `equipment_intake` valem para a unidade ativa. Clientes e
Equipamentos continuam de nível tenant, porque a entidade em si atravessa as
unidades (ADR-026, ADR-029).

As demais permissões de operação diária (ordens de serviço, estoque, caixa)
chegam com os módulos seguintes.

---

## 2. Perfis de origem

| Perfil        | `is_system` | Permissões                   | Pode ser excluído |
| ------------- | ----------- | ---------------------------- | ----------------- |
| Administrador | sim         | todas                        | não               |
| Atendente     | não         | nenhuma (aguarda os módulos) | sim               |
| Técnico       | não         | nenhuma (aguarda os módulos) | sim               |
| Financeiro    | não         | nenhuma (aguarda os módulos) | sim               |

---

## 3. Rotas e o que cada uma exige

| Rota                                 | Exige                                             |
| ------------------------------------ | ------------------------------------------------- |
| `/login`                             | — (pública)                                       |
| `/`                                  | sessão válida                                     |
| `/minha-conta`                       | sessão válida (sem permissão)                     |
| `/administracao/usuarios`            | `users.view`                                      |
| `/administracao/usuarios/[userId]`   | `users.view` + alvo no mesmo tenant               |
| `/administracao/perfis`              | `roles.view`                                      |
| `/administracao/perfis/[roleId]`     | `roles.view` + alvo no mesmo tenant               |
| `/administracao/unidades`            | `units.view` + feature `platform.multi_unit`      |
| `/administracao/modulos`             | `features.view`                                   |
| `/administracao/auditoria`           | `audit.view`                                      |
| `/clientes`                          | `customers.view` + feature `core.customers`       |
| `/clientes/novo`                     | `customers.manage`                                |
| `/clientes/[customerId]`             | `customers.view` + alvo no mesmo tenant           |
| `/clientes/[customerId]/editar`      | `customers.manage` + alvo no mesmo tenant         |
| `/equipamentos`                      | `equipment.view` + feature `core.equipment`       |
| `/equipamentos/novo`                 | `equipment.manage`                                |
| `/equipamentos/[equipmentId]`        | `equipment.view` + alvo no mesmo tenant           |
| `/equipamentos/[equipmentId]/editar` | `equipment.manage` + alvo no mesmo tenant         |
| `/recebimentos`                      | `equipment_intake.view` + unidade ativa           |
| `/recebimentos/novo`                 | `equipment_intake.create` + unidade ativa         |
| `/api/midia/[mediaId]`               | sessão + `equipment.view` + mídia do mesmo tenant |
| `/acesso-negado`                     | — (página de explicação)                          |

Cada Server Action revalida a permissão **de escrita** correspondente, que é
sempre mais estrita que a de leitura da página. Abrir a ficha de um usuário
exige `users.view`; conceder-lhe um perfil exige `users.manage_access`.

---

## 4. Exemplos permitidos

| #   | Situação                                                                                          | Resultado |
| --- | ------------------------------------------------------------------------------------------------- | --------- |
| 1   | Administrador da Empresa A abre a lista de usuários da Empresa A                                  | permitido |
| 2   | Usuário com `users.view` abre a ficha de acesso de um colega do mesmo tenant                      | permitido |
| 3   | Usuário com `users.manage_access` vincula um colega à Unidade Norte                               | permitido |
| 4   | Usuário com `users.manage_access` atribui "Técnico" **só na Unidade Norte** a quem tem vínculo lá | permitido |
| 5   | Usuário com papel TENANT "Financeiro" opera na Unidade Norte **e** na Unidade Sul                 | permitido |
| 6   | Qualquer usuário autenticado abre `/minha-conta` e encerra as próprias outras sessões             | permitido |
| 7   | Usuário troca a própria senha informando a senha atual correta                                    | permitido |
| 8   | Usuário com `sessions.revoke` encerra as sessões de um colega do mesmo tenant                     | permitido |
| 9   | Usuário com `roles.manage_permissions` concede a um perfil uma permissão **que ele mesmo tem**    | permitido |
| 10  | Atendente da Unidade Norte abre o equipamento cadastrado na Unidade Sul (mesmo tenant)            | permitido |
| 11  | Usuário com `equipment_intake.create` e unidade ativa registra um recebimento                     | permitido |
| 12  | Usuário com `equipment.view` carrega a foto do equipamento pela rota `/api/midia/[mediaId]`       | permitido |

---

## 5. Exemplos negados

| #   | Tentativa                                                                             | Motivo                    | Resposta                           |
| --- | ------------------------------------------------------------------------------------- | ------------------------- | ---------------------------------- |
| 1   | Sem sessão, acessar `/administracao/usuarios` por URL direta                          | `NOT_AUTHENTICATED`       | redireciona para `/login`          |
| 2   | Com sessão, sem `users.view`, acessar `/administracao/usuarios`                       | `PERMISSION_DENIED`       | `/acesso-negado`                   |
| 3   | Abrir a ficha de um usuário **de outra empresa** usando o ID real                     | `RESOURCE_OUT_OF_SCOPE`   | **404 "registro não encontrado"**  |
| 4   | Atribuir a si mesmo um perfil com mais permissões                                     | autoescalonamento         | erro de regra de negócio           |
| 5   | Conceder a um perfil uma permissão que o próprio concedente **não** possui            | delegação além do próprio | erro de regra de negócio           |
| 6   | Atribuir perfil por unidade a quem **não tem vínculo** naquela unidade                | vínculo ausente           | erro; e o banco recusaria a linha  |
| 7   | Revogar o papel do **último** administrador da empresa                                | tenant sem administrador  | erro de regra de negócio           |
| 8   | Desativar o **último** administrador da empresa                                       | tenant sem administrador  | erro de regra de negócio           |
| 9   | Excluir o perfil `Administrador` (`is_system`)                                        | perfil estrutural         | erro de regra de negócio           |
| 10  | Trocar para uma unidade **não autorizada** enviando o ID no formulário                | `UNIT_NOT_AUTHORIZED`     | ignorado em silêncio, com log      |
| 11  | Usar permissão de papel UNIT (só na Unidade Norte) para uma ação de **nível tenant**  | `PERMISSION_DENIED`       | erro de autorização                |
| 12  | Usar permissão de papel UNIT da Unidade Norte para agir **na Unidade Sul**            | `PERMISSION_DENIED`       | erro de autorização                |
| 13  | Agir numa unidade sem tê-la selecionada, quando a ação é de unidade                   | `UNIT_REQUIRED`           | erro de autorização                |
| 14  | Usar sessão de usuário **desativado** depois da desativação                           | contexto inválido         | redireciona para `/login`          |
| 15  | Usar sessão de empresa **suspensa**                                                   | contexto inválido         | redireciona para `/login`          |
| 16  | Reusar um código de redefinição de senha já consumido                                 | token usado               | erro de autenticação               |
| 17  | Usar um código de redefinição expirado (> 60 min)                                     | token expirado            | erro de autenticação               |
| 18  | Trocar a própria senha informando a senha atual errada                                | senha incorreta           | erro de autenticação               |
| 19  | Encerrar a sessão de outra pessoa pela tela `/minha-conta`                            | fora do escopo do usuário | "registro não encontrado"          |
| 20  | 6ª tentativa de login com senha errada em 5 minutos                                   | rate limit                | erro com `Retry-After`             |
| 21  | Acessar `/administracao/unidades` com `platform.multi_unit` desativada para a empresa | `FEATURE_UNAVAILABLE`     | `/acesso-negado`                   |
| 22  | `INSERT` direto em SQL vinculando usuário da Empresa A a unidade da Empresa B         | FK composta               | `ERROR 1452` do InnoDB             |
| 23  | Ver o recebimento da Unidade Sul estando com a Unidade Norte ativa                    | escopo de unidade         | não aparece na consulta            |
| 24  | Registrar recebimento **sem unidade ativa**                                           | `UNIT_REQUIRED`           | erro de autorização                |
| 25  | Enviar `unitId` de outra unidade no formulário de recebimento                         | valor ignorado            | usa `context.activeUnitId`         |
| 26  | Abrir `/api/midia/[mediaId]` **sem sessão**                                           | sem autenticação          | `401`, sem corpo                   |
| 27  | Abrir mídia de outro tenant com sessão válida                                         | fora do tenant            | `404` (nunca 403)                  |
| 28  | Enviar um `.php` renomeado para `.jpg` como foto                                      | magic bytes               | recusado com mensagem em português |
| 29  | `INSERT` direto ligando equipamento da Empresa B a cliente da Empresa A               | FK composta               | `ERROR 1452` do InnoDB             |

**Por que o item 3 responde 404 e não 403:** responder "sem permissão"
confirmaria que aquele registro existe. Para quem está do lado de fora, um ID
de outra empresa e um ID inexistente são indistinguíveis.

---

## 6. Onde cada linha é verificada

| Bloco                                 | Teste                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------- |
| Permitidos 1–5, negados 6, 11, 12, 13 | `tests/integration/role-scope.test.ts`                                    |
| Negados 3, 4, 5, 10, 22               | `tests/integration/privilege-escalation.test.ts`                          |
| Negados 7, 8, 9                       | `tests/integration/last-admin.test.ts`                                    |
| Permitidos 6, 7, 8; negados 14–19     | `tests/integration/account-security.test.ts`                              |
| Permitidos 1, 2, 3; perfis de origem  | `tests/integration/user-administration.test.ts`                           |
| Negados 14, 15, 20                    | `tests/integration/auth.test.ts`                                          |
| Negados 1, 2, 21                      | `tests/integration/effective-access.test.ts` + navegador                  |
| Negado 20 (janela e contagem)         | `tests/unit/rate-limit.test.ts`                                           |
| Negado 22                             | `tests/integration/cross-tenant-constraints.test.ts`                      |
| Permitidos 10–12; negados 23–25       | `tests/integration/equipment.test.ts` + `equipment-authorization.test.ts` |
| Negados 27, 28                        | `tests/integration/equipment.test.ts` (bloco fotos)                       |
| Negado 26; permitido 12               | navegador real contra o build de produção                                 |
| Negado 29                             | `tests/integration/equipment.test.ts` (FK composta)                       |
