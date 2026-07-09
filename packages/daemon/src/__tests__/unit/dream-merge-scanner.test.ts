import { describe, it, expect, vi } from "vitest";
import { DreamMergeScanner } from "../../dream-merge-scanner.js";
import type { DreamPendingMergeService, MergeExecutionResult } from "../../dream-pending-merges.js";

function mockMergeService(resultsByRoom: Record<string, MergeExecutionResult[]>) {
  return {
    scanDueMerges: vi.fn((roomId: string) => resultsByRoom[roomId] ?? []),
  };
}

describe("DreamMergeScanner", () => {
  it("全ルームをスキャンし、マージがあったルームだけ onMerged を呼ぶ", async () => {
    const results: MergeExecutionResult[] = [
      { slug: "jwt-ttl", description: "JWT TTL 1日" } as MergeExecutionResult,
    ];
    const onMerged = vi.fn();
    const scanner = new DreamMergeScanner({
      listRoomIds: () => ["room-a", "room-b"],
      mergeService: mockMergeService({ "room-a": results }),
      onMerged,
    });

    await scanner.scanAll();

    expect(onMerged).toHaveBeenCalledTimes(1);
    expect(onMerged).toHaveBeenCalledWith("room-a", results);
  });

  it("1 ルームのスキャン失敗で他のルームが止まらない", async () => {
    const onMerged = vi.fn();
    const mergeService = {
      scanDueMerges: vi.fn((roomId: string) => {
        if (roomId === "room-a") throw new Error("broken pending-merges.json");
        return [{ slug: "ok", description: "ok" } as MergeExecutionResult];
      }),
    };

    const scanner = new DreamMergeScanner({
      listRoomIds: () => ["room-a", "room-b"],
      mergeService,
      onMerged,
    });

    await scanner.scanAll();

    expect(mergeService.scanDueMerges).toHaveBeenCalledTimes(2);
    expect(onMerged).toHaveBeenCalledTimes(1);
    expect(onMerged).toHaveBeenCalledWith("room-b", expect.any(Array));
  });

  it("start が二重起動されてもタイマーは 1 つ、stop で止まる", () => {
    vi.useFakeTimers();
    try {
      const mergeService = mockMergeService({});
      const scanner = new DreamMergeScanner({
        listRoomIds: () => ["room-a"],
        mergeService,
      });
      scanner.start();
      scanner.start();
      // start() 直後の即時スキャン 1 回
      expect(mergeService.scanDueMerges).toHaveBeenCalledTimes(1);
      scanner.stop();
      vi.advanceTimersByTime(60 * 60 * 1000 * 3);
      // stop 後はタイマー発火しない
      expect(mergeService.scanDueMerges).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
