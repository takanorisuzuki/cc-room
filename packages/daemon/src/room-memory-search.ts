import type { RoomMemoryEntryInfo } from "./room-memory.js";

export interface MemorySearchResult {
  room_id: string;
  slug: string;
  description: string;
  category: string | null;
  body: string;
  score: number;
}

const FRONTMATTER_RE = /^---\r?\n[\s\S]*?---\r?\n([\s\S]*)$/;

export function stripFrontmatter(markdown: string): string {
  const m = markdown.match(FRONTMATTER_RE);
  return (m?.[1] ?? markdown).trim();
}

export function parseCategoryFromMarkdown(markdown: string): string | null {
  const m = markdown.match(/^---\r?\n[\s\S]*?category:\s*["']?([^"'\s]+)["']?/);
  return m?.[1] ?? null;
}

function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[\s　]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 1);
}

function scoreText(text: string, tokens: string[]): number {
  const lower = text.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (lower.includes(token)) score += 1;
  }
  return score;
}

export function searchRoomMemoryEntries(
  roomId: string,
  entries: Array<RoomMemoryEntryInfo & { raw: string }>,
  query: string,
  limit = 5,
): MemorySearchResult[] {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return [];

  const scored: MemorySearchResult[] = [];
  for (const entry of entries) {
    const body = stripFrontmatter(entry.raw);
    const score =
      scoreText(entry.slug, tokens) * 3 +
      scoreText(entry.description, tokens) * 2 +
      scoreText(body, tokens);
    if (score === 0) continue;
    scored.push({
      room_id: roomId,
      slug: entry.slug,
      description: entry.description,
      category: parseCategoryFromMarkdown(entry.raw),
      body,
      score,
    });
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}
