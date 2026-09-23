# Portal do Cliente — segurança

## Negação é sempre 404

Não existe `403` em rota nenhuma do Portal. `assertOwned` (em
`portal-ownership.ts`) é o único ponto de negação de toda a camada de
aplicação, e ele sempre lança `NotFoundError`. Um registro que existe mas é
de outro cliente responde **exatamente** a mesma coisa que um registro que
nunca existiu — mesma classe de erro, mesma mensagem, mesmo tempo de
resposta relativo. Um teste de fronteira recusa qualquer `status: 403` sob
`src/app/api/portal/` e `src/app/portal/`.

## IDOR e enumeração

Toda consulta em `portal-query-service.ts` e
`portal-warranty-certificate-service.ts` filtra por `tenantId` **e**
`customerId` no `WHERE` — nunca "busca por id e confere depois". Um id
trocado na URL (`/portal/ordens/<id-de-outro-cliente>`) não encontra linha
nenhuma, porque a condição de posse já está na consulta.

`requestPortalLogin` aplica a mesma disciplina no sentido contrário: a
função sempre devolve `void`, sempre no mesmo tempo relativo, exista ou não
o contato — quem tenta descobrir e-mails cadastrados por tentativa e erro
não aprende nada pela resposta.

## Rate limit

`RATE_LIMITS.portalLoginRequest` — 3 pedidos a cada 10 minutos, por contato
normalizado. Aplicado **antes** de qualquer consulta ao banco, igual ao rate
limit do login interno.

## Concorrência

- **Consumo do link**: `UPDATE portal_login_tokens SET used_at = NOW() WHERE
id = ? AND used_at IS NULL AND expires_at > NOW()` — CAS clássico (ADR-044).
  Duplo clique, ou o link aberto em duas abas, só cria UMA sessão; a segunda
  tentativa recebe o mesmo erro genérico de link inválido.
- **Identidade**: `INSERT ... ON DUPLICATE KEY UPDATE` com
  `first_authenticated_at = COALESCE(first_authenticated_at, ?)` — dois
  primeiros logins simultâneos do mesmo cliente não duplicam a identidade
  nem sobrescrevem a data do primeiro acesso.

## Reavaliação a cada requisição (nunca cache de autorização)

`loadPortalContextForSession` relê, em toda chamada: status do `Customer`,
status da `PortalIdentity` e a feature `customer.portal` — nada disso fica
guardado na sessão. Desligar o módulo, inativar o cliente ou bloquear a
identidade derruba o **próximo** acesso, não espera o token expirar.

## Cache HTTP

O download do certificado responde `Cache-Control: private, no-store` — o
mesmo cabeçalho da rota interna equivalente. Documento de um cliente nunca
fica em cache compartilhado (proxy, CDN, cache do navegador em disco
partilhado).

As páginas HTML do Portal (`/portal`, `/portal/ordens/[id]`,
`/portal/equipamentos`, `/portal/garantias`) não fixam um `Cache-Control`
manual — e não precisam: toda página chama `requirePortalContextForPage`,
que lê `cookies()`, o que força o Next.js App Router a tratar a rota como
dinâmica. Verificado empiricamente contra o build de produção real
(`next build && next start`, nunca `next dev`): toda rota dinâmica —
Portal e interna, autenticada e não autenticada — responde com
`Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate`,
idêntico ao que uma rota interna equivalente (`/login`) já recebe sem
nenhuma configuração manual. Esse cabeçalho é estritamente mais restritivo
que `private, no-store` sozinho, então adicionar um `Cache-Control` manual
nas páginas não mudaria o comportamento observado — apenas duplicaria, em
código, o que o framework já garante por padrão para qualquer rota que leia
a sessão a cada requisição.

## O que nunca vaza

| Dado                                    | Por quê fica de fora                                                                                         |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `service_orders.internal_notes`         | Campo do PRÓPRIO schema já documenta: "não pode vazar para o Portal"                                         |
| Linha do tempo fora da allowlist        | Técnico responsável, estoque e tarefa de bancada são operação interna                                        |
| Número de série completo                | Mesma razão do certificado de garantia: identifica o aparelho de forma única, sem necessidade para o cliente |
| `warranty_costs`                        | Não tem projeção nenhuma — o Portal nem consulta a tabela                                                    |
| Garantia `draft`                        | Trabalho em andamento de quem concede, ainda não é fato do cliente                                           |
| Existência de contato em outro tenant   | `requestPortalLogin` nunca diferencia a resposta                                                             |
| Existência de registro de outro cliente | `assertOwned` sempre devolve `NotFoundError`                                                                 |

## Provedor de e-mail/WhatsApp: mesma guarda de produção

O link magico sai por `getCommunicationProvider()` — o mesmo port do Prompt 16. Fora de produção, provedor de captura (não toca a rede). Em produção sem
provedor real configurado, `null`: o link fica registrado em
`portal_login_tokens`, o cliente pode pedir de novo quando houver provedor,
e o sistema nunca afirma ter enviado o que não enviou.
