import { describe, it, expect } from "vitest";
import { PrivacyFilter } from "../../privacy-filter.js";
import type { AnnotatedTurn } from "../../privacy-filter.js";

describe("PrivacyFilter", () => {
  const defaultConfig = {
    public_tools: ["room_context", "room_status"],
    private_patterns: [],
    redact_after_private_tool: true,
  };

  it("private tool 直後の assistant turn を除外する", () => {
    const filter = new PrivacyFilter(defaultConfig);
    const turns: AnnotatedTurn[] = [
      { role: "user", content: "カレンダーを確認して" },
      { role: "assistant", content: "15時に田中さんとの会議があります", afterPrivateTool: true },
      { role: "user", content: "認証の実装を始めよう" },
      { role: "assistant", content: "JWT を使った実装を提案します" },
    ];

    const result = filter.filterTurns(turns);
    expect(result).toHaveLength(3);
    expect(result.map((t) => t.content)).not.toContain("15時に田中さんとの会議があります");
    expect(result[2].content).toBe("JWT を使った実装を提案します");
  });

  it("redact_after_private_tool が false なら除外しない", () => {
    const filter = new PrivacyFilter({ ...defaultConfig, redact_after_private_tool: false });
    const turns: AnnotatedTurn[] = [
      { role: "assistant", content: "カレンダー情報です", afterPrivateTool: true },
    ];

    const result = filter.filterTurns(turns);
    expect(result).toHaveLength(1);
  });

  it("private_patterns でメールアドレスを redact する", () => {
    const filter = new PrivacyFilter({
      ...defaultConfig,
      private_patterns: ["\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}\\b"],
    });
    const turns: AnnotatedTurn[] = [
      { role: "assistant", content: "user@example.com に送信しました" },
    ];

    const result = filter.filterTurns(turns);
    expect(result[0].content).toBe("[private] に送信しました");
  });

  it("public tool は isToolPublic で true を返す", () => {
    const filter = new PrivacyFilter(defaultConfig);
    expect(filter.isToolPublic("room_context")).toBe(true);
    expect(filter.isToolPublic("google_calendar")).toBe(false);
  });

  it("afterPrivateTool がない turn はそのまま通す", () => {
    const filter = new PrivacyFilter(defaultConfig);
    const turns: AnnotatedTurn[] = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "world" },
    ];

    const result = filter.filterTurns(turns);
    expect(result).toHaveLength(2);
  });

  it("不正な正規表現パターンはスキップする", () => {
    const filter = new PrivacyFilter({
      ...defaultConfig,
      private_patterns: ["[invalid", "\\btest\\b"],
    });
    const turns: AnnotatedTurn[] = [
      { role: "assistant", content: "this is a test message" },
    ];

    const result = filter.filterTurns(turns);
    expect(result[0].content).toBe("this is a [private] message");
  });
});
