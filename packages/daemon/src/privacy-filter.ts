import type { PrivacyConfig } from "@cc-room/shared";
import type { ConversationTurn } from "./watcher.js";
import { createChildLogger } from "./logger.js";

const log = createChildLogger("privacy-filter");

export interface AnnotatedTurn extends ConversationTurn {
  afterPrivateTool?: boolean;
}

export class PrivacyFilter {
  private publicTools: Set<string>;
  private patterns: RegExp[];
  private redactAfterPrivate: boolean;

  constructor(config: PrivacyConfig) {
    this.publicTools = new Set(config.public_tools);
    this.patterns = config.private_patterns
      .map((pattern: string): RegExp | null => {
        try {
          return new RegExp(pattern, "gi");
        } catch {
          log.warn({ pattern }, "Invalid privacy pattern, skipping");
          return null;
        }
      })
      .filter((r: RegExp | null): r is RegExp => r !== null);
    this.redactAfterPrivate = config.redact_after_private_tool;
  }

  isToolPublic(toolName: string): boolean {
    return this.publicTools.has(toolName);
  }

  filterTurns(turns: AnnotatedTurn[]): ConversationTurn[] {
    const result: ConversationTurn[] = [];

    for (const turn of turns) {
      if (this.redactAfterPrivate && turn.afterPrivateTool) {
        log.debug({ role: turn.role }, "Dropping turn after private tool use");
        continue;
      }

      let content = turn.content;
      for (const pattern of this.patterns) {
        pattern.lastIndex = 0;
        content = content.replace(pattern, "[private]");
      }

      if (content.length > 0) {
        result.push({ role: turn.role, content, timestamp: turn.timestamp });
      }
    }

    return result;
  }
}
