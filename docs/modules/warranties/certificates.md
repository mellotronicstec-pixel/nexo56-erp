# Certificado de garantia

## O que ele é

Um **snapshot** dos termos no momento da emissão, guardado como JSON em
`warranty_certificates.snapshot`, com `checksum` SHA-256 do conteúdo.

`buildSnapshot()` lê a **garantia**, nunca a política — e o módulo do
certificado **não importa** `warranty_policies` em lugar nenhum. Isso é
verificado por teste de fronteira, não por disciplina.

## O que ele NÃO é: PDF

**Não há geração de PDF neste prompt.** O certificado existe como HTML com
snapshot e soma de verificação; o navegador imprime.

O que ficou preparado: `format` é coluna (`CERTIFICATE_FORMATS = ['html']`) e o
snapshot é completo e determinístico. Um provider futuro lê o **mesmo** snapshot
e grava `format = 'pdf'` sem tocar em nada já emitido.

Chamar o HTML de PDF seria prometer um arquivo que o sistema não gera.

## Gerar de novo ≠ reemitir

`issueCertificate` devolve **o mesmo documento com o mesmo token** quando já
existe. O QR já impresso continua válido. A tela diz "Gerar novamente", não
"Reemitir".

## O token

```ts
CERTIFICATE_TOKEN_BYTES = 24;            // randomBytes → base64url
certificatePathFor(token) => `/garantias/certificado/${token}`
```

O QR carrega **apenas** o token. Nunca CPF, telefone, endereço, e-mail, serial
completo nem o id do cliente: um QR é uma imagem que qualquer pessoa na fila do
balcão consegue fotografar, e o que estiver dentro dele vazou no instante em que
foi impresso.

O token não é enumerável — não é "certificado 124".

## O token identifica; ele não autoriza

`findCertificateByToken` exige `TenantContext` e só devolve certificado daquele
tenant. A rota `/garantias/certificado/[token]` está atrás do mesmo
`requireAccessForPage` de qualquer outra tela, exigindo a feature
`operations.warranties` e a permissão `warranties.view`.

Token de outra empresa e token inexistente terminam no mesmo lugar: `notFound`.

## Conteúdo do snapshot

```ts
interface CertificateSnapshot {
  emitidoEm: string;
  empresa: { nome: string; unidade: string };
  garantia: {
    numero: string;
    tipo: string;
    vigencia: { inicio: string; fim: string };
    duracao: string;
    cobreServicoInteiro: boolean;
  };
  cliente: { nome: string };
  equipamento: { descricao: string; marca: string | null; modelo: string | null };
  ordemDeServico: { numero: number } | null;
  cobertura: Array<{ tipo: string; descricao: string }>;
  exclusoes: string | null;
  termos: string | null;
}
```

O nome do cliente aparece porque o documento é dele; nenhum outro dado pessoal
entra.

## O certificado não reflete o presente

Se a garantia for revogada amanhã, o certificado continua dizendo o que foi
prometido hoje — é exatamente para isso que ele existe. A página avisa e liga
para a ficha da garantia, que mostra a situação atual.
