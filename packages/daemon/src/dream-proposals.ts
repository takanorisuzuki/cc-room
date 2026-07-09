import { appendFileSync, mkdirSync, writeFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DreamCategory } from "./dream-miner.js";
import type { DreamCandidate } from "./dream-miner.js";
import {
  escapeYamlDoubleQuoted,
  indexDescription,
  isValidRoomMemorySlug,
  slugFromContent,
} from "./room-memory.js";
import type { ConversationTurn } from "./session-parse.js";
import type { PromotionResult } from "./dream-promotion.js";

const MAX_TRACE_LINES = 5;
const MAX_EXCERPT_CHARS = 800;

export interface TraceEntry {
  ts: string;
  session_id: string;
  turn: number;
  role: string;
  excerpt: string;
}

export function extractMatchKeywords(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/[a-zA-Z_][\w./-]{2,}/g)) {
    if (m[0].length >= 3) found.add(m[0]);
  }
  for (const m of text.matchAll(/[\u3040-\u30ff\u4e00-\u9fff]{2,}/g)) {
    found.add(m[0]);
  }
  return [...found].slice(0, 8);
}

export function pickSourceTurns(
  candidate: DreamCandidate,
  turns: ConversationTurn[],
): number[] {
  const keywords = extractMatchKeywords(`${candidate.title} ${candidate.body}`);
  const matched: number[] = [];
  for (const t of turns) {
    if (!t.turn) continue;
    if (keywords.some((k) => t.content.includes(k))) {
      matched.push(t.turn);
    }
  }
  if (matched.length > 0) return matched.slice(0, MAX_TRACE_LINES);
  return turns
    .filter((t) => t.turn && (t.role === "assistant" || t.role === "user"))
    .slice(-MAX_TRACE_LINES)
    .map((t) => t.turn!)
    .filter((n) => n > 0);
}

export function buildTraceEntries(
  sessionId: string,
  turnNumbers: number[],
  turns: ConversationTurn[],
): TraceEntry[] {
  const byTurn = new Map(turns.filter((t) => t.turn).map((t) => [t.turn!, t]));
  const entries: TraceEntry[] = [];
  for (const turn of turnNumbers.slice(0, MAX_TRACE_LINES)) {
    const t = byTurn.get(turn);
    if (!t) continue;
    entries.push({
      ts: t.timestamp ?? new Date().toISOString(),
      session_id: sessionId,
      turn,
      role: t.role,
      excerpt: t.content.slice(0, MAX_EXCERPT_CHARS),
    });
  }
  return entries;
}

export function buildProposalMarkdown(params: {
  slug: string;
  description: string;
  content: string;
  category: DreamCategory;
  proposedBy: string;
  sessionId: string;
  sourceTurns: number[];
  confidence: number;
  promotion: PromotionResult;
  objectionDeadline: string;
  action?: "create" | "update";
}): string {
  const desc = escapeYamlDoubleQuoted(params.description);
  const proposedBy = escapeYamlDoubleQuoted(params.proposedBy);
  return `---
name: ${params.slug}
description: "${desc}"
category: ${params.category}
scope: room
status: proposed
metadata:
  type: team-proposal
  action: ${params.action ?? "create"}
  proposed_by: "${proposedBy}"
  proposed_at: ${new Date().toISOString()}
  source_sessions: ${JSON.stringify([params.sessionId])}
  source_turns: ${JSON.stringify(params.sourceTurns)}
  confidence: ${params.confidence.toFixed(2)}
  promotion_score: ${params.promotion.promotionScore.toFixed(2)}
  promotion_reason: ${params.promotion.reason}
  silent_merge_eligible: ${params.promotion.silentMergeEligible}
  confirmed_by: 1
  objection_deadline: ${params.objectionDeadline}
---

${params.content.trim()}
`;
}

export function buildAutoMemoryMarkdown(params: {
  slug: string;
  description: string;
  content: string;
  category: DreamCategory;
  owner: string;
  sessionId: string;
  sourceTurns: number[];
  confidence: number;
}): string {
  const desc = escapeYamlDoubleQuoted(params.description);
  const owner = escapeYamlDoubleQuoted(params.owner);
  return `---
name: ${params.slug}
description: "${desc}"
category: ${params.category}
scope: personal
metadata:
  type: auto-memory
  owner: "${owner}"
  added_at: ${new Date().toISOString()}
  source_sessions: ${JSON.stringify([params.sessionId])}
  source_turns: ${JSON.stringify(params.sourceTurns)}
  confidence: ${params.confidence.toFixed(2)}
---

${params.content.trim()}
`;
}

