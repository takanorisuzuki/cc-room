import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WebSocket } from "ws";
import { RoomServer } from "../../server.js";
import { StorageManager } from "../../storage.js";
import {
  generateRoomSecret,
  createAuthResponse,
  PROTOCOL_VERSION,
  generateId,
  verifySignedEnvelope,
} from "@cc-room/shared";
import type { InitialSyncMessage, SignedEnvelope } from "@cc-room/shared";

const TEST_PORT = 17331;
const TEST_ROOM_ID = "test-room-001";
const TEST_IDENTITY = "test-user";

function createTestConfig() {
  return {
    identity: { name: "test-server" },
    network: { port: TEST_PORT, http_port: 17332, mdns_service: "_cc-room._tcp" },
    trust: [],
    sessions: { default_mode: "approve" as const, share_files: true, share_context: true },
    privacy: { public_tools: [], private_patterns: [], redact_after_private_tool: true },
    summarizer: { model: "claude-haiku-4-5-20251001", interval_turns: 5, interval_seconds: 30 },
    storage: { max_bytes: 500 * 1024 * 1024, artifact_ttl_days: 30, context_ttl_days: 7, message_ttl_days: 14 },
  };
}

function connectAndAuth(
  secret: string,
  identity: string,
  options?: { sendInvalidAuth?: boolean; skipAuth?: boolean },
): Promise<{ ws: WebSocket; result: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}`);
    const timeout = setTimeout(() => reject(new Error("Auth timeout")), 8000);

    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());

      if (msg.type === "challenge") {
        if (options?.skipAuth) return;
        const response = options?.sendInvalidAuth
          ? "invalid_hmac_value_here"
          : createAuthResponse(secret, msg.nonce, identity);
        ws.send(JSON.stringify({
          v: PROTOCOL_VERSION,
          type: "auth",
          identity,
          response,
          room_id: TEST_ROOM_ID,
          supported_versions: [PROTOCOL_VERSION],
        }));
      }

      if (msg.type === "auth_ok") {
        clearTimeout(timeout);
        resolve({ ws, result: msg });
      }

      if (msg.type === "auth_fail") {
        clearTimeout(timeout);
        reject(new Error(msg.reason));
      }
    });

    ws.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

describe("WebSocket server + auth", () => {
  let server: RoomServer;
  let roomSecret: string;

  beforeEach(() => {
    roomSecret = generateRoomSecret();
    server = new RoomServer(createTestConfig());
    server.registerRoom(TEST_ROOM_ID, roomSecret);
    server.start();
  });

  afterEach(() => {
    server.stop();
  });

  it("正しい secret で接続が確立される", async () => {
    const { ws, result } = await connectAndAuth(roomSecret, TEST_IDENTITY);
    expect(result.type).toBe("auth_ok");
    expect(result.members).toContain(TEST_IDENTITY);
    ws.close();
  });

  it("不正な secret で AUTH_FAILED が返される", async () => {
    await expect(
      connectAndAuth(roomSecret, TEST_IDENTITY, { sendInvalidAuth: true }),
    ).rejects.toThrow("Invalid credentials");
  });

  it("5秒以内に auth しなければ切断される", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}`);
    const closePromise = new Promise<number>((resolve) => {
      ws.on("close", (code) => resolve(code));
    });
    const code = await closePromise;
    expect(code).toBe(4001);
  }, 10_000);

  it("同一 identity の二重接続を拒否する", async () => {
    const { ws: ws1 } = await connectAndAuth(roomSecret, "duplicate-user");
    await expect(
      connectAndAuth(roomSecret, "duplicate-user"),
    ).rejects.toThrow("Identity already connected");
    ws1.close();
  });

  it("接続後に ping/pong が動作する", async () => {
    const { ws } = await connectAndAuth(roomSecret, TEST_IDENTITY);

    const pongReceived = new Promise<void>((resolve) => {
      ws.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === "pong") resolve();
      });
    });

    ws.send(JSON.stringify({ type: "ping" }));
    await pongReceived;
    ws.close();
  });
});

