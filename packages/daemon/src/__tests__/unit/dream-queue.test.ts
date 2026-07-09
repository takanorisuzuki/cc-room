import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DreamQueueService, type DreamQueueDeps } from "../../dream-queue.js";
import { ShowStateManager } from "../../show-state.js";
import type { RoomMeta } from "@cc-room/shared";

describe("DreamQueueService", () => {
  let tmp: string;
  let showState: ShowStateManager;
  const room: RoomMeta = {
    id: "room-1",
    name: "auth-feature",
    secret: "s",
    members: ["alice"],
    created_at: new Date().toISOString(),
  };

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "cc-room-dream-queue-"));
    showState = new ShowStateManager(join(tmp, "show-state.json"));
    showState.onRoomJoin(room.id, { asPrimary: true });
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  function service(overrides: Partial<DreamQueueDeps> = {}) {
    return new DreamQueueService({
      identity: "alice",
      roomsDir: join(tmp, "rooms"),
      listRooms: () => [room],
      showState,
      ...overrides,
    });
  }

  it("skips when no rooms", () => {
    const q = service({ listRooms: () => [] });
    expect(q.enqueue({ session_id: "s1" }).reason).toBe("no_rooms");
  });

  it("skips when manual_only", () => {
    const q = service();
    room.dream = { mine_trigger: "manual_only" };
    expect(q.enqueue({ session_id: "s1" }).reason).toBe("manual_only");
    delete room.dream;
  });

  it("skips when Private ON and require_show_on", () => {
    showState.setPrivate(true);
    const q = service();
    expect(q.enqueue({ session_id: "s1" }).reason).toBe("require_show_off");
  });

  it("skips until threshold with sessions_until_mine", () => {
    const q = service({ globalDream: { session_threshold: 3 } });
    const r1 = q.enqueue({ session_id: "s1" });
    expect(r1.queued).toBe(false);
    expect(r1.reason).toBe("threshold_not_reached");
    expect(r1.sessions_until_mine).toBe(2);
  });

  it("threshold 未満（N-1 回）では Mine せず、N 回目で Mine する", () => {
    const q = service({
      globalDream: { session_threshold: 20, mine_cooldown_minutes: 0 },
    });
    for (let i = 1; i <= 19; i++) {
      const r = q.enqueue({ session_id: `s-${i}` });
      expect(r.queued).toBe(false);
      expect(r.reason).toBe("threshold_not_reached");
    }
    const r20 = q.enqueue({ session_id: "s-20" });
    expect(r20.queued).toBe(true);
    expect(q.pendingJobs()).toHaveLength(1);

    // Mine 後はカウンタがリセットされ、次の Stop はまた threshold 待ちになる
    const r21 = q.enqueue({ session_id: "s-21" });
    expect(r21.queued).toBe(false);
    expect(r21.reason).toBe("threshold_not_reached");
    expect(r21.sessions_until_mine).toBe(19);
  });

  it("queues on every_stop", () => {
    const q = service({ globalDream: { mine_trigger: "every_stop" } });
    const r = q.enqueue({ session_id: "s1" });
    expect(r.queued).toBe(true);
    expect(q.pendingJobs()).toHaveLength(1);
  });

  it("deduplicates session_id", () => {
    const q = service({ globalDream: { mine_trigger: "every_stop" } });
    q.enqueue({ session_id: "s1" });
    expect(q.enqueue({ session_id: "s1" }).reason).toBe("duplicate_session");
  });

  it("rejects non-string session_id", () => {
    const q = service({ globalDream: { mine_trigger: "every_stop" } });
    expect(() => q.enqueue({ session_id: 1 as unknown as string })).toThrow(
      /session_id must be a string/,
    );
  });
});