export function objectionDeadlineIso(hours: number): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

export function writeAutoMemoryEntry(
  autoMemoryDir: string,
  slug: string,
  markdown: string,
): void {
  mkdirSync(autoMemoryDir, { recursive: true });
  writeFileSync(join(autoMemoryDir, `${slug}.md`), markdown, { mode: 0o600 });
  refreshAutoMemoryIndex(autoMemoryDir);
}

export function writeProposalEntry(
  proposalsDir: string,
  slug: string,
  markdown: string,
): string {
  mkdirSync(proposalsDir, { recursive: true });
  const dated = `${new Date().toISOString().slice(0, 10)}-${slug}.md`;
  writeFileSync(join(proposalsDir, dated), markdown, { mode: 0o644 });
  return dated;
}

export function writeTraceFile(
  tracesDir: string,
  slug: string,
  entries: TraceEntry[],
): void {
  if (entries.length === 0) return;
  if (!isValidRoomMemorySlug(slug)) return;
  mkdirSync(tracesDir, { recursive: true });
  const path = join(tracesDir, `${slug}.jsonl`);
  const lines = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
  if (existsSync(path)) {
    appendFileSync(path, lines, { encoding: "utf-8" });
  } else {
    writeFileSync(path, lines, { mode: 0o600 });
  }
}

export function readTraceEntries(tracesDir: string, slug: string): TraceEntry[] {
  if (!isValidRoomMemorySlug(slug)) return [];
  const path = join(tracesDir, `${slug}.jsonl`);
  if (!existsSync(path)) return [];
  try {
    const content = readFileSync(path, "utf-8");
    return content
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as TraceEntry;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is TraceEntry => entry !== null);
  } catch {
    return [];
  }
}

export function formatTraceForDisplay(
  slug: string,
  entries: TraceEntry[],
  roomName?: string,
): string {
  if (entries.length === 0) {
    return `「${slug}」の L2 原典（trace）は見つかりません。`;
  }
  const header = roomName ? `L2 trace: ${slug} (${roomName})` : `L2 trace: ${slug}`;
  const lines = entries.map(
    (e) =>
      `[turn ${e.turn} ${e.role}] ${e.excerpt}\n  (session: ${e.session_id}, ${e.ts})`,
  );
  return `${header}\n\n${lines.join("\n\n")}`;
}

function refreshAutoMemoryIndex(autoMemoryDir: string): void {
  const slugs: Array<{ slug: string; description: string }> = [];
  if (existsSync(autoMemoryDir)) {
    for (const name of readdirSync(autoMemoryDir)) {
      if (!name.endsWith(".md") || name === "MEMORY.md") continue;
      const slug = name.replace(/\.md$/, "");
      try {
        const raw = readFileSyncSafe(join(autoMemoryDir, name));
        const body = raw.replace(/^---[\s\S]*?---\r?\n/, "");
        slugs.push({ slug, description: indexDescription(body) });
      } catch {
        slugs.push({ slug, description: slug });
      }
    }
  }
  slugs.sort((a, b) => a.slug.localeCompare(b.slug));
  const lines = slugs.map((e) => `- [${e.slug}](${e.slug}.md) — ${e.description}`);
  const header = `<!-- cc-room auto-memory index -->\n`;
  const content = lines.length > 0 ? `${header}\n${lines.join("\n")}\n` : `${header}\n`;
  writeFileSync(join(autoMemoryDir, "MEMORY.md"), content, { mode: 0o600 });
}

function readFileSyncSafe(path: string): string {
  return readFileSync(path, "utf-8");
}

export function slugForCandidate(
  candidate: DreamCandidate,
  existingSlugs: Set<string>,
): string {
  const base = slugFromContent(`${candidate.title} ${candidate.body}`, existingSlugs);
  if (candidate.action === "update" && candidate.existing_slug) {
    const s = candidate.existing_slug;
    // LLM出力は信頼できないため、isValidRoomMemorySlug で検証し、パストラバーサルを防ぐ
    if (s.length >= 3 && s.length <= 48 && isValidRoomMemorySlug(s)) return s;
  }
  return base;
}
