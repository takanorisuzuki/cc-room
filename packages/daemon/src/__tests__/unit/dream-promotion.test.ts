import { describe, it, expect } from "vitest";
import { shouldPromoteToTeam } from "../../dream-promotion.js";

describe("shouldPromoteToTeam", () => {
  it("promotes decision with project artifacts", () => {
    const r = shouldPromoteToTeam({
      category: "decision",
      body: "src/auth.ts の JWT TTL を 1 日に統一",
      confidence: 0.9,
    });
    expect(r.promote).toBe(true);
    expect(r.reason).toBe("project_scope");
  });

  it("rejects editor preference", () => {
    const r = shouldPromoteToTeam({
      category: "pattern",
      body: "vim のキーバインドをこうした",
      confidence: 0.9,
    });
    expect(r.promote).toBe(false);
    expect(r.reason).toBe("editor_preference");
  });

  it("matches Japanese team-wide keywords without word boundaries", () => {
    const r = shouldPromoteToTeam({
      category: "warning",
      body: "本番デプロイ前に認証設定を全員で確認",
      confidence: 0.9,
    });
    expect(r.promote).toBe(true);
    expect(r.reason).toBe("team_wide");
  });

  it("returns review for ambiguous discovery", () => {
    const r = shouldPromoteToTeam({
      category: "discovery",
      body: "ログの形式を確認した",
      confidence: 0.8,
    });
    expect(r.promote).toBe("review");
    expect(r.silentMergeEligible).toBe(false);
  });
});
