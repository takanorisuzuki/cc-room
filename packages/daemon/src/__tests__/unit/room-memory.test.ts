import { describe, it, expect } from "vitest";
import {
  slugFromContent,
  indexDescription,
  buildMemoryIndex,
  buildL0Injection,
  buildEntryMarkdown,
  isValidRoomMemorySlug,
} from "../../room-memory.js";

describe("room-memory", () => {
  describe("slugFromContent", () => {
    it("ASCII テキストから slug を生成する", () => {
      const slug = slugFromContent("Server Actions are preferred", new Set());
      expect(slug).toBe("server-actions-are-preferred");
    });

    it("重複時は連番を付与する", () => {
      const existing = new Set(["hello-world"]);
      expect(slugFromContent("Hello World!", existing)).toBe("hello-world-2");
    });

    it("短い非ASCIIはハッシュベース slug を使う", () => {
      const slug = slugFromContent("日本語のみ", new Set());
      expect(slug).toMatch(/^entry-[a-f0-9]{8}$/);
    });
  });

  describe("indexDescription", () => {
    it("先頭行を80文字以内に切り詰める", () => {
      const long = "a".repeat(100);
      expect(indexDescription(long).length).toBe(80);
      expect(indexDescription(long).endsWith("...")).toBe(true);
    });
  });

  describe("buildMemoryIndex / buildL0Injection", () => {
    const entries = [
      { slug: "jwt-policy", description: "JWT方針", filename: "jwt-policy.md" },
    ];

    it("MEMORY.md 索引を生成する", () => {
      const index = buildMemoryIndex(entries);
      expect(index).toContain("jwt-policy.md");
      expect(index).toContain("JWT方針");
    });

    it("L0 注入ブロックを生成する", () => {
      const block = buildL0Injection(entries);
      expect(block).toContain("<cc-room-memory>");
      expect(block).toContain("チームメモリによると");
      expect(block).toContain("jwt-policy");
    });

    it("ルーム名付き L0 を生成する", () => {
      const block = buildL0Injection(entries, "auth-feature");
      expect(block).toContain("auth-feature, 1件");
    });

    it("空のとき L0 は空文字", () => {
      expect(buildL0Injection([])).toBe("");
    });
  });

  describe("buildEntryMarkdown", () => {
    it("frontmatter 付き markdown を生成する", () => {
      const md = buildEntryMarkdown({
        slug: "test-entry",
        description: "Test",
        content: "Body text",
        addedBy: "akira",
        sessionId: "sess-1",
      });
      expect(md).toContain("name: test-entry");
      expect(md).toContain('added_by: "akira"');
      expect(md).toContain("sess-1");
      expect(md).toContain("Body text");
    });

    it("description の YAML 特殊文字をエスケープする", () => {
      const md = buildEntryMarkdown({
        slug: "special",
        description: 'TTL: 3日 "重要"',
        content: "body",
        addedBy: "akira",
      });
      expect(md).toContain('description: "TTL: 3日 \\"重要\\""');
    });
  });

  describe("isValidRoomMemorySlug", () => {
    it("安全な slug のみ許可する", () => {
      expect(isValidRoomMemorySlug("server-actions")).toBe(true);
      expect(isValidRoomMemorySlug("../evil")).toBe(false);
      expect(isValidRoomMemorySlug("foo/bar")).toBe(false);
    });
  });
});
