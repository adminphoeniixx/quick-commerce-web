// AES-256-GCM envelope encryption for connector secrets (platform credentials).
// Secrets are NEVER stored in plaintext; only the output of encryptSecret() is.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function key(): Buffer {
  const b64 = process.env.CONNECTION_ENC_KEY;
  if (!b64) throw new Error("CONNECTION_ENC_KEY is not set");
  const k = Buffer.from(b64, "base64");
  if (k.length !== 32) throw new Error("CONNECTION_ENC_KEY must be 32 bytes (base64)");
  return k;
}

// Format: v1.<iv>.<authTag>.<ciphertext>  (all base64url)
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(".");
}

export function decryptSecret(blob: string): string {
  const [v, ivB64, tagB64, ctB64] = blob.split(".");
  if (v !== "v1" || !ivB64 || !tagB64 || !ctB64) throw new Error("Malformed encrypted secret");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64url")), decipher.final()]).toString("utf8");
}
