import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  extractContent,
  isToolEntry,
  resolveRole,
  type ConversationTurn,
} from "./session-parse.js";

const MAX_SESSION_FILES = 3;
const MAX_TOKEN_CHARS = 30_000 * 2; // bytes/2 概算

export function parseSessionTurns(jsonl: string): ConversationTurn[] {
  const turns: ConversationTurn[] = [];
  let turn = 0;
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as Record<string, unknown>;
      if (isToolEntry(entry)) continue;
      const role = resolveRole(entry);
      if (!role) continue;
      const content = extractContent(entry);
      if (!content) continue;
      turn += 1;
      turns.push({
        role,
        content,
        timestamp: entry.timestamp as string | undefined,
        turn,
      });
    } catch {
      // skip invalid lines
    }
  }
  return turns;
}

/** Claude Code の projects サブディレクトリ名（`/Users/foo` → `-Users-foo`） */
export function encodeProjectDir(cwd: string): string {
  return cwd.replace(/\//g, "-");
}

export function findSessionJsonlPath(
  projectsDir: string,
  sessionId: string,
  cwd?: string,
): string | null {
  const trimmed = sessionId.trim();
  // パス区切り文字・ドットドットを含む session_id はパストラバーサルの恐れがあるため拒否する
  if (!trimmed || /[/\\]|\.\./.test(trimmed) || trimmed.length < 8) return null;

  const resolvedProjectsDir = resolve(projectsDir);

  const allFiles = collectJsonlFiles(projectsDir);
  const candidates: string[] = [];
  if (cwd) {
    candidates.push(join(projectsDir, encodeProjectDir(cwd), `${trimmed}.jsonl`));
  }
  candidates.push(...allFiles.filter((path) => {
    const base = path.split("/").pop() ?? "";
    const name = base.replace(/\.jsonl$/, "");
    return name === trimmed || name.includes(trimmed);
  }));

  for (const path of candidates) {
    try {
      const resolved = resolve(path);
      // projectsDir 外へのアクセスを禁止
      if (!resolved.startsWith(resolvedProjectsDir + "/")) continue;
      if (statSync(resolved).isFile()) return resolved;
    } catch {
      // try next
    }
  }

  // コンテンツベースのフォールバックは projectsDir 外の任意ファイルを巻き込む恐れがあるため削除

  return null;
}

export function readSessionTranscriptById(
  projectsDir: string,
  sessionId: string,
  cwd?: string,
): SessionTranscript | null {
  const path = findSessionJsonlPath(projectsDir, sessionId, cwd);
  if (!path) return null;
  try {
    const raw = readFileSync(path, "utf-8");
    const turns = parseSessionTurns(raw);
    if (turns.length === 0) return null;
    return { path, turns };
  } catch {
    return null;
  }
}

function collectJsonlFiles(dir: string, acc: string[] = []): string[] {
  let entries: Array<{ name: string; isDirectory: () => boolean }>;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const ent of entries) {
    const path = join(dir, ent.name);
    if (ent.isDirectory()) {
      collectJsonlFiles(path, acc);
    } else if (ent.name.endsWith(".jsonl")) {
      acc.push(path);
    }
  }
  return acc;
}

export interface SessionTranscript {
  path: string;
  turns: ConversationTurn[];
}

export function readRecentSessionTranscripts(projectsDir: string): SessionTranscript[] {
  const files = collectJsonlFiles(projectsDir)
    .map((path) => {
      try {
        return { path, mtime: statSync(path).mtimeMs };
      } catch {
        return null;
      }
    })
    .filter((f): f is { path: string; mtime: number } => f !== null)
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, MAX_SESSION_FILES);

  const result: SessionTranscript[] = [];
  let totalChars = 0;

  for (const { path } of files) {
    if (totalChars >= MAX_TOKEN_CHARS) break;
    let raw: string;
    try {
      raw = readFileSync(path, "utf-8");
    } catch {
      continue;
    }
    const budget = MAX_TOKEN_CHARS - totalChars;
    const clipped = raw.length > budget ? raw.slice(-budget) : raw;
    const turns = parseSessionTurns(clipped);
    if (turns.length === 0) continue;
    totalChars += clipped.length;
    result.push({ path, turns });
  }

  return result;
}

export function formatTranscriptsForMine(sessions: SessionTranscript[]): string {
  return sessions
    .map((s, i) => {
      const lines = s.turns.map((t) => `${t.role}: ${t.content.slice(0, 800)}`);
      return `### Session ${i + 1}\n${lines.join("\n")}`;
    })
    .join("\n\n");
}
