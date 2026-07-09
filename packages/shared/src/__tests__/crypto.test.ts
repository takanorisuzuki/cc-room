import { describe, it, expect } from "vitest";
import {
  generateRoomSecret,
  generateNonce,
  generateId,
  hmacSign,
  hmacVerify,
  createAuthResponse,
  verifyAuthResponse,
  createSignedEnvelope,
  verifySignedEnvelope,
} from "../crypto.js";

describe("crypto", () => {
  describe("generateRoomSecret", () => {
    it("32バイトの base64url 文字列を生成する", () => {
      const secret = generateRoomSecret();
      expect(secret).toMatch(/^[A-Za-z0-9_-]+$/);
      const decoded = Buffer.from(secret, "base64url");
      expect(decoded.length).toBe(32);
    });

    it("呼び出しごとに異なる値を返す", () => {
      const a = generateRoomSecret();
      const b = generateRoomSecret();
      expect(a).not.toBe(b);
    });
  });

  describe("generateNonce", () => {
    it("32バイトの hex 文字列を生成する", () => {
      const nonce = generateNonce();
      expect(nonce).toMatch(/^[0-9a-f]{64}$/);
    });

    it("呼び出しごとに異なる値を返す", () => {
      const a = generateNonce();
      const b = generateNonce();
      expect(a).not.toBe(b);
    });
  });

  describe("generateId", () => {
    it("hex 文字列を返す", () => {
      const id = generateId();
      expect(id).toMatch(/^[0-9a-f]+$/);
      expect(id.length).toBe(32);
    });
  });

  describe("hmacSign / hmacVerify", () => {
    const secret = "test-secret";
    const data = "hello world";

    it("正しい署名を生成して検証できる", () => {
      const sig = hmacSign(secret, data);
      expect(sig).toMatch(/^[0-9a-f]{64}$/);
      expect(hmacVerify(secret, data, sig)).toBe(true);
    });

    it("不正な署名を拒否する", () => {
      const sig = hmacSign(secret, data);
      const tampered = sig.replace(sig[0], sig[0] === "a" ? "b" : "a");
      expect(hmacVerify(secret, data, tampered)).toBe(false);
    });

    it("異なるデータで生成した署名を拒否する", () => {
      const sig = hmacSign(secret, data);
      expect(hmacVerify(secret, "different data", sig)).toBe(false);
    });

    it("異なる secret で生成した署名を拒否する", () => {
      const sig = hmacSign(secret, data);
      expect(hmacVerify("wrong-secret", data, sig)).toBe(false);
    });
  });

  describe("createAuthResponse / verifyAuthResponse", () => {
    const secret = "room-secret-123";
    const nonce = "abc123def456";
    const identity = "yuki";

    it("正しいレスポンスを検証できる", () => {
      const response = createAuthResponse(secret, nonce, identity);
      expect(verifyAuthResponse(secret, nonce, identity, response)).toBe(true);
    });

    it("異なる identity では検証失敗する", () => {
      const response = createAuthResponse(secret, nonce, identity);
      expect(verifyAuthResponse(secret, nonce, "akira", response)).toBe(false);
    });

    it("異なる nonce では検証失敗する", () => {
      const response = createAuthResponse(secret, nonce, identity);
      expect(verifyAuthResponse(secret, "different-nonce", identity, response)).toBe(false);
    });
  });

  describe("createSignedEnvelope / verifySignedEnvelope", () => {
    const secret = "envelope-secret";
    const sender = "akira";
    const message = { type: "message", content: "hello" };

    it("署名付きエンベロープを作成して検証できる", () => {
      const envelope = createSignedEnvelope(secret, sender, message);
      expect(envelope.sender).toBe(sender);
      expect(envelope.payload).toBe(JSON.stringify(message));
      expect(envelope.sig).toMatch(/^[0-9a-f]{64}$/);

      const verified = verifySignedEnvelope(secret, envelope);
      expect(verified).toEqual(message);
    });

    it("改ざんされたペイロードを拒否する", () => {
      const envelope = createSignedEnvelope(secret, sender, message);
      envelope.payload = JSON.stringify({ type: "message", content: "tampered" });

      const verified = verifySignedEnvelope(secret, envelope);
      expect(verified).toBeNull();
    });

    it("異なる secret で検証するとnullを返す", () => {
      const envelope = createSignedEnvelope(secret, sender, message);
      const verified = verifySignedEnvelope("wrong-secret", envelope);
      expect(verified).toBeNull();
    });
  });
});
