import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

const VERSION = 1;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

export function encryptSecret(plain: string, key: Buffer): Uint8Array {
  if (key.length !== 32) throw new TypeError("master key must be 32 bytes");
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptSecret(blob: Uint8Array, key: Buffer): string {
  try {
    const data = Buffer.from(blob);
    if (key.length !== 32 || data.length < 1 + IV_LENGTH + TAG_LENGTH || data[0] !== VERSION) throw new Error();
    const iv = data.subarray(1, 1 + IV_LENGTH);
    const tag = data.subarray(1 + IV_LENGTH, 1 + IV_LENGTH + TAG_LENGTH);
    const ciphertext = data.subarray(1 + IV_LENGTH + TAG_LENGTH);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("secret could not be decrypted");
  }
}

export function consentSignature(key: Buffer, roundId: string, businessId: string, statementHash: string): string {
  return createHmac("sha256", key).update(`${roundId}:${businessId}:${statementHash}`).digest("hex");
}
