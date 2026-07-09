import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CC_ROOM_DIR } from "./config.js";
import {
  formatEntryLine,
  parseDescriptionFromRaw,
  readLastInjectFile,
  writeLastInjectFile,
} from "./room-memory.js";
import type { RoomMemoryEntryInfo } from "./room-memory.js";

export function resolveOrgMemoryDir(orgMemoryPath?: string | null): string | null {
  const dir = orgMemoryPath?.trim() || join(CC_ROOM_DIR, "org-memory");
  return existsSync(dir) ? dir : null;
}

export function listOrgMemoryEntries(orgDir: string): RoomMemoryEntryInfo[] {
  const entries: RoomMemoryEntryInfo[] = [];
  let files: string[];
  try {
    files = readdirSync(orgDir);
  } catch {
    return [];
  }
  for (const name of files) {
    if (!name.endsWith(".md") || name === "MEMORY.md" || name.startsWith(".")) continue;
    const slug = name.replace(/\.md$/, "");
    let description = slug;
    try {
      const raw = readFileSync(join(orgDir, name), "utf-8");
      description = parseDescriptionFromRaw(raw, slug);
    } catch {
      // keep slug
    }
    entries.push({ slug, description, filename: name });
  }
  entries.sort((a, b) => a.slug.localeCompare(b.slug));
  return entries;
}

export function readOrgLastInjectSession(orgDir: string): string | null {
  return readLastInjectFile(orgDir);
}

export function writeOrgLastInjectSession(orgDir: string, sessionId: string): void {
  writeLastInjectFile(orgDir, sessionId);
}

export function buildOrgL0Injection(entries: RoomMemoryEntryInfo[]): string {
  if (entries.length === 0) return "";
  const indexLines = entries.map(formatEntryLine);
  return `<cc-room-org-memory>
以下は組織共通の知識です。ユーザーの作業に関連する項目があれば、
「組織メモリによると」と前置きして自然に参照してください。

📋 組織メモリ (${entries.length}件):
${indexLines.join("\n")}
</cc-room-org-memory>`;
}
