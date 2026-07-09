import { describe, it, expect } from "vitest";
import { Summarizer } from "../../summarizer.js";

describe("Summarizer", () => {
  it("API キーなしでフォールバックモードになる", async () => {
    // ANTHROPIC_API_KEY が未設定の環境でテスト
    const originalKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    const summarizer = new Summarizer("claude-haiku-4-5-20251001", "invalid-key");
    const result = await summarizer.summarize([
      { role: "user", content: "JWT の設計をお願いします" },
      { role: "assistant", content: "パターンA, B, C を比較します。パターンBが推奨です。" },
    ]);

    // フォールバックで何かしら返る
    expect(result).toBeTruthy();
    expect(result.length).toBeGreaterThan(0);

    if (originalKey) process.env.ANTHROPIC_API_KEY = originalKey;
  });

  it("空の turns で空文字を返す", async () => {
    const summarizer = new Summarizer("claude-haiku-4-5-20251001");
    const result = await summarizer.summarize([]);
    expect(result).toBe("");
  });

  it("フォールバックサマリがユーザーとアシスタントの内容を含む", async () => {
    const summarizer = new Summarizer("claude-haiku-4-5-20251001", "invalid-key");
    const result = await summarizer.summarize([
      { role: "user", content: "認証設計を検討" },
      { role: "assistant", content: "JWTパターンBを推奨します" },
    ]);

    expect(result).toContain("認証設計を検討");
    expect(result).toContain("JWTパターンBを推奨します");
  });
});
