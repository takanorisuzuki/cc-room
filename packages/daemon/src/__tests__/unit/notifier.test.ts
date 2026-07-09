import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

// CC_ROOM_HOME を tmp に向ける（モジュールロード前に設定）
let tmpHome: string;

describe("Notifier", () => {
  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), "cc-room-notifier-test-"));
    process.env.CC_ROOM_HOME = tmpHome;
    vi.resetModules();
  });

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true });
    delete process.env.CC_ROOM_HOME;
    vi.restoreAllMocks();
  });

  async function loadNotifier() {
    const { Notifier } = await import("../../notifier.js");
    return new Notifier();
  }

  it("join イベントを notifications.jsonl に追記する", async () => {
    const notifier = await loadNotifier();
    notifier.notify({ type: "join", room: "test-room", identity: "bob" });

    const path = join(tmpHome, "notifications.jsonl");
    expect(existsSync(path)).toBe(true);
    const lines = readFileSync(path, "utf-8").trim().split("\n");
    const entry = JSON.parse(lines[0]);
    expect(entry.type).toBe("join");
    expect(entry.room).toBe("test-room");
    expect(entry.identity).toBe("bob");
    expect(typeof entry.ts).toBe("string");
  });

  it("message イベントを notifications.jsonl に追記する", async () => {
    const notifier = await loadNotifier();
    notifier.notify({ type: "message", room: "test-room", from: "alice", content: "hello" });

    const path = join(tmpHome, "notifications.jsonl");
    const lines = readFileSync(path, "utf-8").trim().split("\n");
    const entry = JSON.parse(lines[0]);
    expect(entry.type).toBe("message");
    expect(entry.from).toBe("alice");
    expect(entry.content).toBe("hello");
  });

  it("複数イベントを順番に追記する", async () => {
    const notifier = await loadNotifier();
    notifier.notify({ type: "join", room: "r", identity: "bob" });
    notifier.notify({ type: "leave", room: "r", identity: "bob" });

    const path = join(tmpHome, "notifications.jsonl");
    const lines = readFileSync(path, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).type).toBe("join");
    expect(JSON.parse(lines[1]).type).toBe("leave");
  });
});
