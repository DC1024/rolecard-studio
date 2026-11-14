import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const MASTER_KEY_BYTES = 32;
const IV_BYTES = 12;
const PAYLOAD_PREFIX = 'v1';

/**
 * Loads an existing 32-byte master key or generates one with 0600 permissions.
 */
export async function loadOrCreateMasterKey(keyFilePath: string): Promise<Buffer> {
  try {
    const existing = await readFile(keyFilePath);
    if (existing.length === MASTER_KEY_BYTES) {
      return existing;
    }
    const decoded = Buffer.from(existing.toString('utf8').trim(), 'base64');
    if (decoded.length === MASTER_KEY_BYTES) {
      return decoded;
    }
    throw new Error(`Invalid master key length in ${keyFilePath}`);
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
  }

  await mkdir(dirname(keyFilePath), { recursive: true });
  const key = randomBytes(MASTER_KEY_BYTES);
  await writeFile(keyFilePath, key.toString('base64'), { mode: 0o600, encoding: 'utf8' });
  try {
    await chmod(keyFilePath, 0o600);
  } catch {
    // Windows NTFS ignores POSIX chmod bits; ignore safely.
  }
  return key;
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}

export function encryptSecret(plaintext: string, masterKey: Buffer): string {
  if (masterKey.length !== MASTER_KEY_BYTES) {
    throw new Error('Master key must be 32 bytes');
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', masterKey, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    PAYLOAD_PREFIX,
    iv.toString('base64'),
    tag.toString('base64'),
    encrypted.toString('base64'),
  ].join(':');
}

export function decryptSecret(payload: string, masterKey: Buffer): string {
  if (masterKey.length !== MASTER_KEY_BYTES) {
    throw new Error('Master key must be 32 bytes');
  }
  const parts = payload.split(':');
  if (parts.length !== 4 || parts[0] !== PAYLOAD_PREFIX) {
    throw new Error('Invalid encrypted secret format');
  }
  const [, ivB64, tagB64, dataB64] = parts;
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error('Incomplete encrypted secret payload');
  }

  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const encrypted = Buffer.from(dataB64, 'base64');

  const decipher = createDecipheriv('aes-256-gcm', masterKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

/**
 * Masks any secret leaving only the last 4 characters (e.g. "****1234").
 */
export function maskSecret(secret: string | null | undefined): string | null {
  if (!secret || secret.trim().length === 0) {
    return null;
  }
  const trimmed = secret.trim();
  if (trimmed.length <= 4) {
    return '****';
  }
  return `****${trimmed.slice(-4)}`;
}

export function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

export function generateRandomToken(byteLength = 32): string {
  return randomBytes(byteLength).toString('base64url');
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') {
    return false;
  }
  const [, salt, hexDigest] = parts;
  if (!salt || !hexDigest) {
    return false;
  }
  const expected = Buffer.from(hexDigest, 'hex');
  const actual = scryptSync(password, salt, 64);
  if (expected.length !== actual.length) {
    return false;
  }
  return timingSafeEqual(expected, actual);
}
