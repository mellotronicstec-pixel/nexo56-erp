# Segurança e isolamento

## Tenant

Toda tabela de Garantias tem `tenant_id` com FK e, onde há relacionamento,
**FK composta** `(id, tenant_id)` contra um UNIQUE composto do outro lado. O
isolamento é do banco, não de um `WHERE` que alguém pode esquecer.

Toda consulta filtra por `context.tenantId` explicitamente. Garantia de outra
empresa e garantia inexistente terminam **no mesmo lugar** (`notFound` /
`NotFoundError`), para que a resposta não revele a existência do registro.

## Unidade

`warranties.unit_id` é FK composta contra `(units.id, units.tenant_id)`. Toda
leitura filtra por `context.authorizedUnitIds`; toda escrita autoriza com o
`unitId` **da garantia**, nunca o da unidade ativa.

Usar a unidade ativa deixaria alguém com acesso a duas lojas mexer na garantia
da loja B enquanto olha a loja A — e a lista de botões ficaria diferente do que
o caso de uso aceita.

O filtro de unidade **nunca** vem do frontend.

## Permissão

Dez chaves, verificadas por `authorize()` em cada caso de uso — não na tela. A
interface esconde o que a pessoa não pode fazer por conveniência; o backend
recusa de qualquer forma.

A autorização é sempre pela **chave de permissão**, nunca pelo nome textual do
cargo.

## O token do certificado

24 bytes aleatórios em base64url. Não é sequencial e não deriva do número da
garantia — um teste verifica que o token não contém o número nem é derivável
dele, que tem entropia e que dois certificados nunca colidem.

**O token identifica; ele não autoriza.** `findCertificateByToken` exige
`TenantContext`; a rota exige sessão, feature e permissão. Quem fotografou o QR
na fila do balcão não ganha acesso a nada.

## Dado pessoal no QR

Nenhum. O QR carrega **apenas** o token. Nunca CPF, telefone, endereço, e-mail,
serial completo nem o id do cliente.

Um QR é uma imagem que qualquer pessoa consegue fotografar, e o que estiver
dentro dele vazou no instante em que foi impresso.

## Server Actions

Todas passam por `assertSameOrigin()` antes de qualquer trabalho, e rodam dentro
de `runWithContext({ origin: 'web' })`. O contexto de tenant vem de
`requireContext()`, nunca do formulário.

Nenhuma ação lê `tenantId`, `unitId`, `status`, `classification` ou vigência do
`FormData`.

## Auditoria

Nove ações registradas **dentro da transação** que as causou — não depois, não
em `finally`. Uma transação que falha não deixa rastro de auditoria de algo que
não aconteceu.

## O que não é logado

Termos, exclusões e relato do cliente não entram em log estruturado. O log
registra ids, operação e módulo.
