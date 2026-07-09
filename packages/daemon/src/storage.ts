import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  renameSync,
  unlinkSync,
  appendFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { join, basename } from "node:path";
import { createHash } from "node:crypto";
import { ROOMS_DIR } from "./config.js";
import {
  buildEntryMarkdown,
  buildMemoryIndex,
  indexDescription,
  parseDescriptionFromRaw,
  slugFromContent,
  isValidRoomMemorySlug,
  type RoomMemoryEntryInfo,
} from "./room-memory.js";
import type { RoomMeta, FileShareType, RoomMemorySyncPayload } from "@cc-room/shared";
import { createChildLogger } from "./logger.js";

export interface MentionEntry {
  id: string;
  ts: string;
  from: string;
  to: string;
  content: string;
  context_summary?: string;
  context_summary_ts?: string;
  read: boolean;
}

export interface PendingShareEntry {
  id: string;
  ts: string;
  room_id: string;
  from: string;
  share_type: FileShareType;
  filename: string;
  content: string;
  save_path: string;
}

const log = createChildLogger("storage");

export class StorageManager {
  private roomsDir: string;

  constructor(roomsDir?: string) {
    this.roomsDir = roomsDir || ROOMS_DIR;
    mkdirSync(this.roomsDir, { recursive: true });
  }

  getRoomsDir(): string {
    return this.roomsDir;
  }

  roomDir(roomId: string): string {
    if (!/^[a-zA-Z0-9_-]+$/.test(roomId)) {
      throw new Error("Invalid room ID");
    }
    return join(this.roomsDir, roomId);
  }

  createRoom(meta: RoomMeta): void {
    const dir = this.roomDir(meta.id);
    mkdirSync(join(dir, "context"), { recursive: true });
    mkdirSync(join(dir, "artifacts"), { recursive: true });
    mkdirSync(join(dir, "room-memory"), { recursive: true });
    writeFileSync(join(dir, "meta.json"), JSON.stringify(meta, null, 2), {
      mode: 0o600,
    });
    log.info({ roomId: meta.id, name: meta.name }, "Room created");
  }

  getRoomMeta(roomId: string): RoomMeta | null {
    const path = join(this.roomDir(roomId), "meta.json");
    try {
      return JSON.parse(readFileSync(path, "utf-8")) as RoomMeta;
    } catch {
      return null;
    }
  }

  updateRoomDream(roomId: string, patch: RoomMeta["dream"]): RoomMeta {
    const meta = this.getRoomMeta(roomId);
    if (!meta) throw new Error("ルームが見つかりません");
    meta.dream = { ...meta.dream, ...patch };
    writeFileSync(join(this.roomDir(roomId), "meta.json"), JSON.stringify(meta, null, 2), {
      mode: 0o600,
    });
    return meta;
  }

  deleteRoom(roomId: string): void {
    const dir = this.roomDir(roomId);
    try {
      rmSync(dir, { recursive: true, force: true });
      log.info({ roomId }, "Room deleted");
    } catch (err) {
      log.error({ err, roomId }, "Failed to delete room");
    }
  }

  listRooms(): RoomMeta[] {
    try {
      return readdirSync(this.roomsDir)
        .map((id) => this.getRoomMeta(id))
        .filter((m): m is RoomMeta => m !== null);
    } catch {
      return [];
    }
  }

  private validateMember(member: string): string {
    if (!/^[a-zA-Z0-9._-]+$/.test(member)) {
      throw new Error("Invalid member identity");
    }
    return member;
  }

  writeContext(roomId: string, member: string, summary: string): void {
    const safeMember = this.validateMember(member);
    const path = join(this.roomDir(roomId), "context", `${safeMember}.md`);
    const tempPath = path + ".tmp";
    writeFileSync(tempPath, summary, { mode: 0o644 });
    renameSync(tempPath, path);
  }

  readContext(roomId: string, member: string): string | null {
    const safeMember = this.validateMember(member);
    const path = join(this.roomDir(roomId), "context", `${safeMember}.md`);
    try {
      return readFileSync(path, "utf-8");
    } catch {
      return null;
    }
  }

  readAllContexts(roomId: string): Record<string, string> {
    const dir = join(this.roomDir(roomId), "context");
    const result: Record<string, string> = {};
    try {
      for (const file of readdirSync(dir)) {
        if (!file.endsWith(".md")) continue;
        const member = file.slice(0, -3);
        try {
          this.validateMember(member);
          result[member] = readFileSync(join(dir, file), "utf-8");
        } catch {
          log.warn({ file }, "Skipping context file with invalid member name");
        }
      }
    } catch {
      // ディレクトリが存在しない場合は空を返す
    }
    return result;
  }

