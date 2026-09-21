# Certificado de garantia

## O que ele é

Um **snapshot** dos termos no momento da emissão, guardado como JSON em
`warranty_certificates.snapshot`, com `checksum` SHA-256 do conteúdo.

`buildSnapshot()` lê a **garantia**, nunca a política — e o módulo do
certificado **não importa** `warranty_policies` em lugar nenhum. Isso é
verificado por teste de fronteira, não por disciplina.

## O PDF (Prompt 13.1)

**Existe um `application/pdf` de verdade**, gerado no servidor a partir do mesmo
snapshot, em A4, guardado uma vez e reutilizado. Ver
[ADR-072](../../adr/ADR-072-pdf-do-certificado-e-programatico.md).

- **Renderizador:** `@cantoo/pdf-lib` — JavaScript puro, sem binário externo,
  sem Chromium, sem serviço separado. Roda na hospedagem compartilhada.
- **Camadas:** `snapshot → CertificateDocument → WarrantyCertificatePdfRenderer
→ bytes`. O domínio declara a interface; só
  `infrastructure/pdf/` conhece a biblioteca, e um teste de fronteira falha o
  build se isso mudar.
- **QR:** desenhado como retângulos vetoriais a partir de
  `qrcode-generator`, carregando **apenas** o endereço com o token opaco.
- **Determinismo:** o mesmo snapshot produz os **mesmos bytes** — metadados
  fixados em `issuedAt` e `updateMetadata: false`. Testado.
- **Fontes:** as padrão do PDF. Sora e Inter chegam via `next/font/google`, que
  as baixa no build para o navegador — não há arquivo no repositório para
  embutir, e buscar fonte pela rede durante a geração é proibido. WinAnsi cobre
  todo o português; testado com `João Gonçalves`, `Márcia Araújo` e
  `Assistência Técnica São José`.
- **Logotipo:** nenhum. Os ativos oficiais ainda não foram entregues e a marca
  não é reconstruída com fonte. O documento identifica a **empresa** que
  concedeu a garantia.

### Armazenamento e idempotência

O arquivo vai para a abstração de storage já existente, com chave opaca
(`warranty-certificates/<aleatório>.pdf`) — **sem PII no caminho**, fora de
`public/`.

As colunas de PDF vivem na linha do certificado. `pdf_checksum` é dos **bytes**;
`checksum` continua sendo o do **snapshot** — um prova que o arquivo não foi
trocado, o outro que o documento não mudou.

Dez cliques produzem **um** artefato. Cinco gerações simultâneas também: a
gravação usa compare-and-swap sobre `pdf_storage_key`, quem perde apaga o
próprio arquivo, e o resultado foi verificado em MariaDB real.

### Regeneração

Arquivo apagado, ausente ou corrompido (checksum divergente) é **regerado a
partir do snapshot histórico**, nunca da política atual. Certificados emitidos
antes do Prompt 13.1 geram PDF sem reemitir a garantia: mesmo id, mesmo token,
mesmo snapshot.

### Download

`GET /api/garantias/[warrantyId]/certificado/pdf`, com
`Content-Type: application/pdf`, `Content-Disposition: attachment` e nome
derivado do **número da garantia** — nunca do nome do cliente.

Possuir a URL não autoriza: a rota exige sessão, a feature `operations.warranties`,
a permissão `warranties.view` e que a garantia seja de uma unidade autorizada.
Garantia de outra empresa responde 404, igual a inexistente.

A permissão é a mesma de **ver** o certificado, de propósito: o PDF não revela
nada além do que a pessoa já lê na tela. Criar `warranties.pdf.download` seria
permissão por botão.

### O HTML continua existindo

A página do certificado não foi removida. Ela serve para conferir na hora e
imprimir pelo navegador; o PDF serve para guardar, anexar e entregar. A interface
oferece as duas ações e não chama uma de outra.

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

## Por que isto funciona na Hostinger

A hospedagem inicial é compartilhada. A solução escolhida respeita esse
ambiente por construção:

| Exigência descartada       | Por quê                                                                    |
| -------------------------- | -------------------------------------------------------------------------- |
| Chromium / Puppeteer       | ~150 MB de binário, memória e controle de processo que o plano não oferece |
| LibreOffice / wkhtmltopdf  | binário de sistema sem garantia de disponibilidade                         |
| Serviço de renderização    | seria um segundo processo para manter                                      |
| Docker, VPS, Redis, worker | infraestrutura antes do primeiro cliente                                   |
| Serviço externo de PDF     | dado do cliente saindo do servidor                                         |

O que a geração usa: **Node e nada mais**. `@cantoo/pdf-lib` é JavaScript puro e
não lê arquivo algum em tempo de execução — nem métricas de fonte, nem
configuração. Um teste de fronteira falha o build se `puppeteer` ou `playwright`
aparecerem em `src/`.

### Armazenamento

O arquivo usa a abstração `FileStorageProvider` já existente (Prompt 06), hoje
implementada por `LocalDiskStorage` sob `STORAGE_ROOT`, **fora de `public/`**.
Nada de storage paralelo.

Em hospedagem compartilhada esse diretório é persistente — é o mesmo lugar onde
já vivem as fotos de equipamento. Se a implantação mudar para um ambiente de
sistema de arquivos efêmero, **o certificado não se perde**: o PDF é artefato
derivado, e o snapshot no banco o regenera. Essa é a diferença prática entre
guardar o documento e guardar o arquivo.

### Backup

O PDF **não precisa** entrar no backup para que nada se perca: o que é
insubstituível é `warranty_certificates.snapshot`, que vive no banco. Incluir o
diretório no backup economiza a regeração; excluí-lo custa apenas processamento
na primeira vez que alguém baixar. Nenhuma rotina de backup foi implementada
neste complemento — a decisão fica registrada para quem a escrever.
