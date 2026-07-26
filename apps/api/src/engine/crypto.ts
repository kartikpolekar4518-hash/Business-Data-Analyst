import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";
import { env } from "../env.js";

// Reversible encryption for connector credentials. API keys use bcrypt (one-way)
// because they're only ever compared; connectors must *use* the stored secret to
// open a connection, so we need AES-256-GCM with a symmetric key.
//
// Format: base64(iv[12] | authTag[16] | ciphertext), colon-prefixed with "v1".

// A 32-byte key derived from CONNECTOR_ENCRYPTION_KEY. Hashing lets us accept a
// key of any length (hex, base64 or a passphrase) while always feeding AES 32 bytes.
const KEY = createHash("sha256").update(env.connectorEncryptionKey).digest();

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${Buffer.concat([iv, tag, ciphertext]).toString("base64")}`;
}

export function decrypt(blob: string): string {
  const [version, payload] = blob.split(":");
  if (version !== "v1" || !payload) throw new Error("Unrecognized secret format");
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
