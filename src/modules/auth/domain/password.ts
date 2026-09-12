import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto';
import { promisify } from 'node:util';

/**
 * Hashing de senha (Prompt 01, item 14).
 *
 * Algoritmo: scrypt (RFC 7914), da biblioteca padrao do Node.
 *
 * Por que scrypt e nao argon2/bcrypt: ambos exigem binario nativo compilado
 * (node-gyp ou napi pre-compilado). A hospedagem compartilhada da Hostinger
 * nao da controle sobre toolchain, glibc nem openssl, e uma incompatibilidade
 * de binario derrubaria o login inteiro. scrypt via `node:crypto` nao tem
 * dependencia nativa, e memory-hard e e recomendado pelo OWASP.
 *
 * Parametros: N=2^16, r=8, p=2 (~64 MB por verificacao), acima do minimo
 * OWASP (N=2^17/r=8/p=1 ou N=2^16/r=8/p=2).
 *
 * Formato armazenado (permite trocar de algoritmo sem migrar tudo de uma vez):
 *   scrypt$<N>$<r>$<p>$<salt-base64>$<hash-base64>
 *
 * Migracao futura: `needsRehash()` indica hashes com parametros antigos; o
 * login re-hasheia de forma transparente quando a senha correta e informada.
 */

/**
 * `promisify` perde a sobrecarga com opcoes; o tipo explicito abaixo devolve a
 * assinatura correta (password, salt, keylen, options) => Promise<Buffer>.
 */
const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

const CURRENT = { N: 2 ** 16, r: 8, p: 2, keyLength: 64, saltLength: 16 } as const;
const PREFIX = 'scrypt';
/** maxmem precisa acomodar 128 * N * r * p com folga. */
const MAX_MEM = 256 * 1024 * 1024;

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(CURRENT.saltLength);
  const derived = await scrypt(plain.normalize('NFKC'), salt, CURRENT.keyLength, {
    N: CURRENT.N,
    r: CURRENT.r,
    p: CURRENT.p,
    maxmem: MAX_MEM,
  });

  return [
    PREFIX,
    CURRENT.N,
    CURRENT.r,
    CURRENT.p,
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$');
}

interface ParsedHash {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  hash: Buffer;
}

function parse(stored: string): ParsedHash | null {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== PREFIX) return null;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return null;

  try {
    return {
      N,
      r,
      p,
      salt: Buffer.from(parts[4] as string, 'base64'),
      hash: Buffer.from(parts[5] as string, 'base64'),
    };
  } catch {
    return null;
  }
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parsed = parse(stored);
  if (!parsed) return false;

  const derived = await scrypt(plain.normalize('NFKC'), parsed.salt, parsed.hash.length, {
    N: parsed.N,
    r: parsed.r,
    p: parsed.p,
    maxmem: MAX_MEM,
  });

  if (derived.length !== parsed.hash.length) return false;
  return timingSafeEqual(derived, parsed.hash);
}

/** True quando o hash foi gerado com parametros abaixo do padrao atual. */
export function needsRehash(stored: string): boolean {
  const parsed = parse(stored);
  if (!parsed) return true;
  return parsed.N < CURRENT.N || parsed.r < CURRENT.r || parsed.p < CURRENT.p;
}

/**
 * Consome tempo equivalente a uma verificacao real.
 *
 * Usado quando o e-mail nao existe, para que a resposta do login nao revele,
 * por diferenca de tempo, se a conta existe (user enumeration).
 */
export async function simulatePasswordVerification(): Promise<void> {
  await scrypt('timing-equalizer', randomBytes(CURRENT.saltLength), CURRENT.keyLength, {
    N: CURRENT.N,
    r: CURRENT.r,
    p: CURRENT.p,
    maxmem: MAX_MEM,
  });
}
