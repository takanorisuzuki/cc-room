import { createChildLogger } from "./logger.js";
import type { DreamPendingMergeService, MergeExecutionResult } from "./dream-pending-merges.js";

const log = createChildLogger("dream-merge-scanner");

/** 本番: 1 時間。テスト用に DREAM_SCAN_INTERVAL_MS で上書き可 */
export const DREAM_SCAN_INTERVAL_MS = Number(
  process.env.DREAM_SCAN_INTERVAL_MS ?? 60 * 60 * 1000,
);

export interface DreamMergeScannerDeps {
  listRoomIds: () => string[];
  mergeService: Pick<DreamPendingMergeService, "scanDueMerges">;
  onMerged?: (roomId: string, results: MergeExecutionResult[]) => void;
}

export class DreamMergeScanner {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly deps: DreamMergeScannerDeps) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.scanAll();
    }, DREAM_SCAN_INTERVAL_MS);
    void this.scanAll();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async scanAll(now = Date.now()): Promise<void> {
    for (const roomId of this.deps.listRoomIds()) {
      try {
        const results = this.deps.mergeService.scanDueMerges(roomId, now);
        if (results.length > 0) {
          log.info({ roomId, count: results.length }, "Silent merge completed");
          this.deps.onMerged?.(roomId, results);
        }
      } catch (err) {
        log.error({ err, roomId }, "Silent merge scan failed");
      }
    }
  }
}
