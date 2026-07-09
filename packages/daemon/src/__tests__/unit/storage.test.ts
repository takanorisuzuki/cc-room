import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { StorageManager } from "../../storage.js";
import type { RoomMeta } from "@cc-room/shared";

describe("StorageManager", () => {
  let tempDir: string;
  let storage: StorageManager;
  const testRoomMeta: RoomMeta = {
    id: "room-test-001",
    name: "Test Room",
    secret: "test-secret-base64url",
    members: ["akira", "yuki"],
    created_at: "2026-06-04T10:00:00Z",
  };

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "cc-room-storage-"));
    storage = new StorageManager(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("createRoom / getRoomMeta", () => {
    it("ルームを作成して meta を取得できる", () => {
      storage.createRoom(testRoomMeta);
      const meta = storage.getRoomMeta(testRoomMeta.id);
      expect(meta).toEqual(testRoomMeta);
    });

    it("存在しないルームでは null を返す", () => {
      expect(storage.getRoomMeta("nonexistent")).toBeNull();
    });

    it("パストラバーサルを含む roomId を拒否する", () => {
      expect(() => storage.roomDir("../etc")).toThrow("Invalid room ID");
      expect(() => storage.roomDir("room/../../etc")).toThrow("Invalid room ID");
      expect(() => storage.roomDir("room with spaces")).toThrow("Invalid room ID");
    });
  });

  describe("listRooms", () => {
    it("全ルームを一覧できる", () => {
      storage.createRoom(testRoomMeta);
      storage.createRoom({ ...testRoomMeta, id: "room-test-002", name: "Room 2" });
      const rooms = storage.listRooms();
      expect(rooms.length).toBe(2);
    });
  });

  describe("context", () => {
    beforeEach(() => storage.createRoom(testRoomMeta));

    it("コンテキストを書き込み・読み取りできる", () => {
      storage.writeContext(testRoomMeta.id, "akira", "JWT設計中");
      const ctx = storage.readContext(testRoomMeta.id, "akira");
      expect(ctx).toBe("JWT設計中");
    });

    it("全メンバーのコンテキストを取得できる", () => {
      storage.writeContext(testRoomMeta.id, "akira", "設計中");
      storage.writeContext(testRoomMeta.id, "yuki", "レビュー中");
      const all = storage.readAllContexts(testRoomMeta.id);
      expect(all).toEqual({ akira: "設計中", yuki: "レビュー中" });
    });

    it("パストラバーサルを含む member を拒否する", () => {
      expect(() => storage.writeContext(testRoomMeta.id, "../evil", "x")).toThrow("Invalid member identity");
      expect(() => storage.writeContext(testRoomMeta.id, "../../etc/passwd", "x")).toThrow("Invalid member identity");
      expect(() => storage.readContext(testRoomMeta.id, "../secret")).toThrow("Invalid member identity");
      expect(() => storage.writeContext(testRoomMeta.id, "user/sub", "x")).toThrow("Invalid member identity");
    });
  });

  describe("artifacts", () => {
    beforeEach(() => storage.createRoom(testRoomMeta));

    it("成果物を保存・読み取りできる", () => {
      const data = Buffer.from("# Auth Design\nJWT pattern B");
      storage.writeArtifact(testRoomMeta.id, "auth-design.md", data);
      const read = storage.readArtifact(testRoomMeta.id, "auth-design.md");
      expect(read).toEqual(data);
    });

    it("成果物一覧を取得できる", () => {
      storage.writeArtifact(testRoomMeta.id, "a.md", Buffer.from("aaa"));
      storage.writeArtifact(testRoomMeta.id, "b.md", Buffer.from("bbbb"));
      const list = storage.listArtifacts(testRoomMeta.id);
      expect(list.length).toBe(2);
      expect(list.find((f) => f.name === "a.md")?.size).toBe(3);
      expect(list.find((f) => f.name === "b.md")?.size).toBe(4);
    });
  });

  describe("messages", () => {
    beforeEach(() => storage.createRoom(testRoomMeta));

    it("メッセージを追記・読み取りできる", () => {
      storage.appendMessage(testRoomMeta.id, {
        ts: "2026-06-04T10:00:00Z",
        from: "akira",
        type: "message",
        content: "hello",
      });
      storage.appendMessage(testRoomMeta.id, {
        ts: "2026-06-04T10:01:00Z",
        from: "yuki",
        type: "message",
        content: "hi",
      });
      const msgs = storage.readMessages(testRoomMeta.id);
      expect(msgs.length).toBe(2);
      expect(msgs[0].from).toBe("akira");
    });

    it("since で フィルタできる", () => {
      storage.appendMessage(testRoomMeta.id, {
        ts: "2026-06-04T10:00:00Z",
        from: "akira",
        type: "message",
        content: "old",
      });
      storage.appendMessage(testRoomMeta.id, {
        ts: "2026-06-04T11:00:00Z",
        from: "yuki",
        type: "message",
        content: "new",
      });
      const msgs = storage.readMessages(testRoomMeta.id, "2026-06-04T10:30:00Z");
      expect(msgs.length).toBe(1);
      expect(msgs[0].from).toBe("yuki");
    });
  });

  describe("memory", () => {
    beforeEach(() => storage.createRoom(testRoomMeta));

    it("メモリを追記・読み取りできる", () => {
      storage.writeMemory(testRoomMeta.id, "JWT方針: パターンB");
      storage.writeMemory(testRoomMeta.id, "TTL: 3日");
      const mem = storage.readMemory(testRoomMeta.id);
      expect(mem).toContain("JWT方針: パターンB");
      expect(mem).toContain("TTL: 3日");
    });
  });

  describe("room memory", () => {
    beforeEach(() => storage.createRoom(testRoomMeta));

    it("rememberRoomMemory で .md と MEMORY.md を生成する", () => {
      const result = storage.rememberRoomMemory(
        testRoomMeta.id,
        "Server Actions優先",
        "akira",
        "sess-abc",
      );
      expect(result.count).toBe(1);
      expect(result.slug).toBeTruthy();

      const entries = storage.listRoomMemoryEntries(testRoomMeta.id);
      expect(entries.length).toBe(1);
      expect(entries[0].description).toContain("Server Actions");

      const index = storage.readRoomMemoryIndex(testRoomMeta.id);
      expect(index).toContain(result.slug);

      expect(storage.readMemory(testRoomMeta.id)).toContain("Server Actions優先");
    });

    it(".last-inject でセッション初回判定を記録する", () => {
      expect(storage.readLastInjectSession(testRoomMeta.id)).toBeNull();
      storage.writeLastInjectSession(testRoomMeta.id, "sess-1");
      expect(storage.readLastInjectSession(testRoomMeta.id)).toBe("sess-1");
    });

    it("applyRoomMemorySync は既存ファイルを上書きしない", () => {
      storage.rememberRoomMemory(testRoomMeta.id, "original", "akira");
      const slug = storage.listRoomMemoryEntries(testRoomMeta.id)[0].slug;
      storage.applyRoomMemorySync(testRoomMeta.id, {
        index_md: "<!-- new index -->",
        files: [{ slug, content: "---\nname: hacked\n---\noverwritten" }],
      });
      const entries = storage.listRoomMemoryEntries(testRoomMeta.id);
      expect(entries[0].description).toContain("original");
    });

    it("applyRoomMemorySync は不正な slug を拒否する", () => {
      storage.applyRoomMemorySync(testRoomMeta.id, {
        index_md: "# index",
        files: [{ slug: "../../evil", content: "---\nname: evil\n---\npwned" }],
      });
      expect(storage.listRoomMemoryEntries(testRoomMeta.id)).toHaveLength(0);
    });

    it("applyRoomMemoryRevert がエントリを削除して索引を再構築する（#69）", () => {
      storage.rememberRoomMemory(testRoomMeta.id, "keep entry", "akira");
      storage.rememberRoomMemory(testRoomMeta.id, "revert entry", "akira");
      const entries = storage.listRoomMemoryEntries(testRoomMeta.id);
      const revertSlug = entries.find((e) => e.description.includes("revert"))!.slug;

      storage.applyRoomMemoryRevert(testRoomMeta.id, revertSlug, "");

      const after = storage.listRoomMemoryEntries(testRoomMeta.id);
      expect(after).toHaveLength(1);
      expect(after[0].description).toContain("keep");
      const index = storage.readRoomMemoryIndex(testRoomMeta.id);
      expect(index).not.toContain(revertSlug);
    });

    it("applyRoomMemoryRevert が content 付きならスナップショットへ差し替える", () => {
      storage.rememberRoomMemory(testRoomMeta.id, "will be reverted", "akira");
      const slug = storage.listRoomMemoryEntries(testRoomMeta.id)[0].slug;

      storage.applyRoomMemoryRevert(
        testRoomMeta.id,
        slug,
        `---\nname: ${slug}\ndescription: "snapshot content"\n---\n\nsnapshot content`,
      );

      const entries = storage.listRoomMemoryEntries(testRoomMeta.id);
      expect(entries).toHaveLength(1);
      expect(entries[0].description).toContain("snapshot");
    });

    it("applyRoomMemoryRevert は不正な slug を拒否する", () => {
      storage.rememberRoomMemory(testRoomMeta.id, "safe entry", "akira");
      storage.applyRoomMemoryRevert(testRoomMeta.id, "../../evil", "");
      expect(storage.listRoomMemoryEntries(testRoomMeta.id)).toHaveLength(1);
    });

    it("applyRoomMemoryRevert は room-memory 未作成のルームでも例外を投げない", () => {
      // dir 不在（meta.json だけ手で消せないため未知ルーム ID で再現）でも no-op で完了する
      expect(() =>
        storage.applyRoomMemoryRevert("room-without-memory-dir", "no-such-entry", ""),
      ).not.toThrow();
      expect(storage.readRoomMemoryIndex("room-without-memory-dir")).toBeNull();
    });

    it("readAllRoomMemoryForSync が全エントリを返す", () => {
      storage.rememberRoomMemory(testRoomMeta.id, "entry one", "akira");
      storage.rememberRoomMemory(testRoomMeta.id, "entry two", "yuki");
      const payload = storage.readAllRoomMemoryForSync(testRoomMeta.id);
      expect(payload?.files).toHaveLength(2);
      expect(payload?.index_md).toContain("entry-one");
    });

    it("Dream pending を保存・読み取り・削除できる", () => {
      storage.saveDreamPending(testRoomMeta.id, [{ id: "1", title: "test" }]);
      const pending = storage.readDreamPending(testRoomMeta.id);
      expect(pending?.candidates).toHaveLength(1);
      storage.clearDreamPending(testRoomMeta.id);
      expect(storage.readDreamPending(testRoomMeta.id)).toBeNull();
    });

    it("updateRoomDream が meta.dream をマージする", () => {
      const updated = storage.updateRoomDream(testRoomMeta.id, {
        mine_trigger: "every_stop",
        session_threshold: 5,
      });
      expect(updated.dream?.mine_trigger).toBe("every_stop");
      expect(storage.getRoomMeta(testRoomMeta.id)?.dream?.session_threshold).toBe(5);
    });
  });

  describe("sha256", () => {
    it("正しいハッシュを生成する", () => {
      const hash = StorageManager.sha256(Buffer.from("hello"));
      expect(hash).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
    });
  });
});
