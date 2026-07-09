import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ShowStateManager } from "../../show-state.js";

describe("ShowStateManager (v2: Primary + Watch + Private)", () => {
  let tmpDir: string;
  let statePath: string;
  let manager: ShowStateManager;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "cc-room-show-"));
    statePath = join(tmpDir, "show-state.json");
    manager = new ShowStateManager(statePath);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("最初のルームは Primary になる", () => {
    manager.onRoomJoin("room-a");
    expect(manager.getPrimaryRoomId()).toBe("room-a");
    expect(manager.getRole("room-a")).toBe("primary");
  });

  it("2 部屋目は default Watch（DEC-001）", () => {
    manager.onRoomJoin("room-a");
    manager.onRoomJoin("room-b");
    expect(manager.getPrimaryRoomId()).toBe("room-a");
    expect(manager.getRole("room-b")).toBe("watch");
  });

  it("asPrimary で入室すると旧 Primary は Watch に降格", () => {
    manager.onRoomJoin("room-a");
    manager.onRoomJoin("room-b", { asPrimary: true });
    expect(manager.getPrimaryRoomId()).toBe("room-b");
    expect(manager.getRole("room-a")).toBe("watch");
  });

  it("switchPrimary で Primary を切替、旧 Primary は Watch に降格", () => {
    manager.onRoomJoin("room-a");
    manager.onRoomJoin("room-b");
    manager.switchPrimary("room-b");
    expect(manager.getPrimaryRoomId()).toBe("room-b");
    expect(manager.getRole("room-a")).toBe("watch");
    expect(manager.getRole("room-b")).toBe("primary");
  });

  it("Primary 退出時は残存ルームへ自動昇格", () => {
    manager.onRoomJoin("room-a");
    manager.onRoomJoin("room-b");
    manager.onRoomLeave("room-a", ["room-b"]);
    expect(manager.getPrimaryRoomId()).toBe("room-b");
    expect(manager.getRole("room-b")).toBe("primary");
  });

  it("isPublic は Primary かつ Private OFF のときのみ true", () => {
    manager.onRoomJoin("room-a");
    manager.onRoomJoin("room-b");
    expect(manager.isPublic("room-a")).toBe(true);
    expect(manager.isPublic("room-b")).toBe(false); // Watch は常に非公開
    manager.setPrivate(true);
    expect(manager.isPublic("room-a")).toBe(false); // Private ON
  });

  it("persist / load で状態を復元する", () => {
    manager.onRoomJoin("room-a");
    manager.onRoomJoin("room-b");
    manager.setPrivate(true);
    const reloaded = new ShowStateManager(statePath);
    reloaded.load();
    expect(reloaded.getPrimaryRoomId()).toBe("room-a");
    expect(reloaded.getRole("room-b")).toBe("watch");
    expect(reloaded.isPrivate()).toBe(true);
  });

  it("v1 形式（focused + show_by_room）を v2 に移行して読み込む", () => {
    writeFileSync(
      statePath,
      JSON.stringify({
        focused_room_id: "room-a",
        show_by_room: { "room-a": false, "room-b": true },
      }),
    );
    manager.load();
    expect(manager.getPrimaryRoomId()).toBe("room-a");
    expect(manager.getRole("room-a")).toBe("primary");
    expect(manager.getRole("room-b")).toBe("watch");
    // focus 中ルームが show OFF だったので Private ON に読み替え
    expect(manager.isPrivate()).toBe(true);
  });

  it("syncValidRooms で退出済みルームを除去して永続化する", () => {
    manager.onRoomJoin("room-a");
    manager.onRoomJoin("room-b", { asPrimary: true });
    manager.syncValidRooms(["room-a"]);
    const reloaded = new ShowStateManager(statePath);
    reloaded.load();
    expect(reloaded.getRole("room-b")).toBeNull();
    expect(reloaded.getPrimaryRoomId()).toBe("room-a");
  });

  it("syncValidRooms で未知の参加中ルームを Watch として補完する", () => {
    manager.onRoomJoin("room-a");
    manager.syncValidRooms(["room-a", "room-c"]);
    expect(manager.getRole("room-c")).toBe("watch");
    expect(manager.getPrimaryRoomId()).toBe("room-a");
  });

  it("syncValidRooms が primaryRoomId と roles の不整合を自己修復する", () => {
    // 破損した v2 ファイル相当: primary_room_id と rooms[].role が食い違う
    writeFileSync(
      statePath,
      JSON.stringify({
        version: 2,
        primary_room_id: "room-a",
        private: false,
        rooms: { "room-a": { role: "watch" }, "room-b": { role: "primary" } },
      }),
    );
    manager.load();
    manager.syncValidRooms(["room-a", "room-b"]);
    expect(manager.getPrimaryRoomId()).toBe("room-a");
    expect(manager.getRole("room-a")).toBe("primary");
    expect(manager.getRole("room-b")).toBe("watch");
  });

  it("syncValidRooms で Primary 喪失時の自動昇格が role にも反映される", () => {
    manager.onRoomJoin("room-a");
    manager.onRoomJoin("room-b");
    manager.syncValidRooms(["room-b"]);
    expect(manager.getPrimaryRoomId()).toBe("room-b");
    expect(manager.getRole("room-b")).toBe("primary");
  });
});
