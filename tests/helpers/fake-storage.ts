import type { FileStorageProvider, StoredFile } from '@/core/storage/file-storage';
import { createHash, randomBytes } from 'node:crypto';

/**
 * Storage em memoria para teste.
 *
 * Existe para que os testes exercitem o CONTRATO do provider sem tocar o
 * disco: um teste que escreve arquivo de verdade deixa lixo entre execucoes e
 * falha em paralelo. Tambem prova, na pratica, que o dominio nao depende do
 * disco — trocar de provider e trocar esta classe.
 */
export class InMemoryStorage implements FileStorageProvider {
  readonly name = 'in-memory';
  readonly files = new Map<string, Buffer>();

  async save({
    data,
    extension,
    scope,
  }: {
    data: Buffer;
    extension: string;
    scope: string;
  }): Promise<StoredFile> {
    const key = `${scope}/${randomBytes(8).toString('hex')}.${extension}`;
    this.files.set(key, data);
    return {
      key,
      byteSize: data.byteLength,
      checksum: createHash('sha256').update(data).digest('hex'),
    };
  }

  async read(key: string): Promise<Buffer> {
    const data = this.files.get(key);
    if (!data) throw new Error(`arquivo inexistente: ${key}`);
    return data;
  }

  async remove(key: string): Promise<void> {
    this.files.delete(key);
  }
}

/** JPEG minimo valido, com as dimensoes declaradas no SOF0. */
export function makeJpeg(width = 60, height = 40): Buffer {
  const sof = Buffer.alloc(11);
  sof.writeUInt16BE(0xffc0, 0);
  sof.writeUInt16BE(9, 2);
  sof.writeUInt8(8, 4);
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), sof, Buffer.from([0xff, 0xd9])]);
}
