import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { getEnv } from '@/core/config/env';
import { ValidationError } from '@/core/errors';

/**
 * Armazenamento de arquivos (Prompt 06, itens 26 a 29).
 *
 * POR QUE UMA ABSTRACAO, E NAO `fs` DIRETO NO DOMINIO
 *
 * A primeira versao roda na hospedagem compartilhada da Hostinger, onde o que
 * existe e disco local. Mas object storage, S3 e CDN entram na conta assim que
 * o volume crescer, e nesse dia o dominio nao pode precisar saber. Por isso o
 * modulo de Equipamentos conhece `FileStorageProvider` — uma interface com
 * quatro operacoes — e nunca um caminho de arquivo.
 *
 * O BINARIO NAO VAI PARA O BANCO (item 28). O MariaDB guarda metadados e a
 * CHAVE; os bytes ficam com o provider. Foto de equipamento em BLOB inflaria
 * backup, replicacao e memoria de cada consulta.
 *
 * NADA FICA EM `public/` (item 32). Arquivo em diretorio publico e acessivel
 * por quem descobrir a URL, e foto de equipamento pode conter nota fiscal,
 * etiqueta com dados do cliente ou o interior da casa de alguem. O acesso
 * passa por rota autenticada, que confere tenant e permissao.
 */

export interface StoredFile {
  /** Chave opaca. E o que o banco guarda; nunca e caminho absoluto. */
  key: string;
  byteSize: number;
  /** SHA-256 do conteudo — deteccao de duplicata e verificacao de integridade. */
  checksum: string;
}

export interface FileStorageProvider {
  save(input: { data: Buffer; extension: string; scope: string }): Promise<StoredFile>;
  read(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
  /** Nome do provider, para log e diagnostico. */
  readonly name: string;
}

/**
 * Chave segura, gerada pelo servidor (item 29).
 *
 * NUNCA deriva do nome enviado pelo navegador. `../../etc/passwd` e
 * `foto.jpg.php` sao nomes validos do ponto de vista do cliente, e ambos sao
 * ataques. A chave e `<escopo>/<aleatorio>.<extensao conhecida>`, e o escopo
 * so aceita caracteres inofensivos.
 */
function buildKey(scope: string, extension: string): string {
  const safeScope = scope.replace(/[^a-zA-Z0-9/_-]/g, '');
  if (!safeScope || safeScope.includes('..')) {
    throw new ValidationError('Escopo de armazenamento invalido.');
  }

  const safeExtension = extension.replace(/[^a-z0-9]/g, '').slice(0, 5);
  const random = randomBytes(16).toString('hex');
  return `${safeScope}/${random}.${safeExtension}`;
}

/**
 * Disco local.
 *
 * A raiz vem de `STORAGE_ROOT` e fica FORA de `public/`. Toda leitura e escrita
 * resolve o caminho e confere que ele continua dentro da raiz: mesmo que uma
 * chave adulterada chegue ate aqui, ela nao sai do diretorio permitido.
 */
export class LocalDiskStorage implements FileStorageProvider {
  readonly name = 'local-disk';

  constructor(private readonly root: string) {}

  private absolutePath(key: string): string {
    const target = resolve(this.root, key);
    const rootWithSep = resolve(this.root) + sep;

    // Ultima barreira contra path traversal, depois da chave ja ser gerada
    // pelo servidor: defesa em profundidade custa uma comparacao de string.
    if (!target.startsWith(rootWithSep)) {
      throw new ValidationError('Caminho de arquivo invalido.');
    }
    return target;
  }

  async save({
    data,
    extension,
    scope,
  }: {
    data: Buffer;
    extension: string;
    scope: string;
  }): Promise<StoredFile> {
    const key = buildKey(scope, extension);
    const target = this.absolutePath(key);

    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, data);

    return {
      key,
      byteSize: data.byteLength,
      checksum: createHash('sha256').update(data).digest('hex'),
    };
  }

  async read(key: string): Promise<Buffer> {
    return readFile(this.absolutePath(key));
  }

  async remove(key: string): Promise<void> {
    await unlink(this.absolutePath(key)).catch((error: NodeJS.ErrnoException) => {
      // Arquivo ja ausente e sucesso: a operacao e idempotente (item 119).
      if (error.code !== 'ENOENT') throw error;
    });
  }
}

let provider: FileStorageProvider | null = null;

export function getFileStorage(): FileStorageProvider {
  if (!provider) {
    provider = new LocalDiskStorage(join(process.cwd(), getEnv().STORAGE_ROOT));
  }
  return provider;
}

/** Troca o provider. Existe para teste; producao usa o padrao. */
export function setFileStorageForTesting(next: FileStorageProvider | null): void {
  provider = next;
}
