import { describe, it, expect, beforeEach } from "vitest";
import { resolveLocale, setLocale, t } from "../i18n.js";

describe("resolveLocale", () => {
  it("defaults to en", () => {
    expect(resolveLocale(["node", "setup"], {})).toBe("en");
  });

  it("reads --lang ja", () => {
    expect(resolveLocale(["node", "setup", "--lang", "ja"], {})).toBe("ja");
  });

  it("reads CC_ROOM_LANG", () => {
    expect(resolveLocale(["node", "setup"], { CC_ROOM_LANG: "ja" })).toBe("ja");
  });

  it("treats jp as ja", () => {
    expect(resolveLocale(["node", "setup", "--lang=jp"], {})).toBe("ja");
  });
});

describe("t", () => {
  beforeEach(() => setLocale("en"));

  it("returns English by default", () => {
    expect(t("val.claude_ok")).toBe("Claude Code is installed");
  });

  it("switches to Japanese", () => {
    setLocale("ja");
    expect(t("val.claude_ok")).toBe("Claude Code がインストール済み");
  });
});
