import { describe, it, expect } from "vitest";
import {
  extractContent,
  extractToolName,
  isToolEntry,
  resolveRole,
} from "../../session-parse.js";

describe("session-parse", () => {
  it("role を type / role フィールドから解決する", () => {
    expect(resolveRole({ type: "human", content: "hi" })).toBe("user");
    expect(resolveRole({ type: "ai", content: "ok" })).toBe("assistant");
    expect(resolveRole({ role: "assistant", content: "ok" })).toBe("assistant");
    expect(resolveRole({ type: "system", content: "x" })).toBeNull();
  });

  it("content を string / message / 配列から抽出する", () => {
    expect(extractContent({ content: "plain" })).toBe("plain");
    expect(extractContent({ message: "msg" })).toBe("msg");
    expect(
      extractContent({
        content: [
          { type: "text", text: "a" },
          { type: "image", text: "skip" },
          { type: "text", text: "b" },
        ],
      }),
    ).toBe("a\nb");
    expect(
      extractContent({
        content: [null, { type: "text", text: "ok" }, undefined],
      }),
    ).toBe("ok");
  });

  it("tool エントリを検出する", () => {
    const tool = { type: "tool_use", name: "Bash" };
    expect(isToolEntry(tool)).toBe(true);
    expect(extractToolName(tool)).toBe("Bash");
    expect(extractToolName({ type: "user", message: "x" })).toBeNull();
  });
});
