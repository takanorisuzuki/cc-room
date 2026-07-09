import Anthropic from "@anthropic-ai/sdk";
import { generateId } from "@cc-room/shared";
import { createChildLogger } from "./logger.js";
import type { SessionTranscript } from "./session-reader.js";
import { formatTranscriptsForMine } from "./session-reader.js";

const log = createChildLogger("dream-miner");

export type DreamCategory = "decision" | "discovery" | "pattern" | "warning";

export interface DreamCandidate {
  id: string;
  category: DreamCategory;
  title: string;
  body: string;
  confidence: number;
  action: "create" | "update";
  existing_slug?: string;
}

const MINE_SYSTEM = `あなたはチームの知識抽出アシスタントです。セッション transcript からチーム共有に値する知見を抽出してください。

カテゴリ:
- decision: 確定方針
- discovery: 発見・原因・解決
- pattern: 繰り返し手順・書き方
- warning: 罠・非推奨

ルール:
- confidence 0.7 未満は出力しない
- デバッグの一時メモ（Ephemeral）は除外
- 0-5件。JSON のみ返す
- プライベート情報は含めない

出力形式:
{"candidates":[{"category":"decision","title":"短いタイトル","body":"本文","confidence":0.85,"action":"create","existing_slug":null}]}`;

export const DEFAULT_MINE_MODEL = "claude-haiku-4-5-20251001";

export class DreamMiner {
  private client: Anthropic | null;
  private readonly model: string;

  /** client: null を明示すると API を使わず fallbackMine のみで動く（テスト用 DI） */
  constructor(apiKey?: string, model?: string, client?: Anthropic | null) {
    this.model = model ?? DEFAULT_MINE_MODEL;
    if (client !== undefined) {
      this.client = client;
      return;
    }
    try {
      this.client = new Anthropic(apiKey ? { apiKey } : undefined);
    } catch {
      this.client = null;
    }
  }

  async mine(
    sessions: SessionTranscript[],
    memoryIndex: string | null,
  ): Promise<DreamCandidate[]> {
    if (sessions.length === 0) return [];

    const transcript = formatTranscriptsForMine(sessions);
    const indexBlock = memoryIndex ? `\n\n現在の MEMORY.md:\n${memoryIndex.slice(0, 2000)}` : "";

    if (this.client) {
      try {
        const response = await this.client.messages.create({
          model: this.model,
          max_tokens: 2000,
          system: MINE_SYSTEM,
          messages: [
            {
              role: "user",
              content: `以下の transcript から知識候補を抽出してください。${indexBlock}\n\n${transcript}`,
            },
          ],
        });
        const textBlock = response.content.find((b) => b.type === "text");
        const text = textBlock && "text" in textBlock ? textBlock.text : "";
        return parseMineResponse(text);
      } catch (err) {
        log.warn({ err }, "Dream Mine API failed, using fallback");
      }
    }

    return fallbackMine(sessions);
  }
}

function parseMineResponse(text: string): DreamCandidate[] {
  const jsonMatch = text.match(/\{[\s\S]*"candidates"[\s\S]*\}/);
  if (!jsonMatch) return [];
  try {
    const data = JSON.parse(jsonMatch[0]) as {
      candidates?: Array<{
        category?: string;
        title?: string;
        body?: string;
        confidence?: number;
        action?: string;
        existing_slug?: string | null;
      }>;
    };
    if (!Array.isArray(data.candidates)) return [];
    return data.candidates
      .filter((c) => (c.confidence ?? 0) >= 0.7 && c.title && c.body)
      .slice(0, 5)
      .map((c) => ({
        id: generateId(),
        category: normalizeCategory(c.category),
        title: c.title!.trim(),
        body: c.body!.trim(),
        confidence: c.confidence ?? 0.7,
        action: c.action === "update" ? "update" : "create",
        existing_slug: c.existing_slug ?? undefined,
      }));
  } catch {
    return [];
  }
}

function normalizeCategory(raw?: string): DreamCategory {
  const valid: DreamCategory[] = ["decision", "discovery", "pattern", "warning"];
  return valid.includes(raw as DreamCategory) ? (raw as DreamCategory) : "discovery";
}

function fallbackMine(sessions: SessionTranscript[]): DreamCandidate[] {
  const keywords = /(決めた|方針|優先|すべき|ハマる|罠|原因|解決)/;
  const candidates: DreamCandidate[] = [];
  for (const session of sessions) {
    for (const turn of session.turns) {
      if (turn.role !== "assistant" && turn.role !== "user") continue;
      const line = turn.content.split("\n").find((l) => keywords.test(l));
      if (!line || line.length < 10) continue;
      candidates.push({
        id: generateId(),
        category: /決め|方針/.test(line) ? "decision" : "discovery",
        title: line.slice(0, 60),
        body: line.trim(),
        confidence: 0.75,
        action: "create",
      });
      if (candidates.length >= 3) return candidates;
    }
  }
  return candidates;
}
