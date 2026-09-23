# Portal do Cliente — visão geral

**Prompt 17.** Módulo **OPCIONAL** (`customer.portal`), dependente de
`core.customers` e `core.service_orders`.

## A pergunta que o módulo responde

> O cliente pode acompanhar, sozinho, o que já está no Nexo56 sobre ele —
> sem ligar para a loja e sem que ninguém da equipe precise responder?

V1 é **somente leitura**: ordens de serviço, equipamentos e garantias. Nada
aqui aprova orçamento, edita cadastro ou fala com a loja — isso é escopo de
prompt futuro.

## A separação formal que sustenta tudo

> `Customer` (quem a loja atende) ≠ `PortalIdentity` (o direito de logar) ≠
> `InternalUser` (quem trabalha na loja)

Um `Customer` pode ter zero, uma ou N `PortalIdentity` — uma por tenant onde
tem cadastro com o mesmo contato — nunca o contrário. Nenhuma delas é um
`User`, nenhuma usa `TenantContext`, nenhuma passa por `authorize()`. Ver
[ADR-080](../../adr/ADR-080-autenticacao-externa-do-portal.md).

## O que ele é — e o que ele não é

| É                                              | Não é                                        |
| ----------------------------------------------- | --------------------------------------------- |
| Projeção externa, somente leitura, de dados já existentes | Fonte de verdade de OS, equipamento ou garantia |
| Autenticação própria (link mágico)             | Um segundo login com o RBAC interno           |
| Autorização por ownership (`customerId`)       | Autorização por permissão/papel               |
| Reaproveitamento do serviço oficial de PDF     | Um segundo gerador de certificado             |
| Sempre 404 quando nega acesso                  | 403 em qualquer rota                          |

## Autenticação: link mágico, nunca senha

O cliente informa e-mail ou telefone; se houver cadastro, um link de uso
único e validade de 15 minutos chega pelo mesmo `CommunicationProvider` do
Prompt 16. A resposta na tela é **idêntica** exista ou não o contato — ver
`requestPortalLogin`. Clicar no link não autentica sozinho: a página de
confirmação exige um clique explícito antes de consumir o token, para que um
antivírus de e-mail que abre links preventivamente não "gaste" o link antes
do cliente.

## Sessão separada, cookie separado

`portal_sessions` e `nexo56_portal_session` nunca se misturam com `sessions`
e `nexo56_session`. Revogar uma nunca revoga a outra.

## Autorização: sempre ownership, nunca RBAC

Toda consulta filtra por `tenantId` **e** `customerId` no `WHERE`. Não existe
"403 — isto não é seu": um registro de outro cliente devolve exatamente o
mesmo erro que um registro inexistente (`assertOwned`, em
`portal-ownership.ts`).

## O que é projetado, e o que fica de fora

| Dado                        | Aparece no Portal?                                        |
| ---------------------------- | ----------------------------------------------------------- |
| Status da OS                 | Sim — mesmo rótulo do painel interno                       |
| Relato do cliente            | Sim — é a fala do próprio cliente                          |
| `internal_notes` da OS       | **Nunca**                                                   |
| Linha do tempo                | Só os tipos da lista de permissão (`PORTAL_VISIBLE_TIMELINE_KINDS`) — técnico responsável, movimentação de estoque e tarefa de bancada ficam de fora |
| Número de série do aparelho  | Mascarado — só os 4 últimos caracteres                     |
| Garantia `draft`             | **Nunca** — é trabalho em andamento de quem concede         |
| Custo da garantia            | **Nunca** — `warranty_costs` não tem projeção nenhuma        |
| Certificado de garantia (PDF)| Sim — mesmo artefato do painel, via ownership               |

## Onde cada coisa mora

| Conceito                                   | Arquivo                                                          |
| -------------------------------------------- | ------------------------------------------------------------------ |
| Constantes, normalização, projeção, máscara | `domain/portal.ts`                                                |
| Schema e migration                          | `infrastructure/schema.ts`, `drizzle/0015_portal.sql`             |
| Sessão (criar, revogar, podar)              | `application/portal-session-service.ts`                          |
| Link mágico (pedir, consumir)               | `application/portal-login-service.ts`                            |
| Contexto (reavaliado a cada requisição)     | `application/portal-context.ts`                                  |
| A única forma de negar acesso               | `application/portal-ownership.ts`                                 |
| Projeção externa de OS, equipamento, garantia | `application/portal-query-service.ts`                          |
| Download do certificado                     | `application/portal-warranty-certificate-service.ts`             |
| Telas                                       | `src/app/portal/**`                                               |
| Download autorizado (rota)                  | `src/app/api/portal/garantias/[warrantyId]/certificado/pdf`       |

## O que este módulo NUNCA faz

- Chama `authorize()` ou monta `TenantContext`.
- Escreve em `users` ou `sessions`.
- Cria uma segunda linha de renderização de certificado — reaproveita
  `readCertificatePdfForWarranty` do módulo de Garantias.
- Cria um `communication_messages` para o link mágico — o e-mail/WhatsApp do
  login usa o mesmo provedor da Comunicação, mas nunca a tabela de
  histórico (ver ADR-080, decisão 3: `communication_messages.unit_id` é
  `NOT NULL`, e o Portal estrutural não tem unidade).
- Responde `403` em rota alguma.
