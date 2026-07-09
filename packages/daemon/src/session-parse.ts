export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
  timestamp?: string;
  afterPrivateTool?: boolean;
  /** 1-based turn index within session jsonl */
  turn?: number;
}

export const TYPE_TO_ROLE: Record<string, "user" | "assistant"> = {
  human: "user",
  user: "user",
  assistant: "assistant",
  ai: "assistant",
};

export function extractContent(entry: Record<string, unknown>): string | null {
  if (typeof entry.content === "string") return entry.content;
  if (typeof entry.message === "string") return entry.message;
  if (Array.isArray(entry.content)) {
    const textParts = (entry.content as Array<{ type?: string; text?: string }>)
      .filter((p) => p && typeof p === "object" && p.type === "text" && typeof p.text === "string")
      .map((p) => p.text as string);
    if (textParts.length > 0) return textParts.join("\n");
  }
  return null;
}

export function resolveRole(entry: Record<string, unknown>): "user" | "assistant" | null {
  const mapped = TYPE_TO_ROLE[entry.type as string];
  if (mapped) return mapped;
  if (entry.role === "user" || entry.role === "assistant") {
    return entry.role;
  }
  return null;
}

export function extractToolName(entry: Record<string, unknown>): string | null {
  const entryType = entry.type as string | undefined;
  if (entryType === "tool_use" || entryType === "tool_call") {
    return (entry.name as string) || (entry.tool as string) || "unknown";
  }
  return null;
}

export function isToolEntry(entry: Record<string, unknown>): boolean {
  return extractToolName(entry) !== null;
}
