import { createChildLogger } from "./logger.js";
import type { StorageManager } from "./storage.js";

const log = createChildLogger("room-lifecycle");

const DEFAULT_IDLE_TIMEOUT_MS = 30_000;

interface RoomLifecycleOptions {
  idleTimeoutMs?: number;
}

export class RoomLifecycle {
  private storage: StorageManager;
  private idleTimeoutMs: number;
  private idleTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private removedCallbacks: Array<(roomId: string) => void> = [];

  constructor(storage: StorageManager, opts?: RoomLifecycleOptions) {
    this.storage = storage;
    this.idleTimeoutMs = opts?.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  }

  leaveAll(): string[] {
    const rooms = this.storage.listRooms();
    const removed: string[] = [];
    for (const room of rooms) {
      this.storage.deleteRoom(room.id);
      removed.push(room.id);
    }
    log.info({ count: removed.length }, "Left all rooms");
    return removed;
  }

  markIdle(roomId: string): void {
    if (this.idleTimers.has(roomId)) return;

    const timer = setTimeout(() => {
      this.idleTimers.delete(roomId);
      const meta = this.storage.getRoomMeta(roomId);
      if (!meta) return;

      this.storage.deleteRoom(roomId);
      log.info({ roomId, name: meta.name }, "Room removed (idle timeout)");
      for (const cb of this.removedCallbacks) {
        cb(roomId);
      }
    }, this.idleTimeoutMs);

    this.idleTimers.set(roomId, timer);
  }

  markActive(roomId: string): void {
    const timer = this.idleTimers.get(roomId);
    if (timer) {
      clearTimeout(timer);
      this.idleTimers.delete(roomId);
    }
  }

  onRoomRemoved(cb: (roomId: string) => void): void {
    this.removedCallbacks.push(cb);
  }

  stop(): void {
    for (const timer of this.idleTimers.values()) {
      clearTimeout(timer);
    }
    this.idleTimers.clear();
  }
}
