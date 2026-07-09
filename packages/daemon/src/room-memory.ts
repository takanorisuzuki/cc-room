import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const INDEX_HEADER = `<!-- cc-room team memory index -->
<!-- このファイルはセッション開始時にClaudeへ自動注入されます -->
<!-- 関連する項目があれば「チームメモリによると」と前置きして参照してください -->
`;

export interface RoomMemoryEntryInfo {
  slug: string;
  description: string;
  filename: string;
}

export function slugFromContent(content: string, existingSlugs: Set<string>): string {
  const trimmed = content.trim();
  const ascii = trimmed
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  let base =
    ascii.length >= 3
      ? ascii
      : `entry-${createHash("sha256").update(trimmed).digest("hex").slice(0, 8)}`;
  if (!existingSlugs.has(base)) return base;
  let n = 2;
  while (existingSlugs.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

export function indexDescription(content: string): string {
  const line = content.trim().split("\n")[0] ?? "";
  return line.length > 80 ? `${line.slice(0, 77)}...` : line;
}

export const ROOM_MEMORY_SLUG_PATTERN = /^[a-zA-Z0-9_-]+$/;

export function isValidRoomMemorySlug(slug: string): boolean {
  return ROOM_MEMORY_SLUG_PATTERN.test(slug);
}

export function parseDescriptionFromRaw(raw: string, fallback: string): string {
  const fmQuoted = raw.match(
    /^---\r?\n[\s\S]*?description:\s*"((?:[^"\\]|\\.)*)"\r?\n[\s\S]*?---\r?\n([\s\S]*)/,
  );
  const fmUnquoted = raw.match(
    /^---\r?\n[\s\S]*?description:\s*(.+)\r?\n[\s\S]*?---\r?\n([\s\S]*)/,
  );
  if (fmQuoted?.[1]) return fmQuoted[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  if (fmUnquoted?.[1]) return fmUnquoted[1].trim();
  if (fmUnquoted?.[2]) return indexDescription(fmUnquoted[2]);
  return fallback;
}

export function readLastInjectFile(dir: string): string | null {
  const path = join(dir, ".last-inject");
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path, "utf-8").trim() || null;
  } catch {
    return null;
  }
}

export function writeLastInjectFile(dir: string, sessionId: string): void {
  try {
    writeFileSync(join(dir, ".last-inject"), sessionId, { mode: 0o600 });
  } catch {
    // read-only の場合はスキップ
  }
}

export function formatEntryLine(e: RoomMemoryEntryInfo): string {
  return `- [${e.slug}](${e.filename}) — ${e.description}`;
}

export function escapeYamlDoubleQuoted(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, " ");
}

export function buildEntryMarkdown(params: {
  slug: string;
  description: string;
  content: string;
  addedBy: string;
  sessionId?: string;
  category?: string;
}): string {
  const now = new Date().toISOString().slice(0, 10);
  const sessions = params.sessionId ? [params.sessionId] : [];
  const desc = escapeYamlDoubleQuoted(params.description);
  const addedBy = escapeYamlDoubleQuoted(params.addedBy);
  const category = params.category ?? "decision";
  return `---
name: ${params.slug}
description: "${desc}"
category: ${category}
metadata:
  type: team-learning
  added_by: "${addedBy}"
  added_at: ${now}
  source_sessions: ${JSON.stringify(sessions)}
  confirmed_by: 1
---

${params.content.trim()}
`;
}

export function buildMemoryIndex(entries: RoomMemoryEntryInfo[]): string {
  const lines = entries.map(formatEntryLine);
  return lines.length > 0 ? `${INDEX_HEADER}\n${lines.join("\n")}\n` : `${INDEX_HEADER}\n`;
}

export function buildL0Injection(entries: RoomMemoryEntryInfo[], roomName?: string): string {
  if (entries.length === 0) return "";
  const indexLines = entries.map(formatEntryLine);
  const label = roomName
    ? `📋 チームメモリ (${roomName}, ${entries.length}件):`
    : `📋 チームメモリ (${entries.length}件):`;
  return `<cc-room-memory>
以下はチームが共有している知識です。ユーザーの作業に関連する項目があれば、
「チームメモリによると」と前置きして自然に参照してください。

${label}
${indexLines.join("\n")}
</cc-room-memory>`;
}
