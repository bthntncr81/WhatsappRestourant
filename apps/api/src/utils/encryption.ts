import crypto from 'crypto';
import { getConfig } from '@whatres/config';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;

function getKey(): Buffer {
  const config = getConfig();
  const key = config.encryption.key;
  if (!key) {
    throw new Error('ENCRYPTION_KEY is not configured');
  }
  return Buffer.from(key, 'hex');
}

export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const authTag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`;
}

export function decrypt(encryptedStr: string): string {
  const key = getKey();
  const [ivB64, authTagB64, ciphertext] = encryptedStr.split(':');
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(ciphertext, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

export function maskSecret(value: string, visibleChars = 6): string {
  if (value.length <= visibleChars) return '****';
  return value.substring(0, visibleChars) + '****';
}
