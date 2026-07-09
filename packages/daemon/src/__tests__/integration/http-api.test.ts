import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HttpApi } from "../../http-api.js";
import type { HttpApiHandlers } from "../../http-api.js";
import { StorageManager } from "../../storage.js";
import { generateRoomSecret } from "@cc-room/shared";

const TEST_HTTP_PORT = 17400;

describe("HTTP API", () => {
  let tempDir: string;
  let storage: StorageManager;
  let api: HttpApi;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "cc-room-http-"));
    storage = new StorageManager(tempDir);
    storage.createRoom({
      id: "room-http-test",
      name: "HTTP Test",
      secret: generateRoomSecret(),
      members: ["akira", "yuki"],
      created_at: "2026-06-04T10:00:00Z",
    });
    storage.writeContext("room-http-test", "akira", "JWT設計中");
    storage.appendMessage("room-http-test", {
      ts: "2026-06-04T10:00:00Z",
      from: "akira",
      type: "message",
      content: "hello",
    });
    storage.writeArtifact("room-http-test", "design.md", Buffer.from("# Design"));

    const handlers: HttpApiHandlers = {
      getHealth: () => ({ status: "ok", identity: "test", pid: 1 }),
      getStatus: () => ({
        identity: "test",
        rooms: [{ id: "room-http-test", name: "HTTP Test", members: ["akira", "yuki"], connected: [] }],
      }),
      getContext: () => ({ "room-http-test": storage.readAllContexts("room-http-test") }),
      getMessages: () => ({ "room-http-test": storage.readMessages("room-http-test") }),
      getFiles: () => ({ "room-http-test": storage.listArtifacts("room-http-test") }),
      postInvite: async (body) => ({ invited: body.name }),
      postJoin: async (body) => ({ ok: true, room_id: body.room_id }),
      postLeave: async (body) => ({ ok: true, room_id: body.room_id }),
      postShare: async (body) => ({ sent: true, message: body.message }),
      postMemory: async (body) => ({ saved: true, content: body.content }),
      getMemoryInject: (sessionId) => ({ inject: sessionId ? "<cc-room-memory>test</cc-room-memory>" : "" }),
      getMemorySearch: (query) => ({ results: query ? [{ slug: "test", description: "d", body: "b", score: 1 }] : [] }),
      postDream: async () => ({ candidates: [], message: "ok" }),
      postDreamAccept: async () => ({ accepted: 0, message: "ok" }),
      postDreamQueue: async (body) => ({ queued: true, session_id: body.session_id }),
      getDreamPending: () => ({ total: 0, proposals: [] }),
      postDreamObjection: async () => ({ ok: true, message: "ok" }),
      postDreamHold: async () => ({ ok: true, message: "ok" }),
      postDreamRevert: async () => ({ ok: true, message: "ok" }),
      getDreamConfig: () => ({
        room_id: "room-http-test",
        room_name: "HTTP Test",
        summary: "mine_trigger: threshold",
        effective: { mine_trigger: "threshold" },
      }),
      postDreamConfig: async () => ({ ok: true, message: "updated" }),
      getMemoryTrace: () => ({ found: false, entries: [] }),
      postNotifyFile: async (body) => ({ notified: true, file: body.file_path }),
      postPrivate: async (body) => ({ private: body.mode === "on", pending: 0 }),
      postRoomSwitch: async () => ({ ok: true, room_id: "room-test", room_name: "Test", private: false }),
      getDiscover: () => ({ rooms: [] }),
      postRoomCreate: async (body) => ({ room_id: "test-room", name: body.name, pin: "123456" }),
      postRoomJoin: async (body) => ({ ok: true, room_id: "test-room", name: body.name }),
      postNotifyToggle: async (body) => ({ enabled: body.enabled }),
      postShowFile: async () => ({ sent: true }),
      postRoomAccept: async () => ({ accepted: true }),
      postRoomReject: async () => ({ rejected: true }),
      postRoomAdopt: async () => ({ adopted: true }),
      getRoomPending: () => ({ pending: [] }),
      postMention: async () => ({ sent: true }),
      getUnread: () => ({ total: 0, rooms: [] }),
      postUnreadMarkRead: async () => ({ marked: true }),
    };

    api = new HttpApi(TEST_HTTP_PORT, handlers);
    api.start();
  });

  afterEach(() => {
    api.stop();
    rmSync(tempDir, { recursive: true, force: true });
  });

  async function get(path: string): Promise<{ status: number; body: unknown }> {
    const res = await fetch(`http://127.0.0.1:${TEST_HTTP_PORT}${path}`);
    return { status: res.status, body: await res.json() };
  }

  async function post(path: string, data: unknown): Promise<{ status: number; body: unknown }> {
    const res = await fetch(`http://127.0.0.1:${TEST_HTTP_PORT}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    return { status: res.status, body: await res.json() };
  }

  it("GET /health が status ok を返す", async () => {
    const { status, body } = await get("/health");
    expect(status).toBe(200);
    expect(body).toEqual({ status: "ok", identity: "test", pid: 1 });
  });

  it("GET /status がルーム情報を返す", async () => {
    const { status, body } = await get("/status");
    expect(status).toBe(200);
    const data = body as { rooms: Array<{ id: string }> };
    expect(data.rooms[0].id).toBe("room-http-test");
  });

  it("GET /context がメンバーのサマリを返す", async () => {
    const { status, body } = await get("/context");
    expect(status).toBe(200);
    const data = body as Record<string, Record<string, string>>;
    expect(data["room-http-test"].akira).toBe("JWT設計中");
  });

  it("GET /messages がメッセージ履歴を返す", async () => {
    const { status, body } = await get("/messages");
    expect(status).toBe(200);
    const data = body as Record<string, Array<{ content: string }>>;
    expect(data["room-http-test"][0].content).toBe("hello");
  });

  it("GET /files が成果物一覧を返す", async () => {
    const { status, body } = await get("/files");
    expect(status).toBe(200);
    const data = body as Record<string, Array<{ name: string }>>;
    expect(data["room-http-test"][0].name).toBe("design.md");
  });

  it("POST /invite が招待を処理する", async () => {
    const { status, body } = await post("/invite", { name: "yuki" });
    expect(status).toBe(200);
    expect(body).toEqual({ invited: "yuki" });
  });

  it("POST /share がメッセージを送信する", async () => {
    const { status, body } = await post("/share", { message: "TTL 3日にすべき" });
    expect(status).toBe(200);
    expect(body).toEqual({ sent: true, message: "TTL 3日にすべき" });
  });

  it("POST /notify-file がファイル通知を処理する", async () => {
    const { status, body } = await post("/notify-file", { file_path: "/tmp/test.md" });
    expect(status).toBe(200);
    expect(body).toEqual({ notified: true, file: "/tmp/test.md" });
  });

  it("POST /private が Private 状態を返す", async () => {
    const { status, body } = await post("/private", { mode: "on" });
    expect(status).toBe(200);
    expect(body).toMatchObject({ private: true });
  });

  it("POST /room/switch が Primary 切替を処理する", async () => {
    const { status, body } = await post("/room/switch", { name: "Test" });
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, room_name: "Test" });
  });

  it("POST /room/focus は互換エイリアスとして /room/switch へ委譲する", async () => {
    const { status, body } = await post("/room/focus", { name: "Test" });
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true });
  });

  it("GET /memory/inject が注入テキストを返す", async () => {
    const { status, body } = await get("/memory/inject?session_id=sess-test");
    expect(status).toBe(200);
    expect(body).toEqual({ inject: "<cc-room-memory>test</cc-room-memory>" });
  });

  it("GET /dream/config が設定を返す", async () => {
    const { status, body } = await get("/dream/config");
    expect(status).toBe(200);
    const data = body as { room_id: string; summary: string };
    expect(data.room_id).toBe("room-http-test");
    expect(data.summary).toContain("mine_trigger");
  });

  it("存在しないエンドポイントで 404 を返す", async () => {
    const { status } = await get("/nonexistent");
    expect(status).toBe(404);
  });
});
