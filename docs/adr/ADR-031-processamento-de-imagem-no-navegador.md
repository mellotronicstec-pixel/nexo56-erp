# ADR-031 — Preparo de imagem no navegador, não no servidor

**Status:** Aceito · **Data:** Prompt 06

## Contexto

Foto de celular moderno chega com 12 MP, vários megabytes, orientação gravada no
EXIF e — quase sempre — **coordenadas de GPS**.

Três problemas de uma vez: tamanho (conexão de loja), rotação (a foto aparece
deitada) e privacidade (o EXIF pode revelar o endereço do cliente).

A resposta convencional é processar no servidor com `sharp`. Mas o ADR-003
proíbe binário nativo: a hospedagem alvo não compila módulo nativo de forma
confiável, e uma dependência que quebra no deploy é pior que a falta dela.

## Decisão

A imagem é preparada **no navegador**, antes do upload
(`src/design-system/components/image-capture.ts`):

1. `createImageBitmap(file, { imageOrientation: 'from-image' })` — aplica a
   rotação que o EXIF pede.
2. Desenho em `canvas` reduzido para no máximo **2000px** no maior lado.
3. `canvas.toBlob(…, 'image/jpeg', 0.82)`.

O servidor **valida** o que chega — magic bytes, dimensões, limite de 8 MB — mas
não transforma.

## Motivo

Sem binário nativo, as opções no servidor eram uma biblioteca JS pura (lenta e
pesada para cada upload) ou aceitar o original. Preparar no dispositivo resolve
os três problemas com API de plataforma, sem dependência alguma.

**A remoção do EXIF vem de graça, e é a parte que mais importa.** O canvas não
edita o arquivo original: ele escreve um arquivo novo, com os pixels e mais
nada. Não há "remoção seletiva de tags" que possa falhar — há um arquivo
diferente.

Reduzir antes de subir também corta o tráfego numa conexão de loja, que
costuma ser a pior parte do fluxo.

## Consequências

- O preparo depende de JavaScript no cliente. Sem ele não há upload de foto — o
  resto do cadastro continua inteiro.
- A qualidade 0,82 é irreversível: o original não é guardado. Para foto de
  estado de entrada é suficiente; para perícia não seria.
- **HEIC** só atravessa se o navegador souber decodificá-lo. O servidor
  reconhece HEIC/HEIF para **recusar com explicação em português**, nunca para
  converter. Não há validação com arquivo HEIC real neste repositório.
- A validação por magic bytes no servidor continua obrigatória: o preparo no
  cliente é conveniência, não barreira de segurança — nada impede alguém de
  postar direto na action.
- O caminho de câmera (`capture="environment"`) e o de arquivo usam **o mesmo**
  código de preparo. Só o segundo pôde ser exercitado em teste: o navegador do
  teste não tem câmera física.
