import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { execFile } from "node:child_process";
import { stringify } from "yaml";

const MOCK_PORT = 19352;

interface RecordedRequest {
  path: string;
  body: unknown;
}

/** daemon の HTTP API を模したモックサーバー。hook が何を叩いたかを記録する */
class MockDaemon {
  server: Server;
  requests: RecordedRequest[] = [];
  responses = new Map<string, unknown>();

  constructor() {
    this.server = createServer((req: IncomingMessage, res: ServerResponse) => {
      let data = "";
      req.on("data", (c) => (data += c));
      req.on("end", () => {
        const path = (req.url ?? "/").split("?")[0];
        this.requests.push({ path, body: data ? JSON.parse(data) : undefined });
        const body = this.responses.get(path) ?? {};
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(body));
      });
    });
  }

  listen(): Promise<void> {
    return new Promise((resolve) => this.server.listen(MOCK_PORT, "127.0.0.1", resolve));
  }

  close(): Promise<void> {
    if (!this.server.listening) return Promise.resolve();
    return new Promise((resolve) => this.server.close(() => resolve()));
  }
}

function runHook(
  hookName: string,
  stdinJson: unknown,
  homeDir: string,
): Promise<{ stdout: string; code: number }> {
  const daemonPath = join(__dirname, "../../../dist/index.js");
  return new Promise((resolve, reject) => {
    const child = execFile(
      process.execPath,
      [daemonPath, "hook", hookName],
      { env: { ...process.env, CC_ROOM_HOME: homeDir }, timeout: 10000 },
      (err, stdout) => {
        if (err && err.killed) reject(new Error("hook timed out"));
        else resolve({ stdout, code: child.exitCode ?? 0 });
      },
    );
    // 子プロセスが早期終了すると write が EPIPE になる。未ハンドルだとテストランナーごと落ちる
    child.stdin?.on("error", () => {});
    child.stdin?.write(JSON.stringify(stdinJson));
    child.stdin?.end();
  });
}

