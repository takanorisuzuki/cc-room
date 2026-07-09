import { describe, it, expect } from "vitest";
import { DreamMiner, DEFAULT_MINE_MODEL } from "../../dream-miner.js";
import type { SessionTranscript } from "../../session-reader.js";

function transcript(lines: Array<{ role: "user" | "assistant"; content: string }>): SessionTranscript {
  return {
    path: "/tmp/sess.jsonl",
    turns: lines.map((l) => ({ ...l, timestamp: new Date().toISOString() })),
  };
}

/** client: null の DI で fallbackMine 経路を強制する（ネットワークに出さない） */
function fallbackMiner(): DreamMiner {
  return new DreamMiner(undefined, undefined, null);
}

describe("DreamMiner (fallbackMine — API 不可時のキーワード抽出)", () => {
  it("sessions が空なら空配列を返す", async () => {
    expect(await fallbackMiner().mine([], null)).toEqual([]);
  });

  it("決定キーワードを含む行を decision として抽出する", async () => {
    const miner = fallbackMiner();
    const candidates = await miner.mine(
      [
        transcript([
          { role: "user", content: "エラーの扱いどうする？" },
          { role: "assistant", content: "API エラーは Result 型で返す方針に決めた。throw は boundary のみ" },
        ]),
      ],
      null,
    );
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0].category).toBe("decision");
    expect(candidates[0].confidence).toBeGreaterThanOrEqual(0.7);
    expect(candidates[0].action).toBe("create");
  });

  it("発見キーワード（原因/罠）は discovery になる", async () => {
    const miner = fallbackMiner();
    const candidates = await miner.mine(
      [
        transcript([
          { role: "assistant", content: "ビルド失敗の原因は tsconfig の paths 設定だった" },
        ]),
      ],
      null,
    );
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0].category).toBe("discovery");
  });

  it("キーワードに合致しない雑談からは抽出しない", async () => {
    const miner = fallbackMiner();
    const candidates = await miner.mine(
      [
        transcript([
          { role: "user", content: "おはようございます" },
          { role: "assistant", content: "おはようございます。今日は何をしますか" },
        ]),
      ],
      null,
    );
    expect(candidates).toEqual([]);
  });

  it("候補は最大 3 件で打ち切る", async () => {
    const miner = fallbackMiner();
    const lines = Array.from({ length: 10 }, (_, i) => ({
      role: "assistant" as const,
      content: `パターン ${i}: この書き方を優先すべきという知見がある`,
    }));
    const candidates = await miner.mine([transcript(lines)], null);
    expect(candidates.length).toBeLessThanOrEqual(3);
  });
});

describe("DreamMiner model config (#79)", () => {
  it("model 未指定ならデフォルトを使う", () => {
    const miner = new DreamMiner(undefined, undefined, null);
    expect(miner).toHaveProperty("model", DEFAULT_MINE_MODEL);
  });

  it("config の model 指定がコンストラクタ経由で反映される", () => {
    const miner = new DreamMiner(undefined, "claude-sonnet-5", null);
    expect(miner).toHaveProperty("model", "claude-sonnet-5");
  });
});
