import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  existsSync,
  readFileSync,
  readdirSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ChildProcess } from "node:child_process";
import { encodeProjectDir } from "../../session-reader.js";
import {
  createDaemonConfig,
  createRoomPair,
  httpGet,
  httpPost,
  killDaemon,
  startDaemon,
  waitForCondition,
  waitForHttp,
  writeDaemonConfig,
} from "./helpers.js";

const ALICE_WS_PORT = 19341;
const ALICE_HTTP_PORT = 19342;
const BOB_WS_PORT = 19343;
const BOB_HTTP_PORT = 19344;

const DREAM_CONFIG = {
  dream: {
    mine_trigger: "every_stop",
    require_show_on: true,
    silent_merge: true,
    objection_window_hours: 72,
    mine_cooldown_minutes: 0,
    max_mine_per_day: 100,
  },
};

/** fallbackMine のキーワード（決めた/方針/罠 等）+ プロジェクト成果物言及で silent merge eligible にする */
function writeSessionJsonl(claudeHome: string, cwd: string, sessionId: string): void {
  const projDir = join(claudeHome, "projects", encodeProjectDir(cwd));
  mkdirSync(projDir, { recursive: true });
  const lines = [
    JSON.stringify({ type: "user", message: "認証エラーの扱いどうする？", timestamp: new Date().toISOString() }),
    JSON.stringify({
      type: "assistant",
      message: "src/auth.ts の API エラーは Result 型で返す方針に決めた。throw は boundary のみ",
      timestamp: new Date().toISOString(),
    }),
  ];
  writeFileSync(join(projDir, `${sessionId}.jsonl`), lines.join("\n") + "\n");
}

/** 72h 待てないので全 pending merge の期限を過去に倒す（スキャンは DREAM_SCAN_INTERVAL_MS=1000 で 1 秒間隔） */
function expirePendingMerges(pendingMergesPath: string): void {
  const data = JSON.parse(readFileSync(pendingMergesPath, "utf-8")) as {
    merges: Array<{ objection_deadline: string }>;
  };
  expect(data.merges.length).toBeGreaterThan(0);
  for (const m of data.merges) {
    m.objection_deadline = new Date(Date.now() - 1000).toISOString();
  }
  writeFileSync(pendingMergesPath, JSON.stringify(data, null, 2));
}

