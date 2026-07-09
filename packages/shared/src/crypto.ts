import { createHmac, randomBytes, timingSafeEqual, scryptSync } from "node:crypto";
import { NONCE_BYTES, SECRET_BYTES } from "./constants.js";
import type { SignedEnvelope } from "./types/protocol.js";

export function generateRoomSecret(): string {
  return randomBytes(SECRET_BYTES).toString("base64url");
}

export function generateRoomPin(): string {
  const bytes = randomBytes(4);
  const num = (bytes.readUInt32BE(0) % 900000) + 100000;
  return num.toString();
}

// scrypt でブルートフォース耐性を確保（N=2^14, r=8, p=1, keylen=32）
export function pinToSecret(pin: string, roomName: string): string {
  const salt = createHmac("sha256", "cc-room-pin-salt").update(roomName).digest();
  return scryptSync(pin, salt, 32, { N: 16384, r: 8, p: 1 }).toString("base64url");
}

export function generateNonce(): string {
  return randomBytes(NONCE_BYTES).toString("hex");
}

export function generateId(): string {
  const timestamp = Date.now();
  const random = randomBytes(10);
  const buf = Buffer.alloc(16);
  buf.writeBigUInt64BE(BigInt(timestamp), 0);
  random.copy(buf, 6);
  return buf.toString("hex");
}

export function hmacSign(secret: string, data: string): string {
  return createHmac("sha256", secret).update(data).digest("hex");
}

export function hmacVerify(secret: string, data: string, sig: string): boolean {
  const expected = hmacSign(secret, data);
  const expectedBuf = Buffer.from(expected, "hex");
  const sigBuf = Buffer.from(sig, "hex");
  if (expectedBuf.length !== sigBuf.length) return false;
  return timingSafeEqual(expectedBuf, sigBuf);
}

export function createAuthResponse(
  secret: string,
  nonce: string,
  identity: string,
): string {
  return hmacSign(secret, nonce + identity);
}

export function verifyAuthResponse(
  secret: string,
  nonce: string,
  identity: string,
  response: string,
): boolean {
  return hmacVerify(secret, nonce + identity, response);
}

export function createSignedEnvelope(
  secret: string,
  sender: string,
  message: object,
): SignedEnvelope {
  const payload = JSON.stringify(message);
  const sig = hmacSign(secret, payload);
  return { payload, sig, sender };
}

export function verifySignedEnvelope(
  secret: string,
  envelope: SignedEnvelope,
): object | null {
  if (!hmacVerify(secret, envelope.payload, envelope.sig)) {
    return null;
  }
  try {
    return JSON.parse(envelope.payload) as object;
  } catch {
    return null;
  }
}
