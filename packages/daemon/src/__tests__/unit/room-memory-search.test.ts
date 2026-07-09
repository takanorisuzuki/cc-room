import { describe, it, expect } from "vitest";
import {
  stripFrontmatter,
  searchRoomMemoryEntries,
  parseCategoryFromMarkdown,
} from "../../room-memory-search.js";

describe("room-memory-search", () => {
  const entries = [
    {
      slug: "server-actions",
      description: "Server Actions優先",
      filename: "server-actions.md",
      raw: `---
name: server-actions
description: "Server Actions優先"
category: decision
---

Server ActionsはuseEffectより優先する。`,
    },
    {
      slug: "jwt-policy",
      description: "JWT方針",
      filename: "jwt-policy.md",
      raw: `---
name: jwt-policy
description: "JWT方針"
category: decision
---

TTLは3日。`,
    },
  ];

  it("stripFrontmatter で本文のみ返す", () => {
    expect(stripFrontmatter(entries[0].raw)).toContain("Server Actions");
    expect(stripFrontmatter(entries[0].raw)).not.toContain("name:");
  });

  it("キーワードでスコア順に検索する", () => {
    const results = searchRoomMemoryEntries("room-1", entries, "Server Actions");
    expect(results[0].slug).toBe("server-actions");
    expect(results[0].body).toContain("useEffect");
  });

  it("一致なしは空配列", () => {
    expect(searchRoomMemoryEntries("room-1", entries, "graphql")).toEqual([]);
  });

  it("1文字の日本語キーワードでも検索できる", () => {
    const trapEntry = {
      slug: "pitfall",
      description: "罠",
      filename: "pitfall.md",
      raw: `---
name: pitfall
category: warning
---

これは罠です。`,
    };
    const results = searchRoomMemoryEntries("room-1", [trapEntry], "罠");
    expect(results).toHaveLength(1);
    expect(results[0].slug).toBe("pitfall");
  });

  it("category のクォートを除去してパースする", () => {
    const raw = `---
name: x
category: "decision"
---
body`;
    expect(parseCategoryFromMarkdown(raw)).toBe("decision");
  });
});
