# ADR-030 — Armazenamento de arquivos por trás de uma interface, fora de `public/`

**Status:** Aceito · **Data:** Prompt 06

## Contexto

Fotos de equipamento são o primeiro binário do sistema. Elas precisam ser
gravadas, lidas, removidas — e protegidas: uma foto de aparelho pode conter a
etiqueta com dados do cliente, uma nota fiscal sobre a bancada ou o interior da
casa de alguém.

A primeira versão roda em hospedagem compartilhada (ADR-012), onde o que existe
é disco local. Object storage e CDN entram na conta assim que o volume crescer.

Três caminhos óbvios, todos ruins:

1. Gravar em `public/uploads/` — simples, servido pelo próprio Next.
2. Guardar os bytes no MariaDB, em BLOB.
3. Chamar `fs` direto dentro do módulo de Equipamentos.

## Decisão

- O domínio conhece **`FileStorageProvider`** — `save`, `read`, `remove`,
  `name` — e nunca um caminho de arquivo.
- A implementação inicial é `LocalDiskStorage`, com raiz em `STORAGE_ROOT`
  (padrão `storage/`), **fora de `public/`**.
- O banco guarda metadados e a **chave**; os bytes ficam com o provider.
- A chave é gerada pelo servidor: `<escopo>/<16 bytes aleatórios hex>.<ext>`,
  com escopo `equipment/<tenant_id>`. Nunca deriva do nome enviado.
- O acesso é por rota autenticada `GET /api/midia/[mediaId]`, que confere
  sessão, permissão e tenant.

## Motivo

**`public/` é acessível a quem descobrir a URL.** Não há sessão, não há tenant,
não há como voltar atrás depois que o link circulou. Para foto de equipamento
isso é inaceitável.

**BLOB no banco** infla backup, replicação e a memória de cada consulta — e
ainda faz uma listagem distraída trazer megabytes sem querer.

**`fs` direto no domínio** amarra o módulo ao disco local. No dia do object
storage, a mudança atravessaria services, testes e páginas. Com a interface, é
um arquivo novo.

**A chave gerada pelo servidor** fecha a classe de ataque do nome de arquivo:
`../../etc/passwd` e `foto.jpg.php` são nomes válidos do ponto de vista do
cliente, e ambos são ataques. Mesmo assim, `LocalDiskStorage` ainda resolve o
caminho e confere que ele continua dentro da raiz — defesa em profundidade custa
uma comparação de string.

## Consequências

- Servir imagem passa pela aplicação, não pelo servidor estático: há custo por
  requisição. Mitigado com `Cache-Control: private, max-age=300,
must-revalidate`.
- Mídia de outro tenant responde **404**, não 403: um 403 confirmaria que aquela
  imagem existe.
- A remoção apaga a linha na transação e o arquivo **depois do commit**. Se
  fosse ao contrário e a transação falhasse, restaria registro apontando para o
  nada. `remove` é idempotente.
- Backup passa a ter duas partes (banco e diretório de storage) que precisam ser
  tiradas juntas. Está documentado em `docs/database/`.
