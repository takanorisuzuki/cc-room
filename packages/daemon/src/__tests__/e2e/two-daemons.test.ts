import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ChildProcess } from "node:child_process";
import {
  createDaemonConfig,
  httpGet,
  httpPost,
  killDaemon,
  startDaemon,
  waitForCondition,
  waitForHttp,
  writeDaemonConfig,
} from "./helpers.js";

const ALICE_WS_PORT = 19331;
const ALICE_HTTP_PORT = 19332;
const BOB_WS_PORT = 19333;
const BOB_HTTP_PORT = 19334;

const PUBLIC_TOOLS_OVERRIDE = {
  privacy: {
    public_tools: ["room_context", "room_messages", "room_files", "room_status", "room_invite", "room_share"],
    private_patterns: [],
    redact_after_private_tool: true,
  },
};

describe("E2E: 2デーモン間通信", () => {
  let aliceHome: string;
  let bobHome: string;
  let aliceClaudeHome: string;
  let bobClaudeHome: string;
  let aliceProc: ChildProcess;
  let bobProc: ChildProcess;
  let testSuffix: string;

  beforeEach(async () => {
    // 前回実行時の mDNS キャッシュと名前衝突しないようユニークサフィックスを付与
    testSuffix = Date.now().toString(36);
    aliceHome = mkdtempSync(join(tmpdir(), "cc-room-e2e-alice-"));
    bobHome = mkdtempSync(join(tmpdir(), "cc-room-e2e-bob-"));
    aliceClaudeHome = mkdtempSync(join(tmpdir(), "cc-e2e-alice-claude-"));
    bobClaudeHome = mkdtempSync(join(tmpdir(), "cc-e2e-bob-claude-"));

    writeDaemonConfig(aliceHome, createDaemonConfig("alice", ALICE_WS_PORT, ALICE_HTTP_PORT, PUBLIC_TOOLS_OVERRIDE));
    writeDaemonConfig(bobHome, createDaemonConfig("bob", BOB_WS_PORT, BOB_HTTP_PORT, PUBLIC_TOOLS_OVERRIDE));

    aliceProc = startDaemon(aliceHome, { claudeHome: aliceClaudeHome });
    bobProc = startDaemon(bobHome, { claudeHome: bobClaudeHome });

    await Promise.all([
      waitForHttp(ALICE_HTTP_PORT),
      waitForHttp(BOB_HTTP_PORT),
    ]);
  }, 20000);

  afterEach(async () => {
    await Promise.all([killDaemon(aliceProc), killDaemon(bobProc)]);

    rmSync(aliceHome, { recursive: true, force: true });
    rmSync(bobHome, { recursive: true, force: true });
    rmSync(aliceClaudeHome, { recursive: true, force: true });
    rmSync(bobClaudeHome, { recursive: true, force: true });
  }, 15000);

  it("bob が alice の部屋を mDNS で発見できる", async () => {
    const roomName = `e2e-room-${testSuffix}`;
    // alice が部屋を作成
    const createRes = await httpPost(ALICE_HTTP_PORT, "/room/create", { name: roomName }) as { room_id: string; pin: string };
    expect(createRes.room_id).toBeTruthy();
    expect(createRes.pin).toBeTruthy();

    // bob が mDNS で発見するまで待つ
    await waitForCondition(async () => {
      const disc = await httpGet(BOB_HTTP_PORT, "/room/discover") as { rooms: Array<{ name: string }> };
      return disc.rooms.some((r) => r.name === roomName);
    });

    const disc = await httpGet(BOB_HTTP_PORT, "/room/discover") as { rooms: Array<{ name: string }> };
    expect(disc.rooms.find((r) => r.name === roomName)).toBeTruthy();
  }, 30000);

  it("bob が PIN で部屋に参加できる", async () => {
    const roomName = `e2e-join-${testSuffix}`;
    const createRes = await httpPost(ALICE_HTTP_PORT, "/room/create", { name: roomName }) as { room_id: string; pin: string };

    await waitForCondition(async () => {
      const disc = await httpGet(BOB_HTTP_PORT, "/room/discover") as { rooms: Array<{ name: string }> };
      return disc.rooms.some((r) => r.name === roomName);
    });

    const joinRes = await httpPost(BOB_HTTP_PORT, "/room/join", { name: roomName, pin: createRes.pin }) as { ok: boolean; room_id: string };
    expect(joinRes.ok).toBe(true);
    expect(joinRes.room_id).toBe(createRes.room_id);
  }, 30000);

  it("alice の /share メッセージが bob の /messages に届く", async () => {
    const roomName = `e2e-msg-${testSuffix}`;
    // 部屋作成 → bob 参加
    const createRes = await httpPost(ALICE_HTTP_PORT, "/room/create", { name: roomName }) as { room_id: string; pin: string };

    await waitForCondition(async () => {
      const disc = await httpGet(BOB_HTTP_PORT, "/room/discover") as { rooms: Array<{ name: string }> };
      return disc.rooms.some((r) => r.name === roomName);
    });

    await httpPost(BOB_HTTP_PORT, "/room/join", { name: roomName, pin: createRes.pin });

    // bob が alice に WebSocket 接続するまで待つ
    await waitForCondition(async () => {
      const status = await httpGet(ALICE_HTTP_PORT, "/status") as { rooms: Array<{ connected: string[] }> };
      return status.rooms.some((r) => r.connected.includes("bob"));
    });

    // alice がメッセージを送信
    await httpPost(ALICE_HTTP_PORT, "/share", { message: "hello from alice" });

    // bob 側でメッセージが届いているか確認
    await waitForCondition(async () => {
      const msgs = await httpGet(BOB_HTTP_PORT, "/messages") as Record<string, Array<{ content?: string }>>;
      const roomMsgs = Object.values(msgs).flat();
      return roomMsgs.some((m) => m.content === "hello from alice");
    });

    const msgs = await httpGet(BOB_HTTP_PORT, "/messages") as Record<string, Array<{ content?: string }>>;
    const roomMsgs = Object.values(msgs).flat();
    expect(roomMsgs.some((m) => m.content === "hello from alice")).toBe(true);
  }, 30000);

  it("bob の /share メッセージが alice の /messages に届く", async () => {
    const roomName = `e2e-msg2-${testSuffix}`;
    const createRes = await httpPost(ALICE_HTTP_PORT, "/room/create", { name: roomName }) as { room_id: string; pin: string };

    await waitForCondition(async () => {
      const disc = await httpGet(BOB_HTTP_PORT, "/room/discover") as { rooms: Array<{ name: string }> };
      return disc.rooms.some((r) => r.name === roomName);
    });

    await httpPost(BOB_HTTP_PORT, "/room/join", { name: roomName, pin: createRes.pin });

    // 双方向接続が確立するまで待つ
    await waitForCondition(async () => {
      const status = await httpGet(ALICE_HTTP_PORT, "/status") as { rooms: Array<{ connected: string[] }> };
      return status.rooms.some((r) => r.connected.includes("bob"));
    });

    // bob がメッセージを送信
    await httpPost(BOB_HTTP_PORT, "/share", { message: "hello from bob" });

    // alice 側でメッセージが届いているか確認
    await waitForCondition(async () => {
      const msgs = await httpGet(ALICE_HTTP_PORT, "/messages") as Record<string, Array<{ content?: string }>>;
      const roomMsgs = Object.values(msgs).flat();
      return roomMsgs.some((m) => m.content === "hello from bob");
    });

    const msgs = await httpGet(ALICE_HTTP_PORT, "/messages") as Record<string, Array<{ content?: string }>>;
    const roomMsgs = Object.values(msgs).flat();
    expect(roomMsgs.some((m) => m.content === "hello from bob")).toBe(true);
  }, 30000);

  it("両方が /status で相手を connected として見える", async () => {
    const roomName = `e2e-conn-${testSuffix}`;
    const createRes = await httpPost(ALICE_HTTP_PORT, "/room/create", { name: roomName }) as { room_id: string; pin: string };

    await waitForCondition(async () => {
      const disc = await httpGet(BOB_HTTP_PORT, "/room/discover") as { rooms: Array<{ name: string }> };
      return disc.rooms.some((r) => r.name === roomName);
    });

    await httpPost(BOB_HTTP_PORT, "/room/join", { name: roomName, pin: createRes.pin });

    // alice 側で bob が connected に見える
    await waitForCondition(async () => {
      const status = await httpGet(ALICE_HTTP_PORT, "/status") as { rooms: Array<{ connected: string[] }> };
      return status.rooms.some((r) => r.connected.includes("bob"));
    });

    // bob 側で alice が connected に見える
    await waitForCondition(async () => {
      const status = await httpGet(BOB_HTTP_PORT, "/status") as { rooms: Array<{ connected: string[] }> };
      return status.rooms.some((r) => r.connected.includes("alice"));
    });

    const aliceStatus = await httpGet(ALICE_HTTP_PORT, "/status") as { rooms: Array<{ connected: string[] }> };
    const bobStatus = await httpGet(BOB_HTTP_PORT, "/status") as { rooms: Array<{ connected: string[] }> };

    expect(aliceStatus.rooms[0].connected).toContain("bob");
    expect(bobStatus.rooms[0].connected).toContain("alice");
  }, 30000);

  it("alice が /show/file でスキルを共有し、bob が承認するとスキルディレクトリに保存される", async () => {
    const roomName = `e2e-skill-${testSuffix}`;
    const createRes = await httpPost(ALICE_HTTP_PORT, "/room/create", { name: roomName }) as { room_id: string; pin: string };

    await waitForCondition(async () => {
      const disc = await httpGet(BOB_HTTP_PORT, "/room/discover") as { rooms: Array<{ name: string }> };
      return disc.rooms.some((r) => r.name === roomName);
    });

    await httpPost(BOB_HTTP_PORT, "/room/join", { name: roomName, pin: createRes.pin });

    await waitForCondition(async () => {
      const status = await httpGet(ALICE_HTTP_PORT, "/status") as { rooms: Array<{ connected: string[] }> };
      return status.rooms.some((r) => r.connected.includes("bob"));
    });

    const skillContent = "# my-skill\nThis is a test skill.";
    await httpPost(ALICE_HTTP_PORT, "/show/file", { share_type: "skill", filename: "my-skill.md", content: skillContent });

    // bob の pending に届くまで待つ
    let pendingId = "";
    await waitForCondition(async () => {
      const res = await httpGet(BOB_HTTP_PORT, "/room/pending") as { pending: Array<{ entries: Array<{ id: string; filename: string }> }> };
      const entry = res.pending.flatMap((r) => r.entries).find((e) => e.filename === "my-skill.md");
      if (entry) { pendingId = entry.id; return true; }
      return false;
    });

    // bob が承認
    const acceptRes = await httpPost(BOB_HTTP_PORT, "/room/accept", { pending_id: pendingId }) as { ok: boolean; save_path: string };
    expect(acceptRes.ok).toBe(true);

    const expectedPath = join(bobClaudeHome, "skills", "my-skill.md");
    expect(existsSync(expectedPath)).toBe(true);
    const saved = readFileSync(expectedPath, "utf-8");
    expect(saved).toBe(skillContent);
  }, 30000);

  it("alice が /show/file で CLAUDE.md を共有し、bob が承認すると Room-scoped に保存され adopt でグローバルへ昇格できる", async () => {
    const roomName = `e2e-claudemd-${testSuffix}`;
    const createRes = await httpPost(ALICE_HTTP_PORT, "/room/create", { name: roomName }) as { room_id: string; pin: string };

    await waitForCondition(async () => {
      const disc = await httpGet(BOB_HTTP_PORT, "/room/discover") as { rooms: Array<{ name: string }> };
      return disc.rooms.some((r) => r.name === roomName);
    });

    await httpPost(BOB_HTTP_PORT, "/room/join", { name: roomName, pin: createRes.pin });

    await waitForCondition(async () => {
      const status = await httpGet(ALICE_HTTP_PORT, "/status") as { rooms: Array<{ connected: string[] }> };
      return status.rooms.some((r) => r.connected.includes("bob"));
    });

    const sharedContent = "# Alice's Project Rules\nUse TypeScript strict mode.";
    await httpPost(ALICE_HTTP_PORT, "/show/file", { share_type: "claude_md", filename: "CLAUDE.md", content: sharedContent });

    // bob の pending に届くまで待つ
    let pendingId = "";
    let roomId = "";
    await waitForCondition(async () => {
      const res = await httpGet(BOB_HTTP_PORT, "/room/pending") as { pending: Array<{ room_id: string; entries: Array<{ id: string; filename: string }> }> };
      for (const room of res.pending) {
        const entry = room.entries.find((e) => e.filename === "CLAUDE.md");
        if (entry) { pendingId = entry.id; roomId = room.room_id; return true; }
      }
      return false;
    });

    // bob が承認 → Room-scoped に保存
    const acceptRes = await httpPost(BOB_HTTP_PORT, "/room/accept", { pending_id: pendingId }) as { ok: boolean; save_path: string };
    expect(acceptRes.ok).toBe(true);
    expect(acceptRes.save_path).toContain("claude.md");
    expect(existsSync(acceptRes.save_path)).toBe(true);

    // グローバル CLAUDE.md はまだ存在しない
    const globalPath = join(bobClaudeHome, "CLAUDE.md");
    expect(existsSync(globalPath)).toBe(false);

    // adopt でグローバルへ昇格
    const adoptRes = await httpPost(BOB_HTTP_PORT, "/room/adopt", { room_id: roomId }) as { ok: boolean; path: string };
    expect(adoptRes.ok).toBe(true);
    expect(existsSync(globalPath)).toBe(true);
    const saved = readFileSync(globalPath, "utf-8");
    expect(saved).toContain(sharedContent);
  }, 30000);
});