describe("initial_sync on join", () => {
  const HOST_PORT = 17333;
  const SYNC_ROOM_ID = "sync-room-001";
  const HOST_IDENTITY = "host-user";
  const JOINER_IDENTITY = "joiner-user";

  let server: RoomServer;
  let roomSecret: string;
  let tempDir: string;
  let storage: StorageManager;

  function createSyncConfig() {
    return {
      identity: { name: HOST_IDENTITY },
      network: { port: HOST_PORT, http_port: 17334, mdns_service: "_cc-room._tcp" },
      trust: [],
      sessions: { default_mode: "approve" as const, share_files: true, share_context: true },
      privacy: { public_tools: [], private_patterns: [], redact_after_private_tool: true },
      summarizer: { model: "claude-haiku-4-5-20251001", interval_turns: 5, interval_seconds: 30 },
      storage: { max_bytes: 500 * 1024 * 1024, artifact_ttl_days: 30, context_ttl_days: 7, message_ttl_days: 14 },
    };
  }

  beforeEach(() => {
    roomSecret = generateRoomSecret();
    tempDir = mkdtempSync(join(tmpdir(), "cc-room-sync-"));
    storage = new StorageManager(tempDir);

    storage.createRoom({
      id: SYNC_ROOM_ID,
      name: "Sync Test Room",
      secret: roomSecret,
      hosted_by: HOST_IDENTITY,
      members: [HOST_IDENTITY],
      created_at: "2026-06-08T00:00:00Z",
    });
    storage.writeContext(SYNC_ROOM_ID, HOST_IDENTITY, "JWT設計を議論中");
    storage.appendMessage(SYNC_ROOM_ID, {
      ts: "2026-06-08T00:00:00Z",
      from: HOST_IDENTITY,
      type: "message",
      content: "最初のメッセージ",
    });
    storage.writeMemory(SYNC_ROOM_ID, "チームメモ: パフォーマンス優先");
    storage.rememberRoomMemory(SYNC_ROOM_ID, "Server Actions優先", HOST_IDENTITY);

    server = new RoomServer(createSyncConfig());
    server.registerRoom(SYNC_ROOM_ID, roomSecret);

    server.on("peer_connect", (joinerIdentity: string, roomId: string) => {
      const meta = storage.getRoomMeta(roomId);
      if (!meta || meta.hosted_by !== HOST_IDENTITY) return;

      const syncMsg: InitialSyncMessage = {
        v: PROTOCOL_VERSION,
        id: generateId(),
        ts: new Date().toISOString(),
        type: "initial_sync",
        room_id: roomId,
        sender: HOST_IDENTITY,
        contexts: storage.readAllContexts(roomId),
        messages: storage.readMessages(roomId),
        memory: storage.readMemory(roomId),
        artifact_names: storage.listArtifacts(roomId).map((a) => a.name),
        room_memory: storage.readAllRoomMemoryForSync(roomId),
      };

      server.sendTo(joinerIdentity, syncMsg);
    });

    server.start();
  });

  afterEach(() => {
    server.stop();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("新規参加者がホストの既存データを initial_sync で受信する", async () => {
    const syncReceived = new Promise<InitialSyncMessage>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("initial_sync timeout")), 8000);
      const ws = new WebSocket(`ws://127.0.0.1:${HOST_PORT}`);

      ws.on("message", (data) => {
        const raw = JSON.parse(data.toString());

        if (raw.type === "challenge") {
          const response = createAuthResponse(roomSecret, raw.nonce, JOINER_IDENTITY);
          ws.send(JSON.stringify({
            v: PROTOCOL_VERSION,
            type: "auth",
            identity: JOINER_IDENTITY,
            response,
            room_id: SYNC_ROOM_ID,
            supported_versions: [PROTOCOL_VERSION],
          }));
          return;
        }

        if (raw.type === "auth_ok") return;

        if ("payload" in raw && "sig" in raw) {
          const decoded = verifySignedEnvelope(roomSecret, raw as SignedEnvelope);
          if (!decoded) return;

          const msg = decoded as Record<string, unknown>;
          if (msg.type === "initial_sync") {
            clearTimeout(timeout);
            ws.close();
            resolve(msg as unknown as InitialSyncMessage);
          }
        }
      });

      ws.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    const sync = await syncReceived;

    expect(sync.type).toBe("initial_sync");
    expect(sync.room_id).toBe(SYNC_ROOM_ID);
    expect(sync.sender).toBe(HOST_IDENTITY);
    expect(sync.contexts[HOST_IDENTITY]).toBe("JWT設計を議論中");
    expect(sync.messages).toHaveLength(1);
    expect((sync.messages[0] as Record<string, unknown>).content).toBe("最初のメッセージ");
    expect(sync.memory).toBe("チームメモ: パフォーマンス優先\nServer Actions優先\n");
    expect(sync.artifact_names).toEqual([]);
    expect(sync.room_memory?.files).toHaveLength(1);
    expect(sync.room_memory?.files[0].content).toContain("Server Actions優先");
    expect(sync.room_memory?.index_md).toContain("server-actions");
  });

  it("ホストでない部屋への参加では initial_sync が送られない", async () => {
    const noSyncRoomId = "no-sync-room";
    const noSyncSecret = generateRoomSecret();
    storage.createRoom({
      id: noSyncRoomId,
      name: "No Sync Room",
      secret: noSyncSecret,
      hosted_by: "other-user",
      members: ["other-user"],
      created_at: "2026-06-08T00:00:00Z",
    });
    server.registerRoom(noSyncRoomId, noSyncSecret);

    let receivedInitialSync = false;

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => resolve(), 1500);
      const ws = new WebSocket(`ws://127.0.0.1:${HOST_PORT}`);

      ws.on("message", (data) => {
        const raw = JSON.parse(data.toString());

        if (raw.type === "challenge") {
          const response = createAuthResponse(noSyncSecret, raw.nonce, JOINER_IDENTITY);
          ws.send(JSON.stringify({
            v: PROTOCOL_VERSION,
            type: "auth",
            identity: JOINER_IDENTITY,
            response,
            room_id: noSyncRoomId,
            supported_versions: [PROTOCOL_VERSION],
          }));
          return;
        }

        if ("payload" in raw && "sig" in raw) {
          const decoded = verifySignedEnvelope(noSyncSecret, raw as SignedEnvelope);
          if (decoded) {
            const msg = decoded as Record<string, unknown>;
            if (msg.type === "initial_sync") {
              receivedInitialSync = true;
              clearTimeout(timeout);
              ws.close();
              reject(new Error("unexpected initial_sync received"));
            }
          }
        }
      });

      ws.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    expect(receivedInitialSync).toBe(false);
  });
});
