/**
 * Envelope encryption for OAuth tokens at rest — AES-256-GCM keyed by
 * APP_ENCRYPTION_KEY. Plaintext tokens are only ever held in memory for the
 * duration of a request; storage receives `enc.v1:<base64(iv|tag|ct)>`.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export const TOKEN_PREFIX = "enc.v1:";

/** Normalizes any configured key material to a 32-byte AES key. */
export function deriveKey(appEncryptionKey: string): Buffer {
  if (!appEncryptionKey || appEncryptionKey === "__dummy__") {
    throw new Error("APP_ENCRYPTION_KEY is not configured — refusing to encrypt with a dummy key.");
  }
  return createHash("sha256").update(appEncryptionKey, "utf8").digest();
}

export function encryptToken(plaintext: string, appEncryptionKey: string): string {
  const key = deriveKey(appEncryptionKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return TOKEN_PREFIX + Buffer.concat([iv, tag, ct]).toString("base64");
}

export function decryptToken(stored: string, appEncryptionKey: string): string {
  if (!stored.startsWith(TOKEN_PREFIX)) {
    throw new Error("Stored token is not in enc.v1 envelope format.");
  }
  const key = deriveKey(appEncryptionKey);
  const buf = Buffer.from(stored.slice(TOKEN_PREFIX.length), "base64");
  if (buf.length < 28) throw new Error("Corrupt token envelope.");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

export function isEncryptedToken(stored: string | undefined): boolean {
  return !!stored && stored.startsWith(TOKEN_PREFIX);
}
