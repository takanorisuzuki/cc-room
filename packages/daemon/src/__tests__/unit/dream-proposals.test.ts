import { describe, it, expect } from "vitest";
import { extractMatchKeywords, pickSourceTurns, readTraceEntries, formatTraceForDisplay } from "../../dream-proposals.js";
import type { DreamCandidate } from "../../dream-miner.js";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("dream-proposals", () => {
  it("extractMatchKeywords pulls paths and Japanese chunks", () => {
    const keys = extractMatchKeywords("JWT TTL を src/auth.ts で 1 日に短縮");
    expect(keys).toContain("src/auth.ts");
    expect(keys.some((k) => k.includes("短縮") || k.includes("日"))).toBe(true);
  });

  it("pickSourceTurns matches turns by extracted keywords", () => {
    const candidate = {
      id: "c1",
      category: "decision",
      title: "JWT TTL",
      body: "src/auth.ts の JWT TTL を 1 日に統一",
      confidence: 0.9,
      action: "create",
    } satisfies DreamCandidate;
    const turns = [
      { role: "user" as const, content: "別の話題", turn: 1 },
      { role: "assistant" as const, content: "src/auth.ts の JWT TTL を 1 日に", turn: 2 },
    ];
    expect(pickSourceTurns(candidate, turns)).toContain(2);
  });

  it("readTraceEntries returns parsed jsonl", () => {
    const tmp = mkdtempSync(join(tmpdir(), "cc-room-trace-"));
    try {
      const tracesDir = join(tmp, "traces");
      mkdirSync(tracesDir);
      writeFileSync(
        join(tracesDir, "jwt-ttl.jsonl"),
        '{"ts":"2026-06-28T09:10:00Z","session_id":"sess-1","turn":1,"role":"user","excerpt":"TTL 短縮"}\n',
      );
      const entries = readTraceEntries(tracesDir, "jwt-ttl");
      expect(entries).toHaveLength(1);
      expect(entries[0].excerpt).toBe("TTL 短縮");
      expect(formatTraceForDisplay("jwt-ttl", entries, "auth")).toContain("L2 trace: jwt-ttl (auth)");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("readTraceEntries skips malformed jsonl lines", () => {
    const tmp = mkdtempSync(join(tmpdir(), "cc-room-trace-bad-"));
    try {
      const tracesDir = join(tmp, "traces");
      mkdirSync(tracesDir);
      writeFileSync(
        join(tracesDir, "jwt-ttl.jsonl"),
        "not-json\n" +
          '{"ts":"2026-06-28T09:10:00Z","session_id":"sess-1","turn":2,"role":"assistant","excerpt":"ok"}\n',
      );
      const entries = readTraceEntries(tracesDir, "jwt-ttl");
      expect(entries).toHaveLength(1);
      expect(entries[0].excerpt).toBe("ok");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
