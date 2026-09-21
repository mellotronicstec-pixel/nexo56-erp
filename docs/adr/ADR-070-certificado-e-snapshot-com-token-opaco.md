# ADR-070 — Certificado é snapshot com token opaco

**Status:** Aceito — a seção "PDF" foi superada pelo
[ADR-072](ADR-072-pdf-do-certificado-e-programatico.md)
**Data:** Prompt 13 — Garantias
**Itens atendidos:** 18, 19, 20, 21, 61

> **Evolução (Prompt 13.1).** Quando este ADR foi escrito, não havia geração de
> PDF, e ele registrou essa ausência em vez de disfarçá-la. O Prompt 13.1
> implementou a geração real, exatamente pelo caminho que a seção "O que NÃO foi
> feito" previa: um renderizador que lê **o mesmo snapshot** e grava
> `format`, sem tocar em nada já emitido. Tudo o mais neste documento —
> snapshot como autoridade, token opaco, "o token identifica, não autoriza" —
> continua valendo e agora vale também para o arquivo.

## Contexto

O cliente leva um papel. Esse papel precisa dizer, seis meses depois, exatamente
o que foi prometido — mesmo que a política da loja tenha mudado, a garantia
tenha sido revogada e o texto padrão tenha sido reescrito duas vezes.

E, cada vez mais, esse papel tem um QR.

## Decisão: o documento é um snapshot com soma de verificação

`warranty_certificates` guarda o documento **inteiro** como JSON
(`snapshot`), mais um `checksum` SHA-256 do conteúdo. `buildSnapshot()` lê a
**garantia**, nunca a política (ADR-062) — e um teste de fronteira verifica que
o módulo do certificado não importa `warranty_policies`.

Gerar o certificado de novo devolve **o mesmo documento**, com **o mesmo
token**: o QR já impresso continua válido. Não é "reemissão"; é reimpressão.

## Decisão: o token é opaco e não enumerável

```ts
export const CERTIFICATE_TOKEN_BYTES = 24; // randomBytes → base64url
export function certificatePathFor(token: string): string {
  return `/garantias/certificado/${token}`;
}
```

O QR carrega **apenas** o token. Nunca CPF, telefone, endereço, e-mail, serial
completo nem o id do cliente: um QR é uma imagem que qualquer pessoa na fila do
balcão consegue fotografar, e o que estiver dentro dele vazou no instante em que
foi impresso.

O token também não é sequencial — "certificado 124" convidaria a varrer a faixa
inteira.

## O token identifica; ele NÃO autoriza

`findCertificateByToken` exige `TenantContext` e só devolve certificado daquele
tenant. A rota que o resolve está atrás do mesmo `requireAccessForPage` de
qualquer outra tela. Quem fotografou o QR não ganha acesso a nada sem sessão
válida.

Token de outra empresa e token inexistente terminam no mesmo lugar: `notFound`.

## O que não havia quando este ADR foi escrito: PDF

> Superado pelo [ADR-072](ADR-072-pdf-do-certificado-e-programatico.md). O
> texto abaixo é preservado como registro da decisão original.

**Não há geração de PDF.** O certificado existe como HTML com snapshot e
checksum; o navegador imprime. `format` é coluna (`CERTIFICATE_FORMATS =
['html']`) e o snapshot é completo e determinístico, então um provider futuro lê
o **mesmo** snapshot e grava `format = 'pdf'` sem tocar em nada já emitido.

Chamar o HTML de "PDF" seria prometer um arquivo que o sistema não gera. A
alternativa — adicionar uma dependência pesada de renderização agora — não foi
tomada neste prompt.

## Consequências

**Ganhamos:** um documento que não muda sozinho, verificável por checksum, e um
QR que não vaza dado pessoal.

**Pagamos:** o snapshot ocupa alguns KB por certificado, e "imprimir" depende do
navegador do usuário.