describe("Hooks integration (hook モード子プロセス + モック daemon)", () => {
  let home: string;
  let mock: MockDaemon;

  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), "cc-room-hooks-"));
    // ConfigSchema は sessions/summarizer/storage が必須（オブジェクト単位の default なし）。
    // 不完全だとデフォルト config（port 7332）にフォールバックするため完全な形で書く
    writeFileSync(
      join(home, "config.yaml"),
      stringify({
        identity: { name: "tester" },
        network: { port: 19351, http_port: MOCK_PORT, mdns_service: "_cc-room._tcp" },
        trust: [],
        sessions: { default_mode: "open", share_files: true, share_context: true },
        privacy: { public_tools: [], private_patterns: [], redact_after_private_tool: true },
        summarizer: { model: "claude-haiku-4-5-20251001", interval_turns: 5, interval_seconds: 30 },
        storage: { max_bytes: 524288000, artifact_ttl_days: 30, context_ttl_days: 7, message_ttl_days: 14 },
      }),
    );
    mock = new MockDaemon();
    await mock.listen();
  });

  afterEach(async () => {
    await mock.close();
    rmSync(home, { recursive: true, force: true });
  });

  describe("post-tool-use", () => {
    it("Write ツールで file_path を /notify-file に通知する", async () => {
      await runHook("post-tool-use", {
        tool_name: "Write",
        tool_input: { file_path: "/tmp/design.md" },
      }, home);

      const notify = mock.requests.find((r) => r.path === "/notify-file");
      expect(notify).toBeTruthy();
      expect(notify!.body).toEqual({ file_path: "/tmp/design.md" });
    });

    it("Write/Edit 以外のツールでは通知しない", async () => {
      await runHook("post-tool-use", {
        tool_name: "Bash",
        tool_input: { command: "ls" },
      }, home);

      expect(mock.requests.find((r) => r.path === "/notify-file")).toBeUndefined();
    });
  });

  describe("session-stop", () => {
    it("session_id を /dream/queue に投入する", async () => {
      mock.responses.set("/dream/queue", { queued: true });
      await runHook("session-stop", { session_id: "sess-abc", cwd: "/tmp/work" }, home);

      const queue = mock.requests.find((r) => r.path === "/dream/queue");
      expect(queue).toBeTruthy();
      expect(queue!.body).toMatchObject({ session_id: "sess-abc", cwd: "/tmp/work" });
    });

    it("session_id なしなら何も呼ばない", async () => {
      await runHook("session-stop", { cwd: "/tmp/work" }, home);
      expect(mock.requests.find((r) => r.path === "/dream/queue")).toBeUndefined();
    });
  });

  describe("user-prompt-submit", () => {
    function setStatus(members: string[]): void {
      mock.responses.set("/status", {
        identity: "tester",
        private: false,
        rooms: [{ id: "r1", name: "room", members, connected: [] }],
      });
      mock.responses.set("/unread", { total: 0, rooms: [] });
      mock.responses.set("/dream/pending", { total: 0, proposals: [] });
      mock.responses.set("/memory/inject", { inject: "" });
    }

    it("@name がメンバーに存在すれば /mention を送信する", async () => {
      setStatus(["tester", "akira"]);
      await runHook("user-prompt-submit", { prompt: "@akira JWT終わったよ", session_id: "s1" }, home);

      const mention = mock.requests.find((r) => r.path === "/mention");
      expect(mention).toBeTruthy();
      expect(mention!.body).toEqual({ to: "akira", content: "JWT終わったよ" });
    });

    it("メンバーに存在しない @name は素通しする（mention 送信なし）", async () => {
      setStatus(["tester"]);
      await runHook("user-prompt-submit", { prompt: "@dataclass を使って", session_id: "s1" }, home);
      expect(mock.requests.find((r) => r.path === "/mention")).toBeUndefined();
    });

    it("@here は予約語としてメンバー照合なしで送信する", async () => {
      setStatus(["tester"]);
      await runHook("user-prompt-submit", { prompt: "@here ランチ行く人？", session_id: "s1" }, home);

      const mention = mock.requests.find((r) => r.path === "/mention");
      expect(mention).toBeTruthy();
      expect(mention!.body).toMatchObject({ to: "here" });
    });

    it("未読メンションをバナーとして注入し既読マークする", async () => {
      setStatus(["tester", "yuki"]);
      mock.responses.set("/unread", {
        total: 1,
        rooms: [{
          room_id: "r1",
          room_name: "room",
          mentions: [{ id: "m1", from: "yuki", to: "tester", content: "できたよ", ts: "", context_summary: "実装完了" }],
        }],
      });

      const { stdout } = await runHook("user-prompt-submit", { prompt: "続きやろう", session_id: "s1" }, home);

      const output = JSON.parse(stdout) as { hookSpecificOutput: { additionalContext: string } };
      expect(output.hookSpecificOutput.additionalContext).toContain("<cc-room-context>");
      expect(output.hookSpecificOutput.additionalContext).toContain("できたよ");
      expect(output.hookSpecificOutput.additionalContext).toContain("実装完了");

      const markRead = mock.requests.find((r) => r.path === "/unread/mark-read");
      expect(markRead).toBeTruthy();
      expect(markRead!.body).toEqual({ ids: ["m1"] });
    });

    it("チームメモリ索引（L0）を注入する", async () => {
      setStatus(["tester"]);
      mock.responses.set("/memory/inject", {
        inject: "<cc-room-memory>📋 チームメモリ (1件)</cc-room-memory>",
      });

      const { stdout } = await runHook("user-prompt-submit", { prompt: "作業開始", session_id: "s1" }, home);

      const output = JSON.parse(stdout) as { hookSpecificOutput: { additionalContext: string } };
      expect(output.hookSpecificOutput.additionalContext).toContain("<cc-room-memory>");
    });

    it("dream 保留提案をバナーで通知する（文言に Dream を出さない）", async () => {
      setStatus(["tester"]);
      mock.responses.set("/dream/pending", {
        total: 1,
        proposals: [{
          slug: "jwt-ttl",
          description: "JWT TTL 1日",
          category: "decision",
          room_id: "r1",
          room_name: "room",
          status: "proposed",
          proposed_by: "tester",
          proposed_at: new Date().toISOString(),
          objection_deadline: new Date(Date.now() + 72 * 3600_000).toISOString(),
        }],
      });

      const { stdout } = await runHook("user-prompt-submit", { prompt: "次は何する", session_id: "s1" }, home);

      const output = JSON.parse(stdout) as { hookSpecificOutput: { additionalContext: string } };
      const ctx = output.hookSpecificOutput.additionalContext;
      expect(ctx).toContain("<cc-room-dream-pending>");
      expect(ctx).toContain("チームへの提案");
      // UX 原則: 説明文に "Dream" を出さない。タグ名とコマンド名（/room dream ...）は
      // 内部 identifier / 実在するサブコマンド名なので対象外
      const visibleText = ctx
        .replace(/<\/?cc-room-dream-pending>/g, "")
        .replace(/\/room dream \w+/g, "");
      expect(visibleText).not.toMatch(/dream/i);
    });

    it("daemon 停止時は空レスポンスで正常終了する（Claude Code をブロックしない）", async () => {
      await mock.close();
      const { stdout, code } = await runHook("user-prompt-submit", { prompt: "hello", session_id: "s1" }, home);
      expect(code).toBe(0);
      const output = JSON.parse(stdout) as { hookSpecificOutput: { additionalContext: string } };
      expect(output.hookSpecificOutput.additionalContext).toBe("");
    });
  });
});
