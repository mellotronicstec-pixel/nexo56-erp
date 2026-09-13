# Fotos e armazenamento

## O caminho de uma foto

```
navegador                          servidor                        disco
---------                          --------                        -----
escolhe/tira a foto
  │
  ├─ createImageBitmap(from-image)   (corrige a orientação do EXIF)
  ├─ canvas ≤ 2000px                 (reduz)
  ├─ toBlob('image/jpeg', 0.82)      (reexporta — e com isso perde o EXIF)
  └─ envia o JPEG preparado ────────► valida magic bytes
                                      lê largura/altura do cabeçalho
                                      recusa > 8 MB
                                      grava com chave gerada ──────► <STORAGE_ROOT>/
                                      grava metadados no MariaDB      equipment/<tenant>/
                                                                      <32 hex>.jpg
```

## Preparo no navegador

`src/design-system/components/image-capture.ts`.

O ERP não usa binário nativo (ADR-003), o que descarta `sharp`. A alternativa
seria aceitar o original de 12 MP; a escolhida foi preparar a imagem no
dispositivo:

- `createImageBitmap(file, { imageOrientation: 'from-image' })` aplica a rotação
  que o EXIF pede — sem isso a foto de celular chega deitada.
- Redução para no máximo **2000px** no maior lado (`MAX_DIMENSION`), mantendo a
  proporção. Imagens menores não são ampliadas.
- Reexportação como JPEG com qualidade **0,82** (`JPEG_QUALITY`).

**O EXIF desaparece como consequência de reexportar**: o canvas escreve um
arquivo novo, com os pixels e mais nada. Não há remoção seletiva de tags — há um
arquivo diferente. Isso importa porque EXIF de celular carrega GPS, e a foto de
um aparelho pode revelar o endereço do cliente.

Verificado por teste de componente sobre `prepareImage` e, de ponta a ponta, no
E2E: um JPEG 640×480 real entra pelo caminho de arquivo, a prévia mostra as
dimensões e o tamanho resultantes, e a foto sobe. **Não** foi verificado com
câmera física nem com arquivo HEIC produzido por um iPhone.

## Validação no servidor

`src/core/storage/image-validation.ts`.

- **Magic bytes**, não extensão nem `Content-Type`: JPEG (`FF D8 FF`), PNG
  (`89 50 4E 47 0D 0A 1A 0A`), WebP (`RIFF....WEBP`). Um `.php` renomeado para
  `.jpg` não passa.
- Largura e altura lidas do cabeçalho do próprio arquivo.
- Limite de **8 MB** (`MAX_IMAGE_BYTES`).
- HEIC/HEIF é **reconhecido para ser recusado com explicação em português**, não
  convertido. Converter HEIC exigiria decodificador nativo. O caminho de
  contorno é o preparo no navegador, que entrega JPEG mesmo quando o original é
  HEIC — desde que o navegador saiba decodificar HEIC, o que nem todos sabem.
  Não há validação com arquivo HEIC real neste repositório.

## Armazenamento

`src/core/storage/file-storage.ts` define `FileStorageProvider` com quatro
operações (`save`, `read`, `remove`, `name`). O módulo de Equipamentos conhece
essa interface e **nunca um caminho de arquivo** — trocar disco local por S3 é
escrever outra implementação.

`LocalDiskStorage` grava sob `STORAGE_ROOT` (padrão `storage/`), **fora de
`public/`**.

A chave é gerada pelo servidor: `<escopo>/<16 bytes aleatórios em hex>.<ext>`,
com escopo `equipment/<tenant_id>`. Ela **nunca** deriva do nome enviado —
`../../etc/passwd` e `foto.jpg.php` são nomes válidos do ponto de vista do
cliente, e ambos são ataques. Além disso, toda leitura e escrita resolve o
caminho e confere que ele continua dentro da raiz: defesa em profundidade, mesmo
com a chave já sendo do servidor.

`remove` é idempotente: arquivo ausente é sucesso.

**Os bytes não vão para o banco.** O MariaDB guarda `storage_key`, `mime_type`,
`byte_size`, `width`, `height`, `checksum` (SHA-256) e `caption`. Foto em BLOB
inflaria backup, replicação e a memória de cada consulta.

## Entrega: rota autenticada

`GET /api/midia/[mediaId]` (`src/app/api/midia/[mediaId]/route.ts`). Cada byte
servido passa por três perguntas:

1. **Há sessão válida?** Se não → `401`.
2. **A pessoa pode ver equipamentos?** (`equipment.view` × feature
   `core.equipment`) Se não → `403`.
3. **A imagem é do tenant dela?** Se não → `404`.

O `404` para mídia de outra empresa é deliberado: um `403` confirmaria que
aquela imagem existe.

Cabeçalhos: `Cache-Control: private, max-age=300, must-revalidate` (proxy
compartilhado não guarda), `Content-Disposition: inline`,
`X-Content-Type-Options: nosniff`.

Verificado no E2E contra o build de produção: a imagem carrega com `200
image/jpeg` e `Cache-Control: private` para quem tem sessão; **`401` sem
sessão**; `404` para ID inexistente com sessão.

## Remoção

`removeMedia` apaga a linha dentro da transação (com auditoria) e só **depois do
commit** apaga o arquivo. A ordem importa: se o arquivo sumisse primeiro e a
transação falhasse, restaria um registro apontando para o nada.

## Vínculo com o recebimento

`equipment_media.intake_id` é nulo quando a foto pertence ao cadastro e
preenchido quando ela nasceu num atendimento. A foto **não muda** quando o
cadastro do equipamento é corrigido depois: ela é prova de como o aparelho
estava naquele dia.

## Privacidade

A tela orienta em texto: _"Fotografe apenas o equipamento e a etiqueta. Evite
incluir pessoas, documentos ou o ambiente ao redor."_ O sistema não consegue
impedir uma foto indevida; pode pedir a foto certa, remover a geolocalização e
manter o arquivo fora do alcance de quem não tem sessão — e é o que faz.
