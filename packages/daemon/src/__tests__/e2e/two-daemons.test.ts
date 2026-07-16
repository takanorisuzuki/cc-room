import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ChildProcess } from "node:child_process";
import {
  createDaemonConfig,
  createRoomPair,
  httpGet,
  httpPost,
  killDaemon,
  startDaemon,
  waitForCondition,
  waitForHttp,
  waitForMemberContext,
  writeDaemonConfig,
  writeSessionJsonl,
} from "./helpers.js";

const ALICE_WS_PORT = 19331;
const ALICE_HTTP_PORT = 19332;
const BOB_WS_PORT = 19333;
const BOB_HTTP_PORT = 19334;

const PUBLIC_TOOLS_OVERRIDE = {
  privacy: {
    public_tools: [
      "room_context",
      "room_messages",
      "room_files",
      "room_status",
      "room_invite",
      "room_share",
    ],
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
    testSuffix = Date.now().toString(36);
    aliceHome = mkdtempSync(join(tmpdir(), "cc-room-e2e-alice-"));
    bobHome = mkdtempSync(join(tmpdir(), "cc-room-e2e-bob-"));
    aliceClaudeHome = mkdtempSync(join(tmpdir(), "cc-e2e-alice-claude-"));
    bobClaudeHome = mkdtempSync(join(tmpdir(), "cc-e2e-bob-claude-"));
    mkdirSync(join(aliceClaudeHome, "projects"), { recursive: true });
    mkdirSync(join(bobClaudeHome, "projects"), { recursive: true });

    writeDaemonConfig(
      aliceHome,
      createDaemonConfig("alice", ALICE_WS_PORT, ALICE_HTTP_PORT, PUBLIC_TOOLS_OVERRIDE),
    );
    writeDaemonConfig(
      bobHome,
      createDaemonConfig("bob", BOB_WS_PORT, BOB_HTTP_PORT, PUBLIC_TOOLS_OVERRIDE),
    );

    aliceProc = startDaemon(aliceHome, { claudeHome: aliceClaudeHome, dropApiKey: true });
    bobProc = startDaemon(bobHome, { claudeHome: bobClaudeHome, dropApiKey: true });

    await Promise.all([waitForHttp(ALICE_HTTP_PORT), waitForHttp(BOB_HTTP_PORT)]);
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
    const createRes = (await httpPost(ALICE_HTTP_PORT, "/room/create", { name: roomName })) as {
      room_id: string;
      pin: string;
    };
    expect(createRes.room_id).toBeTruthy();
    expect(createRes.pin).toBeTruthy();

    await waitForCondition(async () => {
      const disc = (await httpGet(BOB_HTTP_PORT, "/room/discover")) as {
        rooms: Array<{ name: string }>;
      };
      return disc.rooms.some((r) => r.name === roomName);
    });

    const disc = (await httpGet(BOB_HTTP_PORT, "/room/discover")) as {
      rooms: Array<{ name: string }>;
    };
    expect(disc.rooms.find((r) => r.name === roomName)).toBeTruthy();
  }, 30000);

  it("bob が PIN で部屋に参加できる", async () => {
    const roomName = `e2e-join-${testSuffix}`;
    const createRes = (await httpPost(ALICE_HTTP_PORT, "/room/create", { name: roomName })) as {
      room_id: string;
      pin: string;
    };

    await waitForCondition(async () => {
      const disc = (await httpGet(BOB_HTTP_PORT, "/room/discover")) as {
        rooms: Array<{ name: string }>;
      };
      return disc.rooms.some((r) => r.name === roomName);
    });

    const joinRes = (await httpPost(BOB_HTTP_PORT, "/room/join", {
      name: roomName,
      pin: createRes.pin,
    })) as { ok: boolean; room_id: string };
    expect(joinRes.ok).toBe(true);
    expect(joinRes.room_id).toBe(createRes.room_id);
  }, 30000);

  it("alice の /share メッセージが bob の /messages に届く", async () => {
    const roomName = `e2e-msg-${testSuffix}`;
    await createRoomPair(roomName, ALICE_HTTP_PORT, BOB_HTTP_PORT);

    await httpPost(ALICE_HTTP_PORT, "/share", { message: "hello from alice" });

    await waitForCondition(async () => {
      const msgs = (await httpGet(BOB_HTTP_PORT, "/messages")) as Record<
        string,
        Array<{ content?: string }>
      >;
      return Object.values(msgs)
        .flat()
        .some((m) => m.content === "hello from alice");
    });
  }, 30000);

  it("bob の /share メッセージが alice の /messages に届く", async () => {
    const roomName = `e2e-msg2-${testSuffix}`;
    await createRoomPair(roomName, ALICE_HTTP_PORT, BOB_HTTP_PORT);

    await httpPost(BOB_HTTP_PORT, "/share", { message: "hello from bob" });

    await waitForCondition(async () => {
      const msgs = (await httpGet(ALICE_HTTP_PORT, "/messages")) as Record<
        string,
        Array<{ content?: string }>
      >;
      return Object.values(msgs)
        .flat()
        .some((m) => m.content === "hello from bob");
    });
  }, 30000);

  it("両方が /status で相手を connected として見える", async () => {
    const roomName = `e2e-conn-${testSuffix}`;
    await createRoomPair(roomName, ALICE_HTTP_PORT, BOB_HTTP_PORT);

    await waitForCondition(async () => {
      const status = (await httpGet(BOB_HTTP_PORT, "/status")) as {
        rooms: Array<{ connected: string[] }>;
      };
      return status.rooms.some((r) => r.connected.includes("alice"));
    });

    const aliceStatus = (await httpGet(ALICE_HTTP_PORT, "/status")) as {
      rooms: Array<{ connected: string[] }>;
    };
    const bobStatus = (await httpGet(BOB_HTTP_PORT, "/status")) as {
      rooms: Array<{ connected: string[] }>;
    };

    expect(aliceStatus.rooms[0].connected).toContain("bob");
    expect(bobStatus.rooms[0].connected).toContain("alice");
  }, 30000);

  it("alice が /show/file でスキルを共有し、bob が承認するとスキルディレクトリに保存される", async () => {
    const roomName = `e2e-skill-${testSuffix}`;
    await createRoomPair(roomName, ALICE_HTTP_PORT, BOB_HTTP_PORT);

    const skillContent = "# my-skill\nThis is a test skill.";
    await httpPost(ALICE_HTTP_PORT, "/show/file", {
      share_type: "skill",
      filename: "my-skill.md",
      content: skillContent,
    });

    let pendingId = "";
    await waitForCondition(async () => {
      const res = (await httpGet(BOB_HTTP_PORT, "/room/pending")) as {
        pending: Array<{ entries: Array<{ id: string; filename: string }> }>;
      };
      const entry = res.pending.flatMap((r) => r.entries).find((e) => e.filename === "my-skill.md");
      if (entry) {
        pendingId = entry.id;
        return true;
      }
      return false;
    });

    const acceptRes = (await httpPost(BOB_HTTP_PORT, "/room/accept", {
      pending_id: pendingId,
    })) as { ok: boolean };
    expect(acceptRes.ok).toBe(true);

    const expectedPath = join(bobClaudeHome, "skills", "my-skill.md");
    expect(existsSync(expectedPath)).toBe(true);
    expect(readFileSync(expectedPath, "utf-8")).toBe(skillContent);
  }, 30000);

  it("alice が /show/file で CLAUDE.md を共有し、bob が承認すると Room-scoped に保存され adopt でグローバルへ昇格できる", async () => {
    const roomName = `e2e-claudemd-${testSuffix}`;
    await createRoomPair(roomName, ALICE_HTTP_PORT, BOB_HTTP_PORT);

    const sharedContent = "# Alice's Project Rules\nUse TypeScript strict mode.";
    await httpPost(ALICE_HTTP_PORT, "/show/file", {
      share_type: "claude_md",
      filename: "CLAUDE.md",
      content: sharedContent,
    });

    let pendingId = "";
    let roomId = "";
    await waitForCondition(async () => {
      const res = (await httpGet(BOB_HTTP_PORT, "/room/pending")) as {
        pending: Array<{ room_id: string; entries: Array<{ id: string; filename: string }> }>;
      };
      for (const room of res.pending) {
        const entry = room.entries.find((e) => e.filename === "CLAUDE.md");
        if (entry) {
          pendingId = entry.id;
          roomId = room.room_id;
          return true;
        }
      }
      return false;
    });

    const acceptRes = (await httpPost(BOB_HTTP_PORT, "/room/accept", {
      pending_id: pendingId,
    })) as { ok: boolean; save_path: string };
    expect(acceptRes.ok).toBe(true);
    expect(acceptRes.save_path).toContain("claude.md");
    expect(existsSync(acceptRes.save_path)).toBe(true);

    const globalPath = join(bobClaudeHome, "CLAUDE.md");
    expect(existsSync(globalPath)).toBe(false);

    const adoptRes = (await httpPost(BOB_HTTP_PORT, "/room/adopt", { room_id: roomId })) as {
      ok: boolean;
    };
    expect(adoptRes.ok).toBe(true);
    expect(existsSync(globalPath)).toBe(true);
    expect(readFileSync(globalPath, "utf-8")).toContain(sharedContent);
  }, 30000);

  it("公開中のセッション要約が bob の /context に届く", async () => {
    const roomName = `e2e-ctx-${testSuffix}`;
    await createRoomPair(roomName, ALICE_HTTP_PORT, BOB_HTTP_PORT);

    const marker = `JWT-TTL-${testSuffix}`;
    writeSessionJsonl(
      aliceClaudeHome,
      `/tmp/e2e-work-${testSuffix}`,
      `sess-ctx-${testSuffix}`,
      `${marker} を設計する`,
      "HS256 で 1 日に短縮する方針",
    );

    const summary = await waitForMemberContext(BOB_HTTP_PORT, "alice", marker);
    expect(summary).toContain(marker);
  }, 45000);

  it("Private ON 中は要約が届かず、share 後に届く", async () => {
    const roomName = `e2e-priv-${testSuffix}`;
    await createRoomPair(roomName, ALICE_HTTP_PORT, BOB_HTTP_PORT);

    await httpPost(ALICE_HTTP_PORT, "/private", { mode: "on" });

    const marker = `PRIVATE-MARKER-${testSuffix}`;
    writeSessionJsonl(
      aliceClaudeHome,
      `/tmp/e2e-priv-${testSuffix}`,
      `sess-priv-${testSuffix}`,
      `${marker} の実装`,
      "手元だけで進めている",
    );

    await new Promise((r) => setTimeout(r, 2500));
    const mid = (await httpGet(BOB_HTTP_PORT, "/context")) as Record<string, Record<string, string>>;
    const midSummaries = Object.values(mid).flatMap((m) => Object.values(m));
    expect(midSummaries.some((s) => s.includes(marker))).toBe(false);

    await httpPost(ALICE_HTTP_PORT, "/private", { mode: "share" });
    const summary = await waitForMemberContext(BOB_HTTP_PORT, "alice", marker);
    expect(summary).toContain(marker);
  }, 45000);

  it("join 前の alice コンテキストが initial_sync で bob に入る", async () => {
    const roomName = `e2e-sync-${testSuffix}`;
    const createRes = (await httpPost(ALICE_HTTP_PORT, "/room/create", { name: roomName })) as {
      room_id: string;
      pin: string;
    };

    const marker = `PRESYNC-${testSuffix}`;
    writeSessionJsonl(
      aliceClaudeHome,
      `/tmp/e2e-sync-${testSuffix}`,
      `sess-sync-${testSuffix}`,
      `${marker} を先に書く`,
      "bob 参加前のホワイトボード",
    );
    await waitForMemberContext(ALICE_HTTP_PORT, "alice", marker);

    await waitForCondition(async () => {
      const disc = (await httpGet(BOB_HTTP_PORT, "/room/discover")) as {
        rooms: Array<{ name: string }>;
      };
      return disc.rooms.some((r) => r.name === roomName);
    });
    await httpPost(BOB_HTTP_PORT, "/room/join", { name: roomName, pin: createRes.pin });

    const summary = await waitForMemberContext(BOB_HTTP_PORT, "alice", marker);
    expect(summary).toContain(marker);
  }, 45000);

  it("@メンションが unread に届き、Live 時は context_summary 付き", async () => {
    const roomName = `e2e-mention-${testSuffix}`;
    await createRoomPair(roomName, ALICE_HTTP_PORT, BOB_HTTP_PORT);

    const marker = `MENTION-CTX-${testSuffix}`;
    writeSessionJsonl(
      aliceClaudeHome,
      `/tmp/e2e-mention-${testSuffix}`,
      `sess-mention-${testSuffix}`,
      `${marker} レビューお願い`,
      "PR を出した",
    );
    await waitForMemberContext(ALICE_HTTP_PORT, "alice", marker);

    await httpPost(ALICE_HTTP_PORT, "/mention", { to: "bob", content: `見て ${marker}` });

    await waitForCondition(async () => {
      const unread = (await httpGet(BOB_HTTP_PORT, "/unread")) as {
        total: number;
        rooms: Array<{ mentions: Array<{ content: string; context_summary?: string }> }>;
      };
      return (
        unread.total > 0 &&
        unread.rooms.some((r) =>
          r.mentions.some(
            (m) => m.content.includes(marker) && m.context_summary?.includes(marker),
          ),
        )
      );
    });
  }, 45000);

  it("notify-file の成果物が bob の /files に届く", async () => {
    const roomName = `e2e-artifact-${testSuffix}`;
    await createRoomPair(roomName, ALICE_HTTP_PORT, BOB_HTTP_PORT);

    const artifactPath = join(aliceHome, "artifact-note.md");
    writeFileSync(artifactPath, `# note ${testSuffix}\nshared artifact\n`);

    await httpPost(ALICE_HTTP_PORT, "/notify-file", { file_path: artifactPath });

    await waitForCondition(async () => {
      const files = (await httpGet(BOB_HTTP_PORT, "/files")) as Record<
        string,
        Array<{ name: string }>
      >;
      return Object.values(files)
        .flat()
        .some((f) => f.name === "artifact-note.md");
    });
  }, 30000);

  it("bob が leave 後に再 join すると再び connected になる", async () => {
    const roomName = `e2e-rejoin-${testSuffix}`;
    const { roomId, pin } = await createRoomPair(roomName, ALICE_HTTP_PORT, BOB_HTTP_PORT);

    await httpPost(BOB_HTTP_PORT, "/leave", { room_id: roomId });

    await waitForCondition(async () => {
      const status = (await httpGet(ALICE_HTTP_PORT, "/status")) as {
        rooms: Array<{ connected: string[] }>;
      };
      return status.rooms.some((r) => r.connected && !r.connected.includes("bob"));
    });

    await waitForCondition(async () => {
      const disc = (await httpGet(BOB_HTTP_PORT, "/room/discover")) as {
        rooms: Array<{ name: string }>;
      };
      return disc.rooms.some((r) => r.name === roomName);
    });
    await httpPost(BOB_HTTP_PORT, "/room/join", { name: roomName, pin });

    await waitForCondition(async () => {
      const status = (await httpGet(ALICE_HTTP_PORT, "/status")) as {
        rooms: Array<{ connected: string[] }>;
      };
      return status.rooms.some((r) => r.connected.includes("bob"));
    });
  }, 45000);
});
