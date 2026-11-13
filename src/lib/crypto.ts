import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM for OAuth tokens at rest. TOKEN_ENC_KEY = 32 random bytes, base64.
 * Format: v1.<iv>.<tag>.<ciphertext> (all base64url).
 */
function key(): Buffer {
  // Local dev only (like AUTH_SECRET/APP_PASSWORD): a fixed throwaway key so links and tokens work without setup.
  const raw = process.env.TOKEN_ENC_KEY ?? (process.env.NODE_ENV !== "production" ? Buffer.alloc(32, "nora-hq-dev-only").toString("base64") : undefined);
  if (!raw) throw new Error("TOKEN_ENC_KEY is not set (generate with: openssl rand -base64 32)");
  const k = Buffer.from(raw, "base64");
  if (k.length !== 32) throw new Error("TOKEN_ENC_KEY must decode to 32 bytes");
  return k;
}

export function encryptJson(value: unknown): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([c.update(JSON.stringify(value), "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

export function decryptJson<T>(payload: string): T {
  const [v, iv, tag, ct] = payload.split(".");
  if (v !== "v1") throw new Error("Unknown token encoding");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8")) as T;
}