  writeArtifact(roomId: string, filename: string, data: Buffer): string {
    const safeFilename = basename(filename);
    const dir = join(this.roomDir(roomId), "artifacts");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, safeFilename);
    const tempPath = path + ".tmp";
    writeFileSync(tempPath, data, { mode: 0o644 });
    renameSync(tempPath, path);
    return path;
  }

  readArtifact(roomId: string, filename: string): Buffer | null {
    const safeFilename = basename(filename);
    const path = join(this.roomDir(roomId), "artifacts", safeFilename);
    try {
      return readFileSync(path);
    } catch {
      return null;
    }
  }

  listArtifacts(roomId: string): Array<{ name: string; size: number }> {
    const dir = join(this.roomDir(roomId), "artifacts");
    try {
      return readdirSync(dir).map((name) => {
        const stat = statSync(join(dir, name));
        return { name, size: stat.size };
      });
    } catch {
      return [];
    }
  }

  appendMessage(
    roomId: string,
    entry: { ts: string; from: string; type: string; [key: string]: unknown },
  ): void {
    const path = join(this.roomDir(roomId), "messages.jsonl");
    appendFileSync(path, JSON.stringify(entry) + "\n");
  }

  readMessages(roomId: string, since?: string): Array<Record<string, unknown>> {
    const path = join(this.roomDir(roomId), "messages.jsonl");
    try {
      const lines = readFileSync(path, "utf-8").trim().split("\n");
      const messages = lines
        .filter((l) => l.length > 0)
        .map((l) => {
          try {
            return JSON.parse(l) as Record<string, unknown>;
          } catch {
            return null;
          }
        })
        .filter((m): m is Record<string, unknown> => m !== null);
      if (since) {
        return messages.filter((m) => (m.ts as string) > since);
      }
      return messages;
    } catch {
      return [];
    }
  }

  writeMemory(roomId: string, content: string): void {
    const path = join(this.roomDir(roomId), "memory.md");
    appendFileSync(path, content + "\n");
  }

  readMemory(roomId: string): string | null {
    const path = join(this.roomDir(roomId), "memory.md");
    try {
      return readFileSync(path, "utf-8");
    } catch {
      return null;
    }
  }

  roomMemoryDir(roomId: string): string {
    return join(this.roomDir(roomId), "room-memory");
  }

  memberDir(roomId: string, identity: string): string {
    return join(this.roomDir(roomId), "members", identity);
  }

  memberAutoMemoryDir(roomId: string, identity: string): string {
    return join(this.memberDir(roomId, identity), "auto-memory");
  }

  proposalsDir(roomId: string): string {
    return join(this.roomMemoryDir(roomId), "_proposals");
  }

  listProposalSlugs(roomId: string): Set<string> {
    const dir = this.proposalsDir(roomId);
    if (!existsSync(dir)) return new Set();
    const slugs = new Set<string>();
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".md")) continue;
      const base = name.replace(/\.md$/, "");
      const slug = base.includes("-") ? base.replace(/^\d{4}-\d{2}-\d{2}-/, "") : base;
      slugs.add(slug);
    }
    return slugs;
  }

  listRoomMemorySlugSet(roomId: string): Set<string> {
    return new Set(this.listRoomMemoryEntries(roomId).map((e) => e.slug));
  }

  listRoomMemoryEntries(roomId: string): RoomMemoryEntryInfo[] {
    const dir = this.roomMemoryDir(roomId);
    if (!existsSync(dir)) return [];
    const entries: RoomMemoryEntryInfo[] = [];
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".md") || name === "MEMORY.md") continue;
      const slug = name.replace(/\.md$/, "");
      let description = slug;
      try {
        const raw = readFileSync(join(dir, name), "utf-8");
        description = parseDescriptionFromRaw(raw, slug);
      } catch {
        // keep slug as description
      }
      entries.push({ slug, description, filename: name });
    }
    entries.sort((a, b) => a.slug.localeCompare(b.slug));
    return entries;
  }

  rememberRoomMemory(
    roomId: string,
    content: string,
    addedBy: string,
    sessionId?: string,
  ): { slug: string; count: number; description: string } {
    const dir = this.roomMemoryDir(roomId);
    mkdirSync(dir, { recursive: true });
    const existing = new Set(this.listRoomMemoryEntries(roomId).map((e) => e.slug));
    const slug = slugFromContent(content, existing);
    const description = indexDescription(content);
    const md = buildEntryMarkdown({ slug, description, content, addedBy, sessionId });
    writeFileSync(join(dir, `${slug}.md`), md, { mode: 0o644 });
    const entries = this.listRoomMemoryEntries(roomId);
    writeFileSync(join(dir, "MEMORY.md"), buildMemoryIndex(entries), { mode: 0o644 });
    // 後方互換: 旧 memory.md にも追記
    this.writeMemory(roomId, content);
    return { slug, count: entries.length, description };
  }

  readLastInjectSession(roomId: string): string | null {
    const path = join(this.roomDir(roomId), ".last-inject");
    try {
      return readFileSync(path, "utf-8").trim() || null;
    } catch {
      return null;
    }
  }

  writeLastInjectSession(roomId: string, sessionId: string): void {
    writeFileSync(join(this.roomDir(roomId), ".last-inject"), sessionId + "\n", { mode: 0o644 });
  }

  applyRoomMemorySync(
    roomId: string,
    payload: { index_md: string; files: Array<{ slug: string; content: string }> },
  ): void {
    const dir = this.roomMemoryDir(roomId);
    mkdirSync(dir, { recursive: true });
    for (const file of payload.files) {
      if (!isValidRoomMemorySlug(file.slug)) {
        log.warn({ slug: file.slug, roomId }, "room_memory_sync: invalid slug, skipping");
        continue;
      }
      const path = join(dir, `${file.slug}.md`);
      if (!existsSync(path)) {
        writeFileSync(path, file.content, { mode: 0o644 });
      }
    }
    const indexPath = join(dir, "MEMORY.md");
    if (!existsSync(indexPath) && payload.index_md) {
      writeFileSync(indexPath, payload.index_md, { mode: 0o644 });
    }
  }

  /** revert の伝達: エントリを削除（content 空）or スナップショットへ差し替えし、索引を再構築する */
  applyRoomMemoryRevert(roomId: string, slug: string, content: string): void {
    if (!isValidRoomMemorySlug(slug)) {
      log.warn({ slug, roomId }, "room_memory_revert: invalid slug, skipping");
      return;
    }
    const dir = this.roomMemoryDir(roomId);
    const path = join(dir, `${slug}.md`);
    if (content) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(path, content, { mode: 0o644 });
    } else if (existsSync(path)) {
      unlinkSync(path);
    }
    // 削除のみで dir 自体が存在しないケースでは索引を作る必要がない（ENOENT 防止）
    if (existsSync(dir)) {
      const entries = this.listRoomMemoryEntries(roomId);
      writeFileSync(join(dir, "MEMORY.md"), buildMemoryIndex(entries), { mode: 0o644 });
    }
  }

  readRoomMemoryIndex(roomId: string): string | null {
    const path = join(this.roomMemoryDir(roomId), "MEMORY.md");
    try {
      return readFileSync(path, "utf-8");
    } catch {
      return null;
    }
  }

  readAllRoomMemoryForSync(roomId: string): RoomMemorySyncPayload | null {
    const entries = this.listRoomMemoryEntries(roomId);
    if (entries.length === 0) return null;
    const dir = this.roomMemoryDir(roomId);
    const files = entries.map((e) => ({
      slug: e.slug,
      content: readFileSync(join(dir, e.filename), "utf-8"),
    }));
    return {
      index_md: this.readRoomMemoryIndex(roomId) ?? "",
      files,
    };
  }

  listRoomMemoryEntriesWithRaw(roomId: string): Array<RoomMemoryEntryInfo & { raw: string }> {
    const dir = this.roomMemoryDir(roomId);
    if (!existsSync(dir)) return [];
    const result: Array<RoomMemoryEntryInfo & { raw: string }> = [];
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".md") || name === "MEMORY.md") continue;
      const slug = name.replace(/\.md$/, "");
      let raw = "";
      let description = slug;
      try {
        raw = readFileSync(join(dir, name), "utf-8");
        description = parseDescriptionFromRaw(raw, slug);
      } catch {
        // keep slug/description as-is
      }
      result.push({ slug, description, filename: name, raw });
    }
    result.sort((a, b) => a.slug.localeCompare(b.slug));
    return result;
  }

  saveDreamPending(roomId: string, candidates: unknown[]): void {
    const path = join(this.roomMemoryDir(roomId), "_dream-pending.json");
    mkdirSync(this.roomMemoryDir(roomId), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({ ts: new Date().toISOString(), candidates }, null, 2),
      { mode: 0o644 },
    );
  }

  readDreamPending(roomId: string): { ts: string; candidates: unknown[] } | null {
    const path = join(this.roomMemoryDir(roomId), "_dream-pending.json");
    try {
      const data = JSON.parse(readFileSync(path, "utf-8")) as { ts?: string; candidates?: unknown[] };
      if (!Array.isArray(data.candidates)) return null;
      return { ts: data.ts ?? "", candidates: data.candidates };
    } catch {
      return null;
    }
  }

  clearDreamPending(roomId: string): void {
    const path = join(this.roomMemoryDir(roomId), "_dream-pending.json");
    try {
      unlinkSync(path);
    } catch {
      // already cleared
    }
  }

  cleanup(config: {
    artifact_ttl_days: number;
    context_ttl_days: number;
    message_ttl_days: number;
    max_bytes: number;
  }): { deletedFiles: number; freedBytes: number } {
    let deletedFiles = 0;
    let freedBytes = 0;
    const now = Date.now();

    for (const room of this.listRooms()) {
      const roomPath = this.roomDir(room.id);

      // artifacts TTL
      const artifactsDir = join(roomPath, "artifacts");
      deletedFiles += this.purgeOldFiles(
        artifactsDir,
        now - config.artifact_ttl_days * 86_400_000,
      );

      // context TTL
      const contextDir = join(roomPath, "context");
      deletedFiles += this.purgeOldFiles(
        contextDir,
        now - config.context_ttl_days * 86_400_000,
      );

      // messages TTL — truncate old entries
      const messagesPath = join(roomPath, "messages.jsonl");
      const cutoff = new Date(
        now - config.message_ttl_days * 86_400_000,
      ).toISOString();
      freedBytes += this.truncateMessages(messagesPath, cutoff);

      // mentions TTL — same cutoff as messages
      const mentionsPath = join(roomPath, "mentions.jsonl");
      freedBytes += this.truncateMessages(mentionsPath, cutoff);
    }

    // LRU eviction if still over budget
    const totalSize = this.getTotalSize();
    if (totalSize > config.max_bytes) {
      const evicted = this.evictLRU(totalSize - config.max_bytes);
      deletedFiles += evicted.count;
      freedBytes += evicted.bytes;
    }

    if (deletedFiles > 0) {
      log.info({ deletedFiles, freedBytes }, "Storage cleanup completed");
    }
    return { deletedFiles, freedBytes };
  }

  private purgeOldFiles(dir: string, cutoffMs: number): number {
    let count = 0;
    let files: string[] = [];
    try {
      files = readdirSync(dir);
    } catch {
      return 0;
    }

    for (const file of files) {
      const filePath = join(dir, file);
      try {
        const stat = statSync(filePath);
        if (stat.mtimeMs < cutoffMs) {
          unlinkSync(filePath);
          count++;
        }
      } catch {
        // 個別ファイルのエラーは無視して続行
      }
    }
    return count;
  }

  private truncateMessages(path: string, cutoffIso: string): number {
    try {
      const content = readFileSync(path, "utf-8");
      const lines = content.trim().split("\n").filter((l) => l.length > 0);
      const kept: string[] = [];
      let freedBytes = 0;

      for (const line of lines) {
        try {
          const msg = JSON.parse(line) as { ts?: string };
          if (msg.ts && msg.ts >= cutoffIso) {
            kept.push(line);
          } else {
            freedBytes += Buffer.byteLength(line + "\n");
          }
        } catch {
          kept.push(line);
        }
      }

      if (kept.length < lines.length) {
        writeFileSync(path, kept.join("\n") + "\n");
      }
      return freedBytes;
    } catch {
      return 0;
    }
  }

  getTotalSize(): number {
    let total = 0;
    try {
      for (const roomId of readdirSync(this.roomsDir)) {
        total += this.getDirSize(join(this.roomsDir, roomId));
      }
    } catch {
      // ignore
    }
    return total;
  }

  private getDirSize(dir: string): number {
    let size = 0;
    try {
      for (const entry of readdirSync(dir)) {
        const fullPath = join(dir, entry);
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          size += this.getDirSize(fullPath);
        } else {
          size += stat.size;
        }
      }
    } catch {
      // ignore
    }
    return size;
  }

  private evictLRU(bytesToFree: number): { count: number; bytes: number } {
    const files: Array<{ path: string; size: number; mtimeMs: number }> = [];
    let roomIds: string[] = [];
    try {
      roomIds = readdirSync(this.roomsDir);
    } catch {
      return { count: 0, bytes: 0 };
    }

    for (const roomId of roomIds) {
      const artifactsDir = join(this.roomsDir, roomId, "artifacts");
      try {
        for (const file of readdirSync(artifactsDir)) {
          const filePath = join(artifactsDir, file);
          try {
            const stat = statSync(filePath);
            files.push({ path: filePath, size: stat.size, mtimeMs: stat.mtimeMs });
          } catch {
            // 個別ファイルのエラーは無視
          }
        }
      } catch {
        // ignore
      }
    }

    files.sort((a, b) => a.mtimeMs - b.mtimeMs);

    let freed = 0;
    let count = 0;
    for (const file of files) {
      if (freed >= bytesToFree) break;
      try {
        unlinkSync(file.path);
        freed += file.size;
        count++;
      } catch {
        // ignore
      }
    }
    return { count, bytes: freed };
  }

  // --- pending（承認待ちファイル共有） ---

  savePending(roomId: string, entry: PendingShareEntry): void {
    const dir = join(this.roomDir(roomId), "pending");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${entry.id}.json`);
    writeFileSync(path, JSON.stringify(entry, null, 2), { mode: 0o600 });
  }

  listPending(roomId: string): PendingShareEntry[] {
    const dir = join(this.roomDir(roomId), "pending");
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        try {
          return JSON.parse(readFileSync(join(dir, f), "utf-8")) as PendingShareEntry;
        } catch {
          return null;
        }
      })
      .filter((e): e is PendingShareEntry => e !== null && typeof e.ts === "string")
      .sort((a, b) => a.ts.localeCompare(b.ts));
  }

  private pendingPath(roomId: string, pendingId: string): string | null {
    const safe = pendingId.replace(/[^a-zA-Z0-9_-]/g, "");
    if (!safe) return null;
    return join(this.roomDir(roomId), "pending", `${safe}.json`);
  }

  getPending(roomId: string, pendingId: string): PendingShareEntry | null {
    const path = this.pendingPath(roomId, pendingId);
    if (!path) return null;
    try {
      return JSON.parse(readFileSync(path, "utf-8")) as PendingShareEntry;
    } catch {
      return null;
    }
  }

  deletePending(roomId: string, pendingId: string): void {
    const path = this.pendingPath(roomId, pendingId);
    if (!path) return;
    try {
      unlinkSync(path);
    } catch {
      // already gone
    }
  }

  // --- mentions.jsonl ---

  appendMention(roomId: string, entry: MentionEntry): void {
    const path = join(this.roomDir(roomId), "mentions.jsonl");
    appendFileSync(path, JSON.stringify(entry) + "\n");
  }

  readMentions(roomId: string, onlyUnread = false): MentionEntry[] {
    const path = join(this.roomDir(roomId), "mentions.jsonl");
    try {
      const lines = readFileSync(path, "utf-8").trim().split("\n");
      const entries = lines
        .filter((l) => l.length > 0)
        .map((l) => {
          try {
            return JSON.parse(l) as MentionEntry;
          } catch {
            return null;
          }
        })
        .filter((e): e is MentionEntry => e !== null);
      return onlyUnread ? entries.filter((e) => !e.read) : entries;
    } catch {
      return [];
    }
  }

  markMentionsRead(roomId: string, ids: string[]): void {
    const path = join(this.roomDir(roomId), "mentions.jsonl");
    try {
      const content = readFileSync(path, "utf-8");
      const lines = content.trim().split("\n").filter((l) => l.length > 0);
      const idSet = new Set(ids);
      let modified = false;
      const updated = lines.map((l) => {
        try {
          const entry = JSON.parse(l) as MentionEntry;
          if (idSet.has(entry.id) && !entry.read) {
            modified = true;
            return JSON.stringify({ ...entry, read: true });
          }
          return l;
        } catch {
          return l;
        }
      });
      if (!modified) return;
      const tempPath = path + ".tmp";
      writeFileSync(tempPath, updated.join("\n") + "\n");
      renameSync(tempPath, path);
    } catch {
      // ファイルがない場合は無視
    }
  }

  // --- Room-scoped CLAUDE.md ---

  readRoomClaudeMd(roomId: string): string | null {
    const path = join(this.roomDir(roomId), "claude.md");
    try {
      return readFileSync(path, "utf-8");
    } catch {
      return null;
    }
  }

  getRoomClaudeMdPath(roomId: string): string {
    return join(this.roomDir(roomId), "claude.md");
  }

  resolveShareSavePath(shareType: string, filename: string, roomId: string, claudeHome: string): string {
    const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    if (shareType === "claude_md") {
      return this.getRoomClaudeMdPath(roomId);
    }
    const subdir = shareType === "command" ? "commands" : "skills";
    return join(claudeHome, subdir, safe);
  }

  static sha256(data: Buffer): string {
    return createHash("sha256").update(data).digest("hex");
  }
}