describe("E2E: Dream フロー（Stop → _proposals → silent merge / objection / trace）", () => {
  let aliceHome: string;
  let bobHome: string;
  let aliceClaudeHome: string;
  let bobClaudeHome: string;
  let aliceProc: ChildProcess;
  let bobProc: ChildProcess;
  let testSuffix: string;
  let seq = 0;

  beforeEach(async () => {
    testSuffix = `${Date.now().toString(36)}-${seq++}`;
    aliceHome = mkdtempSync(join(tmpdir(), "cc-room-dream-alice-"));
    bobHome = mkdtempSync(join(tmpdir(), "cc-room-dream-bob-"));
    aliceClaudeHome = mkdtempSync(join(tmpdir(), "cc-dream-alice-claude-"));
    bobClaudeHome = mkdtempSync(join(tmpdir(), "cc-dream-bob-claude-"));

    writeDaemonConfig(aliceHome, createDaemonConfig("alice", ALICE_WS_PORT, ALICE_HTTP_PORT, DREAM_CONFIG));
    writeDaemonConfig(bobHome, createDaemonConfig("bob", BOB_WS_PORT, BOB_HTTP_PORT, DREAM_CONFIG));

    const daemonOpts = {
      extraEnv: { DREAM_SCAN_INTERVAL_MS: "1000" },
      dropApiKey: true,
    };
    aliceProc = startDaemon(aliceHome, { ...daemonOpts, claudeHome: aliceClaudeHome });
    bobProc = startDaemon(bobHome, { ...daemonOpts, claudeHome: bobClaudeHome });

    await Promise.all([waitForHttp(ALICE_HTTP_PORT), waitForHttp(BOB_HTTP_PORT)]);
  }, 20000);

  afterEach(async () => {
    await Promise.all([killDaemon(aliceProc), killDaemon(bobProc)]);
    rmSync(aliceHome, { recursive: true, force: true });
    rmSync(bobHome, { recursive: true, force: true });
    rmSync(aliceClaudeHome, { recursive: true, force: true });
    rmSync(bobClaudeHome, { recursive: true, force: true });
  }, 15000);

  it("alice 公開中に Stop → _proposals/ と traces/ に生成され、trace API が excerpt を返す", async () => {
    const roomName = `dream-prop-${testSuffix}`;
    const { roomId } = await createRoomPair(roomName, ALICE_HTTP_PORT, BOB_HTTP_PORT);

    const cwd = "/tmp/dream-work";
    const sessionId = `sess-${testSuffix}`;
    writeSessionJsonl(aliceClaudeHome, cwd, sessionId);

    // Stop hook 相当: /dream/queue に投入
    const queueRes = (await httpPost(ALICE_HTTP_PORT, "/dream/queue", {
      session_id: sessionId,
      cwd,
    })) as { queued: boolean };
    expect(queueRes.queued).toBe(true);

    // DreamWorker が _proposals/ と traces/ を書くまで待つ
    const proposalsDir = join(aliceHome, "rooms", roomId, "room-memory", "_proposals");
    await waitForCondition(() => existsSync(proposalsDir) && readdirSync(proposalsDir).length > 0);

    const proposalFiles = readdirSync(proposalsDir).filter((f) => f.endsWith(".md"));
    expect(proposalFiles.length).toBeGreaterThan(0);
    const proposalContent = readFileSync(join(proposalsDir, proposalFiles[0]), "utf-8");
    expect(proposalContent).toContain("team-proposal");
    expect(proposalContent).toContain("alice");

    // 個人 auto-memory にも書かれている
    const autoDir = join(aliceHome, "rooms", roomId, "members", "alice", "auto-memory");
    expect(existsSync(autoDir)).toBe(true);
    const autoFiles = readdirSync(autoDir).filter((f) => f.endsWith(".md") && f !== "MEMORY.md");
    expect(autoFiles.length).toBeGreaterThan(0);

    // traces/ に L2 原典が書かれ、/memory/trace が excerpt を返す
    const slug = autoFiles[0].replace(/\.md$/, "");
    const tracePath = join(aliceHome, "rooms", roomId, "room-memory", "traces", `${slug}.jsonl`);
    expect(existsSync(tracePath)).toBe(true);

    const traceRes = (await httpGet(
      ALICE_HTTP_PORT,
      `/memory/trace?slug=${encodeURIComponent(slug)}&room_id=${encodeURIComponent(roomId)}`,
    )) as { found: boolean; entries: Array<{ excerpt?: string; session_id?: string }> };
    expect(traceRes.found).toBe(true);
    expect(traceRes.entries.length).toBeGreaterThan(0);
    expect(traceRes.entries[0].session_id).toBe(sessionId);
  }, 40000);

  it("期限到来でサイレントマージされ、bob の room-memory に伝播する（clock 短縮）", async () => {
    const roomName = `dream-merge-${testSuffix}`;
    const { roomId } = await createRoomPair(roomName, ALICE_HTTP_PORT, BOB_HTTP_PORT);

    const cwd = "/tmp/dream-merge";
    const sessionId = `sess-merge-${testSuffix}`;
    writeSessionJsonl(aliceClaudeHome, cwd, sessionId);

    await httpPost(ALICE_HTTP_PORT, "/dream/queue", { session_id: sessionId, cwd });

    // proposal + pending merge 登録を待つ
    const pendingMergesPath = join(
      aliceHome, "rooms", roomId, "room-memory", "pending-merges.json",
    );
    await waitForCondition(() => existsSync(pendingMergesPath));

    expirePendingMerges(pendingMergesPath);

    // alice の room-memory/ にマージされる
    const aliceMemoryDir = join(aliceHome, "rooms", roomId, "room-memory");
    await waitForCondition(() => {
      if (!existsSync(aliceMemoryDir)) return false;
      return readdirSync(aliceMemoryDir).some((f) => f.endsWith(".md") && f !== "MEMORY.md");
    });

    // merge-history.jsonl に記録される
    const historyPath = join(aliceMemoryDir, "merge-history.jsonl");
    expect(existsSync(historyPath)).toBe(true);
    expect(readFileSync(historyPath, "utf-8")).toContain('"action":"merge"');

    // bob へ room_memory_sync で伝播
    const bobMemoryDir = join(bobHome, "rooms", roomId, "room-memory");
    await waitForCondition(() => {
      if (!existsSync(bobMemoryDir)) return false;
      return readdirSync(bobMemoryDir).some((f) => f.endsWith(".md") && f !== "MEMORY.md");
    }, 20000);

    // bob の MEMORY.md 索引（L0 注入元）にも反映されている
    const bobIndex = readFileSync(join(bobMemoryDir, "MEMORY.md"), "utf-8");
    expect(bobIndex.length).toBeGreaterThan(0);
  }, 60000);

  it("提案者が objection すると期限が来てもマージされない", async () => {
    const roomName = `dream-obj-${testSuffix}`;
    const { roomId } = await createRoomPair(roomName, ALICE_HTTP_PORT, BOB_HTTP_PORT);

    const cwd = "/tmp/dream-obj";
    const sessionId = `sess-obj-${testSuffix}`;
    writeSessionJsonl(aliceClaudeHome, cwd, sessionId);

    await httpPost(ALICE_HTTP_PORT, "/dream/queue", { session_id: sessionId, cwd });

    const pendingMergesPath = join(
      aliceHome, "rooms", roomId, "room-memory", "pending-merges.json",
    );
    await waitForCondition(() => existsSync(pendingMergesPath));

    // 提案者（alice）自身の保留提案が /dream/pending に見える
    const pending = (await httpGet(ALICE_HTTP_PORT, "/dream/pending")) as {
      total: number;
      proposals: Array<{ slug: string }>;
    };
    expect(pending.total).toBeGreaterThan(0);
    const slug = pending.proposals[0].slug;

    // objection → status が objected になる
    const objRes = (await httpPost(ALICE_HTTP_PORT, "/dream/objection", {
      room_id: roomId,
      proposal_slug: slug,
      reason: "まだ早い",
    })) as { ok: boolean };
    expect(objRes.ok).toBe(true);

    expirePendingMerges(pendingMergesPath);

    // スキャンが確実に走ったことを status の維持と別に観測できないため、
    // スキャン間隔（1 秒）×3 の余裕を置いてからマージされていないことを確認する
    await new Promise((r) => setTimeout(r, 3000));
    const memoryDir = join(aliceHome, "rooms", roomId, "room-memory");
    const merged = existsSync(memoryDir)
      ? readdirSync(memoryDir).filter((f) => f.endsWith(".md") && f !== "MEMORY.md")
      : [];
    expect(merged).toHaveLength(0);

    // status が objected のまま
    const after = JSON.parse(readFileSync(pendingMergesPath, "utf-8")) as {
      merges: Array<{ status: string }>;
    };
    expect(after.merges.every((m) => m.status === "objected")).toBe(true);
  }, 60000);

  it("Private ON では require_show_on により Mine されない（UX: Private ON で Mine されない）", async () => {
    // queue 拒否は enqueue 内の isPublic チェックで完結するため、bob の参加は不要
    const roomName = `dream-priv-${testSuffix}`;
    await httpPost(ALICE_HTTP_PORT, "/room/create", { name: roomName });
    await httpPost(ALICE_HTTP_PORT, "/private", { mode: "on" });

    const queueRes = (await httpPost(ALICE_HTTP_PORT, "/dream/queue", {
      session_id: `sess-priv-${testSuffix}`,
      cwd: "/tmp/dream-priv",
    })) as { queued: boolean; reason?: string };
    expect(queueRes.queued).toBe(false);
    expect(queueRes.reason).toBe("require_show_off");
  }, 40000);
});
