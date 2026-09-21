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

## O arquivo PDF (Prompt 13.1)

**A chave de armazenamento é opaca e não tem PII.**
`warranty-certificates/<32 hex>.pdf`, gerada pelo servidor, fora de `public/`.
Nunca CPF, telefone, nome, número de garantia nem id de tenant no caminho.

**O nome do download vem do número da garantia**, não do cliente:
`certificado-garantia-gar-000123.pdf`. O domínio o monta a partir de uma faixa
restrita de caracteres (`[a-z0-9-]`), então não há como injetar cabeçalho pelo
`Content-Disposition`.

**Possuir a URL não autoriza.** A rota exige sessão, feature, permissão
`warranties.view` e unidade autorizada — tudo verificado no backend, não na
tela. Garantia de outra empresa responde 404.

**Texto do cliente é texto, nunca comando.** `toPdfSafeText` normaliza e
substitui o que as fontes padrão não codificam; um emoji no nome do aparelho não
derruba a geração do certificado inteiro.

**O arquivo é verificado antes de ser entregue.** Bytes menores que o mínimo,
checksum divergente ou conteúdo que não começa com `%PDF-` nunca são servidos
como PDF: o documento é regerado do snapshot, e se ainda assim falhar a resposta
é erro — nunca um HTML com MIME de PDF.

**Cache privado.** `Cache-Control: private, no-store`: é o documento de um
cliente, não pode ficar em proxy compartilhado.
