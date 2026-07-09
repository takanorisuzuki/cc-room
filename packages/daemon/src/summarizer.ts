import Anthropic from "@anthropic-ai/sdk";
import {
  SUMMARIZER_MAX_RETRIES,
  SUMMARIZER_FALLBACK_DURATION_MS,
} from "@cc-room/shared";
import { createChildLogger } from "./logger.js";
import type { ConversationTurn } from "./watcher.js";

const log = createChildLogger("summarizer");

const SYSTEM_PROMPT = `あなたは会話の要約者です。チームメイトに共有するため、会話の要点を簡潔に日本語で要約してください。
ルール:
- 3文以内で要約する
- 何をしているか（タスク）、何を決めたか（決定事項）、何が問題か（課題）を含める
- コードの詳細は省略し、意図と結論を伝える
- プライベート情報を絶対に含めない: カレンダー予定、メールの内容、個人の連絡先、パスワード、APIキー、健康情報
- [private] とマークされた部分は完全に無視する
- 技術的な作業内容のみを要約する`;

export class Summarizer {
  private client: Anthropic | null = null;
  private model: string;
  private fallbackMode = false;
  private fallbackUntil = 0;

  constructor(model: string, apiKey?: string) {
    this.model = model;
    try {
      this.client = new Anthropic(apiKey ? { apiKey } : undefined);
    } catch {
      log.warn("Anthropic client initialization failed, using fallback mode");
      this.fallbackMode = true;
      this.fallbackUntil = Infinity;
    }
  }

  async summarize(turns: ConversationTurn[]): Promise<string> {
    if (turns.length === 0) return "";

    if (this.fallbackMode && Date.now() < this.fallbackUntil) {
      return this.localFallbackSummary(turns);
    }

    if (!this.client) {
      return this.localFallbackSummary(turns);
    }

    const conversationText = turns
      .map((t) => `${t.role}: ${t.content.slice(0, 500)}`)
      .join("\n");

    for (let attempt = 0; attempt <= SUMMARIZER_MAX_RETRIES; attempt++) {
      try {
        const response = await this.client.messages.create({
          model: this.model,
          max_tokens: 200,
          system: SYSTEM_PROMPT,
          messages: [
            {
              role: "user",
              content: `以下の会話を要約してください:\n\n${conversationText}`,
            },
          ],
        });

        this.fallbackMode = false;
        const textBlock = response.content.find((b) => b.type === "text");
        return textBlock && "text" in textBlock ? textBlock.text : "";
      } catch (err: unknown) {
        const error = err && typeof err === "object" ? (err as Record<string, unknown>) : {};
        const status = typeof error.status === "number" ? error.status : undefined;
        const headers = error.headers && typeof error.headers === "object"
          ? (error.headers as Record<string, string>)
          : undefined;

        if (attempt === SUMMARIZER_MAX_RETRIES) {
          log.warn({ err }, "All retries exhausted, entering fallback mode");
          this.fallbackMode = true;
          this.fallbackUntil = Date.now() + SUMMARIZER_FALLBACK_DURATION_MS;
          return this.localFallbackSummary(turns);
        }

        if (status === 429) {
          const retryAfter = parseInt(headers?.["retry-after"] || "5", 10);
          log.warn({ retryAfter }, "Rate limited, waiting");
          await sleep(retryAfter * 1000);
          continue;
        }

        const delay = Math.min(1000 * Math.pow(2, attempt), 30_000);
        log.warn({ attempt, delay, status, err }, "Error occurred, retrying");
        await sleep(delay);
      }
    }

    return this.localFallbackSummary(turns);
  }

  private localFallbackSummary(turns: ConversationTurn[]): string {
    const lastUser = turns.findLast((t) => t.role === "user");
    const lastAssistant = turns.findLast((t) => t.role === "assistant");
    const userPart = lastUser ? lastUser.content.slice(0, 80) : "";
    const assistantPart = lastAssistant ? lastAssistant.content.slice(0, 120) : "";
    return `[ローカル要約] ${userPart}${userPart ? " → " : ""}${assistantPart}`;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
