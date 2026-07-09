import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { once } from "node:events";
import { SessionWatcher, type ConversationTurn } from "../../watcher.js";

function waitFor(fn: () => boolean, maxMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const timer = setInterval(() => {
      try {
        if (fn()) {
          clearInterval(timer);
          resolve();
        } else if (Date.now() - start > maxMs) {
          clearInterval(timer);
          reject(new Error(`Condition not met after ${maxMs}ms`));
        }
      } catch (err) {
        clearInterval(timer);
        reject(err);
      }
    }, 100);
  });
}

function userLine(content: string): string {
  return JSON.stringify({ type: "user", message: content, timestamp: new Date().toISOString() }) + "\n";
}

function assistantLine(content: string): string {
  return JSON.stringify({ type: "assistant", message: content, timestamp: new Date().toISOString() }) + "\n";
}

function toolLine(toolName: string): string {
  // extractToolName はトップレベル type: "tool_use" | "tool_call" を見る
  return JSON.stringify({ type: "tool_use", name: toolName, timestamp: new Date().toISOString() }) + "\n";
}

describe("SessionWatcher", () => {
  let tmp: string;
  let watcher: SessionWatcher;
  let turns: ConversationTurn[];

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "cc-room-watcher-"));
    turns = [];
  });

  afterEach(() => {
    watcher?.stop();
    rmSync(tmp, { recursive: true, force: true });
  });

  /**
   * watcher を起動し、chokidar の ready まで待つ（ready 前の書き込みは検知されないため）。
   * macOS の fsevents は ready 後もイベント配信開始までわずかに遅れることがあるため
   * 短い settle を足す（固定 300ms よりは短く、ready を待たないよりは確実）。
   */
  async function startWatcher(isToolPublic?: (name: string) => boolean): Promise<void> {
    watcher = new SessionWatcher(isToolPublic);
    watcher.on("turns", (t: ConversationTurn[]) => turns.push(...t));
    const ready = once(watcher, "ready");
    watcher.start(tmp);
    await ready;
    await new Promise((r) => setTimeout(r, 100));
  }

  it("新規 jsonl ファイルからターンを検出する", async () => {
    await startWatcher();

    writeFileSync(join(tmp, "sess-1.jsonl"), userLine("JWT の設計をしたい") + assistantLine("HS256 で TTL 3 日にしましょう"));

    await waitFor(() => turns.length >= 2);
    expect(turns[0].role).toBe("user");
    expect(turns[0].content).toContain("JWT");
    expect(turns[1].role).toBe("assistant");
  });

  it("追記分だけを差分読みする（オフセット管理）", async () => {
    await startWatcher();

    const file = join(tmp, "sess-2.jsonl");
    writeFileSync(file, userLine("最初のターン"));
    await waitFor(() => turns.length >= 1);

    appendFileSync(file, assistantLine("追記されたターン"));
    await waitFor(() => turns.length >= 2);

    // 追記後も最初のターンが重複して届いていない
    expect(turns).toHaveLength(2);
    expect(turns[1].content).toContain("追記");
  }, 10000);

  it("非公開ツールの直後のターンに afterPrivateTool フラグが付く", async () => {
    // public リストを空にする = 全ツール非公開
    await startWatcher(() => false);

    writeFileSync(
      join(tmp, "sess-3.jsonl"),
      toolLine("calendar_lookup") + assistantLine("15 時に歯医者です"),
    );

    await waitFor(() => turns.length >= 1);
    expect(turns[0].afterPrivateTool).toBe(true);
  });

  it("公開ツールの後のターンにはフラグが付かない", async () => {
    await startWatcher((name) => name === "room_context");

    writeFileSync(
      join(tmp, "sess-4.jsonl"),
      toolLine("room_context") + assistantLine("ホワイトボードを確認しました"),
    );

    await waitFor(() => turns.length >= 1);
    expect(turns[0].afterPrivateTool).toBe(false);
  });

  it("不正な JSON 行はスキップして処理を続行する", async () => {
    await startWatcher();

    writeFileSync(join(tmp, "sess-5.jsonl"), "{broken json\n" + userLine("正常な行"));

    await waitFor(() => turns.length >= 1);
    expect(turns[0].content).toContain("正常");
  });

  it(".jsonl 以外のファイルは無視する", async () => {
    await startWatcher();

    // .txt と同時に囮の .jsonl を書き、囮の到着 = 処理完了とみなして固定 sleep を避ける
    writeFileSync(join(tmp, "notes.txt"), userLine("jsonl ではない"));
    writeFileSync(join(tmp, "decoy.jsonl"), userLine("囮"));

    await waitFor(() => turns.length >= 1);
    expect(turns).toHaveLength(1);
    expect(turns[0].content).toBe("囮");
  });
});
