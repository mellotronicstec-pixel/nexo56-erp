# ADR-072 — O PDF do certificado é gerado programaticamente, não por navegador

**Status:** Aceito
**Data:** Prompt 13.1 — Certificado em PDF
**Itens atendidos:** 4, 5, 6, 7, 9, 22, 23, 24, 26, 34, 55, 88

## Contexto

O Prompt 13 entregou o certificado como página HTML com snapshot e soma de
verificação, e registrou a ausência de PDF sem eufemismo. Este complemento
elimina essa pendência.

A escolha não é "qual biblioteca eu conheço". É uma decisão de infraestrutura:
a primeira hospedagem do Nexo56 é **Hostinger Business/Unlimited**, hospedagem
compartilhada. O que for adotado aqui passa a ser requisito de produção.

## Decisão 1: renderizador programático, não Chromium

**HTML → navegador headless → _Print to PDF_ está descartado como solução de
produção.**

Puppeteer/Playwright exigem um binário de Chromium de ~150 MB, memória que o
plano compartilhado não oferece e controle de processo que a hospedagem não
concede. Adotá-los significaria **migrar para VPS antes de existir o primeiro
cliente pagante** — exatamente o que o item 4 proíbe.

O fato de Playwright já existir no projeto não muda nada: ele é ferramenta de
**verificação no navegador**, roda na máquina de desenvolvimento e não é
dependência de runtime. Um teste de fronteira falha o build se `puppeteer` ou
`playwright` aparecerem em `src/`.

Pelo mesmo motivo estão fora: LibreOffice, wkhtmltopdf, Docker em produção,
serviço de renderização separado, daemon, fila dedicada.

## Decisão 2: `@cantoo/pdf-lib`

| Candidato             | Versão | Licença | Última publicação | Veredito                                          |
| --------------------- | ------ | ------- | ----------------- | ------------------------------------------------- |
| `pdf-lib`             | 1.17.1 | MIT     | 2022-05           | **Não** — abandonada há quatro anos               |
| `@cantoo/pdf-lib`     | 2.11.1 | MIT     | 2026-09           | **Escolhida**                                     |
| `pdfkit`              | 0.20.2 | MIT     | 2026-09           | Viável, preterida                                 |
| `@react-pdf/renderer` | —      | MIT     | ativa             | Não — traz motor de layout com dependência nativa |
| Puppeteer/Playwright  | —      | Apache  | ativa             | Não — ver Decisão 1                               |

`@cantoo/pdf-lib` é o fork mantido do `pdf-lib`. Venceu `pdfkit` por três
motivos concretos:

1. **JavaScript puro, sem leitura de arquivo em tempo de execução.** `pdfkit`
   carrega métricas `.afm` do próprio diretório do pacote; sob o empacotador do
   Next isso exige `serverExternalPackages` e cria um modo de falha que só
   aparece em produção.
2. **Controle explícito dos metadados**, que é o que torna o arquivo
   reproduzível (Decisão 4).
3. **Sem dependência nativa**, sem binário, sem `postinstall`.

O preço: `@cantoo/pdf-lib` não tem motor de quebra de texto. O projeto escreve
o seu — `wrapText`, cerca de 40 linhas puras, com teste próprio, medindo com a
fonte real. É código a mais em troca de controle exato de onde a linha quebra e
da certeza de que nada sai pela margem.

O QR usa `qrcode-generator` 2.0.4 (MIT, **zero dependências**), preterindo
`qrcode` 1.5.4, que arrastaria `yargs` e `pngjs` para a árvore de produção. O
código é desenhado como **retângulos vetoriais**, não imagem embutida: imprime
nítido em qualquer resolução e evita um codificador de PNG.

`npm audit --omit=dev`: **0 vulnerabilidades**.

## Decisão 3: o snapshot é a autoridade

`ensureCertificatePdf` lê `warranty_certificates.snapshot` e **nada mais**. Não
importa `warranty_policies`, não consulta o cliente vivo, não recalcula
cobertura nem vigência. Dois testes de fronteira varrem o código-fonte, e dois
testes de comportamento alteram a política e o cadastro do cliente depois da
emissão e conferem que o arquivo não muda — nem semanticamente, nem byte a byte.

A única coisa que **não** vem do snapshot é o endereço do QR, e de propósito: o
token é imutável, o domínio da empresa não é. Congelar a URL deixaria o QR de um
certificado antigo apontando para um lugar que não existe mais.

## Decisão 4: determinismo byte a byte

`PDFDocument.create({ updateMetadata: false })` mais `setCreationDate`/
`setModificationDate` fixados em `certificate.issuedAt`.

Sem isso a biblioteca carimba `Producer` e `ModificationDate` com o instante da
gravação, e o mesmo snapshot produziria bytes diferentes a cada chamada —
destruindo o checksum estável do arquivo e, com ele, a idempotência.

**Isto é testado**, não afirmado: duas renderizações do mesmo snapshot produzem
buffers idênticos.

## Decisão 5: um artefato por versão de snapshot

`UNIQUE(warranty_id)` já garantia um certificado por garantia. O arquivo segue a
mesma disciplina: as colunas de PDF vivem **na linha do certificado**, e a
gravação usa compare-and-swap sobre `pdf_storage_key`.

Cinco gerações simultâneas produzem bytes idênticos; uma vence o CAS e as demais
**apagam o próprio arquivo**. O resultado, verificado em MariaDB real: uma
chave no banco, um arquivo novo no disco, cinco respostas válidas.

Comparar o checksum do snapshot **não** serviria como token de CAS: dois retries
de regeneração produzem bytes iguais, os dois casariam, e os dois gravariam —
deixando arquivo sem referência.

## Decisão 6: a ordem é renderizar → gravar → registrar

**O armazenamento não participa da transação do banco**, e isso é dito em vez de
disfarçado. É disco (ou, amanhã, object storage), não MariaDB.

A ordem é deliberada: renderiza, grava o arquivo, e só então registra. Se a
gravação falhar, nada é registrado e o banco continua dizendo a verdade — "não
há PDF". O pior caso é um arquivo sem referência, que não mente para ninguém. A
ordem inversa produziria uma linha apontando para um arquivo inexistente.

## Consequências

**Ganhamos:** um `application/pdf` real, em A4, gerado no servidor, sem binário
externo, sem serviço separado e sem exigir VPS. O arquivo é reproduzível,
verificável por checksum e regenerável a partir do snapshot se sumir.

**Pagamos:** duas dependências de produção; o motor de quebra de texto é nosso;
e a tipografia do documento não é a da interface (ver abaixo).

**Limitação assumida — as fontes.** A interface usa Sora e Inter via
`next/font/google`, que as baixa **no build** para servir ao navegador: não há
arquivo de fonte no repositório para embutir no PDF, e buscar fonte pela rede
durante a geração é proibido pelo item 15. O documento usa as fontes padrão do
PDF (Helvetica), cuja codificação WinAnsi cobre **todo** o português —
acentuação, til e cedilha, testados com nomes brasileiros reais. O custo é
tipográfico, não funcional. Quando houver licença e arquivo das fontes oficiais,
embuti-las é mudança local ao renderizador.

**Limitação assumida — o logotipo.** Os ativos oficiais do Nexo56 ainda não
foram entregues ao projeto, e a Constituição proíbe reconstruir a marca com
fonte. O documento identifica a **empresa que concedeu a garantia** — dado real
do snapshot — sobre uma faixa na cor institucional. Nenhum logotipo foi
inventado.
