import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  existsSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  DreamPendingMergeService,
  listProposalFiles,
  readPendingMergesFile,
  readMergeHistory,
  pendingMergesPath,
} from "../../dream-pending-merges.js";
import { buildProposalMarkdown } from "../../dream-proposals.js";
import { indexDescription } from "../../room-memory.js";
import type { RoomMemoryEntryInfo } from "../../room-memory.js";
import { readdirSync } from "node:fs";

function listEntriesFromDir(dir: string): RoomMemoryEntryInfo[] {
  const entries: RoomMemoryEntryInfo[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".md") || name === "MEMORY.md") continue;
    const slug = name.replace(/\.md$/, "");
    let description = slug;
    try {
      const raw = readFileSync(join(dir, name), "utf-8");
      const body = raw.match(/^---\r?\n[\s\S]*?---\r?\n([\s\S]*)/)?.[1];
      if (body) description = indexDescription(body);
    } catch {
      // keep slug
    }
    entries.push({ slug, description, filename: name });
  }
  return entries;
}

const ROOM_ID = "room-test";

function proposalMarkdown(slug: string, proposedBy: string, deadline: string): string {
  return buildProposalMarkdown({
    slug,
    description: `${slug} の説明`,
    content: `## ${slug}\n\n本文`,
    category: "decision",
    proposedBy,
    sessionId: "sess-1",
    sourceTurns: [1],
    confidence: 0.9,
    promotion: {
      promotionScore: 25,
      reason: "test",
      silentMergeEligible: true,
    },
    objectionDeadline: deadline,
  });
}

describe("DreamPendingMergeService", () => {
  let tmp: string;
  let roomMemoryDir: string;
  let proposalsDir: string;
  let service: DreamPendingMergeService;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "cc-room-pending-merge-"));
    roomMemoryDir = join(tmp, "room-memory");
    proposalsDir = join(tmp, "_proposals");
    mkdirSync(roomMemoryDir, { recursive: true });
    mkdirSync(proposalsDir, { recursive: true });
    service = new DreamPendingMergeService({
      roomMemoryDir: () => roomMemoryDir,
      proposalsDir: () => proposalsDir,
      listRoomMemoryEntries: () => listEntriesFromDir(roomMemoryDir),
    });
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("registerPendingMerge persists and deduplicates by slug", () => {
    const deadline = new Date(Date.now() + 72 * 3600 * 1000).toISOString();
    const filename = "2026-06-28-jwt-ttl.md";
    writeFileSync(join(proposalsDir, filename), proposalMarkdown("jwt-ttl", "alice", deadline));

    const first = service.registerPendingMerge({
      roomId: ROOM_ID,
      proposalSlug: "jwt-ttl",
      proposalFile: filename,
      targetSlug: "jwt-ttl",
      action: "create",
      proposedBy: "alice",
      objectionDeadline: deadline,
      silentMergeEligible: true,
    });
    const second = service.registerPendingMerge({
      roomId: ROOM_ID,
      proposalSlug: "jwt-ttl",
      proposalFile: filename,
      targetSlug: "jwt-ttl",
      action: "create",
      proposedBy: "alice",
      objectionDeadline: deadline,
      silentMergeEligible: true,
    });

    expect(first.id).toBe(second.id);
    const file = readPendingMergesFile(roomMemoryDir);
    expect(file.merges).toHaveLength(1);
  });

  it("scanDueMerges merges when deadline passed", () => {
    const past = new Date(Date.now() - 1000).toISOString();
    const filename = "2026-06-28-auth-rule.md";
    writeFileSync(join(proposalsDir, filename), proposalMarkdown("auth-rule", "bob", past));

    const merge = service.registerPendingMerge({
      roomId: ROOM_ID,
      proposalSlug: "auth-rule",
      proposalFile: filename,
      targetSlug: "auth-rule",
      action: "create",
      proposedBy: "bob",
      objectionDeadline: past,
      silentMergeEligible: true,
    });

    const results = service.scanDueMerges(ROOM_ID);
    expect(results).toHaveLength(1);
    expect(results[0].slug).toBe("auth-rule");
    expect(existsSync(join(roomMemoryDir, "auth-rule.md"))).toBe(true);
    expect(existsSync(join(roomMemoryDir, "MEMORY.md"))).toBe(true);

    const pending = readPendingMergesFile(roomMemoryDir);
    expect(pending.merges.find((m) => m.id === merge.id)?.status).toBe("merged");
    const history = readMergeHistory(roomMemoryDir);
    expect(history.some((e) => e.action === "merge")).toBe(true);
  });

  it("recordObjection skips merge", () => {
    const past = new Date(Date.now() - 1000).toISOString();
    const filename = "2026-06-28-hold-me.md";
    writeFileSync(join(proposalsDir, filename), proposalMarkdown("hold-me", "alice", past));

    service.registerPendingMerge({
      roomId: ROOM_ID,
      proposalSlug: "hold-me",
      proposalFile: filename,
      targetSlug: "hold-me",
      action: "create",
      proposedBy: "alice",
      objectionDeadline: past,
      silentMergeEligible: true,
    });

    const objection = service.recordObjection({
      roomId: ROOM_ID,
      identity: "alice",
      proposalSlug: "hold-me",
      reason: "まだ早い",
    });
    expect(objection.ok).toBe(true);

    const results = service.scanDueMerges(ROOM_ID);
    expect(results).toHaveLength(0);
    expect(existsSync(join(roomMemoryDir, "hold-me.md"))).toBe(false);
  });

  it("revertLastMerge restores snapshot", () => {
    const past = new Date(Date.now() - 1000).toISOString();
    const filename = "2026-06-28-revert-me.md";
    writeFileSync(
      join(roomMemoryDir, "revert-me.md"),
      "---\nname: revert-me\n---\n\n旧内容",
    );
    writeFileSync(join(proposalsDir, filename), proposalMarkdown("revert-me", "alice", past));

    service.registerPendingMerge({
      roomId: ROOM_ID,
      proposalSlug: "revert-me",
      proposalFile: filename,
      targetSlug: "revert-me",
      action: "update",
      proposedBy: "alice",
      objectionDeadline: past,
      silentMergeEligible: true,
    });
    service.scanDueMerges(ROOM_ID);
    expect(readFileSync(join(roomMemoryDir, "revert-me.md"), "utf-8")).toContain("本文");

    const reverted = service.revertLastMerge(ROOM_ID);
    expect(reverted.ok).toBe(true);
    expect(readFileSync(join(roomMemoryDir, "revert-me.md"), "utf-8")).toContain("旧内容");
  });

  it("extendHold pushes objection_deadline", () => {
    const soon = new Date(Date.now() + 3600 * 1000).toISOString();
    const filename = "2026-06-28-extend-me.md";
    writeFileSync(join(proposalsDir, filename), proposalMarkdown("extend-me", "alice", soon));

    service.registerPendingMerge({
      roomId: ROOM_ID,
      proposalSlug: "extend-me",
      proposalFile: filename,
      targetSlug: "extend-me",
      action: "create",
      proposedBy: "alice",
      objectionDeadline: soon,
      silentMergeEligible: true,
    });

    const held = service.extendHold({
      roomId: ROOM_ID,
      identity: "alice",
      proposalSlug: "extend-me",
      extensionHours: 72,
    });
    expect(held.ok).toBe(true);

    const pending = readPendingMergesFile(roomMemoryDir);
    const merge = pending.merges.find((m) => m.proposal_slug === "extend-me");
    expect(new Date(merge!.objection_deadline).getTime()).toBeGreaterThan(Date.now() + 70 * 3600 * 1000);
    expect(existsSync(pendingMergesPath(roomMemoryDir))).toBe(true);
  });
});

