import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RoomLifecycle } from "../../room-lifecycle.js";
import { StorageManager } from "../../storage.js";

describe("RoomLifecycle", () => {
  let storage: StorageManager;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "cc-room-lifecycle-"));
    storage = new StorageManager(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("shutdown (leaveAll)", () => {
    it("shutdown で全部屋のデータが削除される", () => {
      storage.createRoom({
        id: "room-1",
        name: "test-room-1",
        secret: "s1",
        members: ["alice"],
        created_at: new Date().toISOString(),
      });
      storage.createRoom({
        id: "room-2",
        name: "test-room-2",
        secret: "s2",
        members: ["alice"],
        created_at: new Date().toISOString(),
      });

      const lifecycle = new RoomLifecycle(storage);
      const removed = lifecycle.leaveAll();

      expect(removed).toEqual(["room-1", "room-2"]);
      expect(storage.listRooms()).toHaveLength(0);
    });

    it("部屋がない状態で leaveAll しても安全", () => {
      const lifecycle = new RoomLifecycle(storage);
      const removed = lifecycle.leaveAll();

      expect(removed).toEqual([]);
    });
  });

  describe("自動クリーンアップ（idle 検知）", () => {
    it("markIdle 後に timeout で部屋が削除される", () => {
      vi.useFakeTimers();

      storage.createRoom({
        id: "room-idle",
        name: "idle-room",
        secret: "s",
        members: ["alice"],
        created_at: new Date().toISOString(),
      });

      const lifecycle = new RoomLifecycle(storage, { idleTimeoutMs: 5000 });
      lifecycle.markIdle("room-idle");

      // まだ削除されていない
      expect(storage.listRooms()).toHaveLength(1);

      vi.advanceTimersByTime(5000);

      // timeout 経過で削除
      expect(storage.listRooms()).toHaveLength(0);

      vi.useRealTimers();
    });

    it("markIdle 後に markActive すると削除がキャンセルされる", () => {
      vi.useFakeTimers();

      storage.createRoom({
        id: "room-revive",
        name: "revive-room",
        secret: "s",
        members: ["alice"],
        created_at: new Date().toISOString(),
      });

      const lifecycle = new RoomLifecycle(storage, { idleTimeoutMs: 5000 });
      lifecycle.markIdle("room-revive");

      vi.advanceTimersByTime(3000);
      lifecycle.markActive("room-revive");

      vi.advanceTimersByTime(5000);

      // 削除されていない
      expect(storage.listRooms()).toHaveLength(1);

      vi.useRealTimers();
    });

    it("存在しない部屋に markIdle しても安全", () => {
      const lifecycle = new RoomLifecycle(storage, { idleTimeoutMs: 5000 });
      expect(() => lifecycle.markIdle("nonexistent")).not.toThrow();
    });

    it("onRoomRemoved コールバックが呼ばれる", () => {
      vi.useFakeTimers();

      storage.createRoom({
        id: "room-cb",
        name: "callback-room",
        secret: "s",
        members: ["alice"],
        created_at: new Date().toISOString(),
      });

      const removed: string[] = [];
      const lifecycle = new RoomLifecycle(storage, { idleTimeoutMs: 5000 });
      lifecycle.onRoomRemoved((roomId: string) => removed.push(roomId));
      lifecycle.markIdle("room-cb");

      vi.advanceTimersByTime(5000);

      expect(removed).toEqual(["room-cb"]);

      vi.useRealTimers();
    });

    it("stop で pending timer を全てクリアする", () => {
      vi.useFakeTimers();

      storage.createRoom({
        id: "room-stop",
        name: "stop-room",
        secret: "s",
        members: ["alice"],
        created_at: new Date().toISOString(),
      });

      const lifecycle = new RoomLifecycle(storage, { idleTimeoutMs: 5000 });
      lifecycle.markIdle("room-stop");
      lifecycle.stop();

      vi.advanceTimersByTime(10000);

      // stop したので削除されない
      expect(storage.listRooms()).toHaveLength(1);

      vi.useRealTimers();
    });
  });
});
