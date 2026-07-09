import {
  generateNonce,
  verifyAuthResponse,
  createAuthResponse,
  AUTH_TIMEOUT_MS,
  PROTOCOL_VERSION,
} from "@cc-room/shared";
import type { AuthMessage } from "@cc-room/shared";
import { createChildLogger } from "./logger.js";

const log = createChildLogger("auth");

export interface AuthResult {
  success: boolean;
  identity?: string;
  reason?: string;
}

export function createChallenge(): { nonce: string; message: object } {
  const nonce = generateNonce();
  return {
    nonce,
    message: {
      type: "challenge",
      nonce,
    },
  };
}

export function buildAuthMessage(
  secret: string,
  nonce: string,
  identity: string,
  roomId: string,
): AuthMessage {
  return {
    v: PROTOCOL_VERSION,
    id: "",
    ts: new Date().toISOString(),
    type: "auth",
    room_id: roomId,
    sender: identity,
    identity,
    response: createAuthResponse(secret, nonce, identity),
    supported_versions: [PROTOCOL_VERSION],
  };
}

export function verifyAuth(
  secret: string,
  nonce: string,
  authMsg: AuthMessage,
): AuthResult {
  if (!authMsg.identity || !authMsg.response) {
    log.warn("Auth message missing identity or response");
    return { success: false, reason: "Missing identity or response" };
  }

  const valid = verifyAuthResponse(
    secret,
    nonce,
    authMsg.identity,
    authMsg.response,
  );

  if (!valid) {
    log.warn({ identity: authMsg.identity }, "Auth failed: invalid HMAC");
    return { success: false, reason: "Invalid credentials" };
  }

  log.info({ identity: authMsg.identity }, "Auth successful");
  return { success: true, identity: authMsg.identity };
}

export { AUTH_TIMEOUT_MS };
