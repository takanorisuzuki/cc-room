import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { createChildLogger } from "./logger.js";

const log = createChildLogger("show-state");

export type RoomRole = "primary" | "watch";

/** v2.0: Primary 1 + Watch + グローバル Private（DEC-001/002/005） */
export interface RoomStateSnapshot {
  version: 2;
  primary_room_id: string | null;
  private: boolean;
  rooms: Record<string, { role: RoomRole }>;
}

/** v1 形式（show ON/OFF + focus）。load 時に v2 へ移行する */
interface LegacySnapshot {
  focused_room_id?: string | null;
  show_by_room?: Record<string, boolean>;
}

export class ShowStateManager {
  private primaryRoomId: string | null = null;
  private privateMode = false;
  private roles = new Map<string, RoomRole>();

  constructor(private readonly statePath: string) {}

  load(): void {
    if (!existsSync(this.statePath)) return;
    try {
      const raw = readFileSync(this.statePath, "utf-8");
      const data = JSON.parse(raw) as Partial<RoomStateSnapshot> & LegacySnapshot;
      if (data.version === 2) {
        this.primaryRoomId = data.primary_room_id ?? null;
        this.privateMode = data.private ?? false;
        this.roles = new Map(
          Object.entries(data.rooms ?? {}).map(([id, r]) => [id, r.role]),
        );
      } else {
        // v1 → v2 移行: focus を primary に、focus 中ルームの show OFF を private に読み替える
        const focused = data.focused_room_id ?? null;
        const showByRoom = data.show_by_room ?? {};
        this.primaryRoomId = focused;
        this.privateMode = focused ? !(showByRoom[focused] ?? false) : false;
        this.roles = new Map(
          Object.keys(showByRoom).map((id) => [id, id === focused ? "primary" : "watch"]),
        );
        log.info({ primary: focused, private: this.privateMode }, "show-state を v1 から v2 へ移行");
        this.persist();
      }
    } catch (err) {
      log.warn({ err, path: this.statePath }, "show-state の読み込みに失敗、初期状態で開始");
      this.primaryRoomId = null;
      this.privateMode = false;
      this.roles.clear();
    }
  }

  persist(): void {
    mkdirSync(dirname(this.statePath), { recursive: true });
    const snapshot: RoomStateSnapshot = {
      version: 2,
      primary_room_id: this.primaryRoomId,
      private: this.privateMode,
      rooms: Object.fromEntries(
        [...this.roles.entries()].map(([id, role]) => [id, { role }]),
      ),
    };
    writeFileSync(this.statePath, JSON.stringify(snapshot, null, 2), { mode: 0o600 });
  }

  /** 参加中ルーム一覧と同期（退出済みルームを除去。Primary 喪失時は残りから自動昇格） */
  syncValidRooms(validRoomIds: string[]): void {
    const valid = new Set(validRoomIds);
    let changed = false;
    for (const roomId of [...this.roles.keys()]) {
      if (!valid.has(roomId)) {
        this.roles.delete(roomId);
        changed = true;
      }
    }
    for (const roomId of validRoomIds) {
      if (!this.roles.has(roomId)) {
        this.roles.set(roomId, "watch");
        changed = true;
      }
    }
    if (this.primaryRoomId && !valid.has(this.primaryRoomId)) {
      this.primaryRoomId = null;
      changed = true;
    }
    if (!this.primaryRoomId && validRoomIds.length > 0) {
      this.primaryRoomId = validRoomIds[0];
      changed = true;
    }
    // 自己修復: primaryRoomId のルームだけが primary role を持つ状態に正す
    for (const [roomId, role] of this.roles.entries()) {
      const expected: RoomRole = roomId === this.primaryRoomId ? "primary" : "watch";
      if (role !== expected) {
        this.roles.set(roomId, expected);
        changed = true;
      }
    }
    if (changed) this.persist();
  }

  /**
   * 入室。asPrimary=true（/room open、または最初のルーム）なら Primary になり、
   * 既存 Primary は Watch に降格。それ以外は Watch（DEC-001: 2 部屋目は default Watch）。
   */
  onRoomJoin(roomId: string, options: { asPrimary?: boolean } = {}): void {
    const becomePrimary = options.asPrimary ?? this.primaryRoomId === null;
    if (becomePrimary) {
      if (this.primaryRoomId && this.primaryRoomId !== roomId) {
        this.roles.set(this.primaryRoomId, "watch");
      }
      this.primaryRoomId = roomId;
      this.roles.set(roomId, "primary");
    } else {
      this.roles.set(roomId, "watch");
    }
    this.persist();
  }

  onRoomLeave(roomId: string, remainingRoomIds: string[]): void {
    this.roles.delete(roomId);
    if (this.primaryRoomId === roomId) {
      this.primaryRoomId = remainingRoomIds[0] ?? null;
      if (this.primaryRoomId) {
        this.roles.set(this.primaryRoomId, "primary");
      }
    }
    this.persist();
  }

  /** Primary を切替。旧 Primary は Watch に降格（DESIGN.md v2.0） */
  switchPrimary(roomId: string): void {
    if (this.primaryRoomId && this.primaryRoomId !== roomId) {
      this.roles.set(this.primaryRoomId, "watch");
    }
    this.primaryRoomId = roomId;
    this.roles.set(roomId, "primary");
    this.persist();
  }

  getPrimaryRoomId(): string | null {
    return this.primaryRoomId;
  }

  getRole(roomId: string): RoomRole | null {
    return this.roles.get(roomId) ?? null;
  }

  isPrivate(): boolean {
    return this.privateMode;
  }

  setPrivate(on: boolean): void {
    this.privateMode = on;
    this.persist();
  }

  /** 公開中 = そのルームが Primary かつ Private OFF。配信・@here・Dream の判定に使う */
  isPublic(roomId: string): boolean {
    return this.primaryRoomId === roomId && !this.privateMode;
  }
}