describe("parseProposalMarkdown (via listProposalFiles)", () => {
  let tmp: string;
  let proposalsDir: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "cc-room-parse-proposal-"));
    proposalsDir = join(tmp, "_proposals");
    mkdirSync(proposalsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("action: update を FM から読み戻す（#67）", () => {
    writeFileSync(
      join(proposalsDir, "upd.md"),
      buildProposalMarkdown({
        slug: "jwt-ttl",
        description: "JWT TTL 更新",
        content: "本文",
        category: "decision",
        proposedBy: "alice",
        sessionId: "s1",
        sourceTurns: [1],
        confidence: 0.9,
        promotion: { promotionScore: 0.8, reason: "test", silentMergeEligible: true },
        objectionDeadline: new Date().toISOString(),
        action: "update",
      }),
    );
    const [parsed] = listProposalFiles(proposalsDir);
    expect(parsed.action).toBe("update");
  });

  it("action 未指定（旧形式）は create として読む（後方互換）", () => {
    writeFileSync(
      join(proposalsDir, "old.md"),
      buildProposalMarkdown({
        slug: "old-entry",
        description: "旧形式",
        content: "本文",
        category: "decision",
        proposedBy: "alice",
        sessionId: "s1",
        sourceTurns: [1],
        confidence: 0.9,
        promotion: { promotionScore: 0.8, reason: "test", silentMergeEligible: true },
        objectionDeadline: new Date().toISOString(),
      }).replace(/^  action: create\n/m, ""),
    );
    const [parsed] = listProposalFiles(proposalsDir);
    expect(parsed.action).toBe("create");
  });

  it("proposed_by は metadata: ブロック内のインデント付きフィールドから読む（#68）", () => {
    // body 内に proposed_by: という文字列があっても誤マッチしない
    writeFileSync(
      join(proposalsDir, "nested.md"),
      `---
name: nested-check
description: "ネスト検証"
category: decision
scope: room
status: proposed
metadata:
  type: team-proposal
  action: create
  proposed_by: "alice \\"the-reviewer\\""
  proposed_at: 2026-07-02T00:00:00.000Z
  objection_deadline: 2026-07-05T00:00:00.000Z
  silent_merge_eligible: true
---

この提案の proposed_by: bob という記述は本文であって FM ではない
`,
    );
    const [parsed] = listProposalFiles(proposalsDir);
    expect(parsed.proposedBy).toBe('alice "the-reviewer"');
    expect(parsed.proposedAt).toBe("2026-07-02T00:00:00.000Z");
    expect(parsed.silentMergeEligible).toBe(true);
  });

  it("非引用値のインラインコメントを除外する（値中の # は残す）", () => {
    writeFileSync(
      join(proposalsDir, "comment.md"),
      `---
name: comment-check
description: "コメント検証"
category: decision
scope: room
status: proposed
metadata:
  type: team-proposal
  action: create
  proposed_by: alice#1
  proposed_at: 2026-07-02T00:00:00.000Z # 生成時刻
  objection_deadline: 2026-07-05T00:00:00.000Z
  silent_merge_eligible: true # 72h 後に自動マージ
---

本文
`,
    );
    const [parsed] = listProposalFiles(proposalsDir);
    expect(parsed.proposedBy).toBe("alice#1");
    expect(parsed.proposedAt).toBe("2026-07-02T00:00:00.000Z");
    expect(parsed.silentMergeEligible).toBe(true);
  });
});
