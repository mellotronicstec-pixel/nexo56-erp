# ADR-080 — Autenticação do Portal é link mágico, nunca senha

**Status:** Aceito
**Data:** Prompt 17 — Portal do Cliente
**Itens atendidos:** 7 a 13, 19, 23 a 27, 250

## Contexto

O Portal precisa autenticar `Customer`, e a tentação óbvia é reaproveitar o
que já existe em `modules/auth`: `users`, `sessions`, senha com hash,
`current-context.ts`. Essa tentação é exatamente o que o Prompt 17 proíbe
(itens 7 a 9): **cliente não é usuário interno**. `TenantContext` carrega
`tenantPermissions`, `unitPermissions`, `authorizedUnitIds` — a forma inteira
de um funcionário. Fazer um `Customer` passar por ali para "aproveitar
código" seria construir uma identidade externa vestida de identidade interna,
com todos os caminhos de escalação que isso abre.

Esta ADR decide **como** o cliente prova quem é, mantendo as duas identidades
formalmente separadas desde a tabela até o cookie.

## Alternativas consideradas

**Senha própria para o cliente.** Rejeitada. Um cliente que visita a loja
duas vezes por ano não lembra senha nenhuma, e "esqueci minha senha" recria
inteiro o problema de recuperação que o link mágico já resolve de graça. Pior:
senha é segredo de longo prazo que a assistência passaria a guardar para gente
que não é seu usuário, no mesmo banco onde já guarda a de quem é.

**OTP (código numérico) por SMS/WhatsApp/e-mail.** Rejeitada para V1, não por
ser errada — por ser **redundante** com o link mágico dado o canal disponível.
Digitar seis dígitos existe para provar posse do dispositivo quando o link não
pode ser clicado no mesmo aparelho (ex.: código por voz). Aqui o cliente abre
o WhatsApp ou o e-mail no mesmo celular onde vai usar o Portal — o clique já
prova a posse, e pedir para copiar um código à mão é fricção sem ganho de
segurança correspondente. Fica registrado como extensão natural se um canal
sem link (SMS puro) entrar depois.

**Token fixo por URL (o mesmo padrão do certificado de garantia).** Rejeitada
explicitamente. `findCertificateByToken` (Prompt 13) resolve um QR **dentro**
de um `TenantContext` já autenticado — é um atalho de busca para quem já
provou identidade, não uma porta de entrada. Um token que abrisse sessão
sozinho seria, com as palavras do próprio comentário daquele código,
"um link público com o nome do cliente dentro". A ADR-052 (verificação por QR)
já estabeleceu esse limite; esta ADR o reafirma para o Portal: token de
certificado identifica um documento, nunca autentica uma pessoa.

## Decisão: link mágico, entregue pela Comunicação, sessão própria e opaca

1. **Solicitação.** O cliente informa um contato (e-mail ou telefone) na tela
   de entrada do Portal. O sistema busca `customer_contacts` normalizado por
   aquele valor, **em todos os tenants** — o mesmo contato pode pertencer a
   clientes de empresas diferentes (é o caso normal do SaaS, já documentado no
   cabeçalho de `customers/infrastructure/schema.ts`). Existindo ou não,
   a resposta na tela é **idêntica** (item 17: não vazar existência por tempo
   de resposta nem por texto).

2. **Emissão do link.** Para cada `(customer, tenant)` encontrado, cria-se um
   `portal_login_tokens` com token opaco de 256 bits (mesmo CSPRNG de
   `session-service.ts`), hash-only no banco, `expiresAt` curto (15 minutos) e
   `usedAt` nulo. Nenhuma senha, nenhum segredo de longo prazo.

3. **Entrega.** O link sai pelo MESMO `CommunicationProvider` port e pela
   MESMA guarda de produção do Prompt 16 (`getCommunicationProvider()`:
   captura fora de produção, `null` sem provider real em produção — nunca um
   quinto canal ad-hoc). O que NÃO é reaproveitado é `communication_messages`:
   aquela tabela exige `unit_id NOT NULL`, e o login do Portal — como o
   próprio `Customer` — não pertence a uma unidade, pertence ao tenant. Forcar
   uma unidade nesse envio inventaria ownership que não existe só para caber
   no esquema errado. O registro e o rate limit do link vivem em
   `portal_login_tokens` (item 17), do mesmo jeito que `password_reset_tokens`
   já é a própria trilha do reset de senha interno, sem depender de uma
   tabela de mensagens.

4. **Consumo.** Clicar no link consome o token via `UPDATE ... WHERE
used_at IS NULL` (mesmo padrão CAS de ADR-044) — a corrida de duplo clique
   perde, não duplica sessão. Token consumido, expirado ou de outro tenant
   resulta no mesmo erro genérico.

5. **Sessão do Portal.** Nova tabela `portal_sessions`, cookie próprio
   (`nexo56_portal_session`, **nunca** `nexo56_session`), TTL mais curto que a
   sessão interna. Mesmo par hash-SHA-256 + `timingSafeEqual` de
   `session-service.ts`, copiado conceitualmente — **nunca** a mesma tabela,
   **nunca** o mesmo cookie, para que revogar uma nunca revogue a outra e para
   que um bug de leitura de cookie não misture os dois mundos.

6. **Multi-tenant e multi-identidade.** Um cookie de sessão do Portal resolve
   exatamente um `(customer_id, tenant_id)`. Cliente com cadastro em duas
   empresas troca de sessão trocando de link — nunca há um único login que
   "escolhe a empresa depois", porque isso reintroduziria por acidente um
   `TenantContext`-like decidido no cliente (o mesmo erro que a ADR original
   de tenancy já recusa para usuário interno).

## Por que isto não é o mesmo código do login interno, com nomes trocados

A tentação de generalizar `session-service.ts` para aceitar os dois tipos de
sujeito foi considerada e rejeitada. `createSession` grava `userId` que
referencia `users` por FK; forçar um `customerId` na mesma coluna exigiria uma
FK polimórfica (perde integridade referencial) ou uma coluna nula com
significado trocado (perde clareza). Duas tabelas pequenas e paralelas custam
uma migration; uma tabela ambígua custa um bug de autorização cedo ou tarde.

## Consequência

Revogar todas as sessões do Portal de um cliente nunca deixa órfã nenhuma
sessão interna, e vice-versa. Desligar `customer.portal` (Prompt 17,
Decisão de feature) não precisa saber nada sobre `sessions`. Um `Customer`
nunca ganha `tenantPermissions`, porque a estrutura que carrega isso —
`TenantContext` — não existe no caminho do Portal em lugar nenhum.
