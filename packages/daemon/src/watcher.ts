import { watch } from "chokidar";
import { statSync, openSync, readSync, closeSync } from "node:fs";
import { EventEmitter } from "node:events";
import { createChildLogger } from "./logger.js";
import {
  extractContent,
  extractToolName,
  resolveRole,
  type ConversationTurn,
} from "./session-parse.js";

const log = createChildLogger("watcher");

export type { ConversationTurn };

export class SessionWatcher extends EventEmitter {
  private offsets = new Map<string, number>();
  private watcher: ReturnType<typeof watch> | null = null;
  private lastToolWasPrivate = new Map<string, boolean>();

  constructor(private isToolPublic: (name: string) => boolean = () => false) {
    super();
  }

  start(sessionDir: string): void {
    log.info({ sessionDir }, "Starting session watcher");

    this.watcher = watch(sessionDir, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
    });

    this.watcher.on("add", (path) => {
      if (path.endsWith(".jsonl")) {
        this.processFile(path);
      }
    });

    this.watcher.on("change", (path) => {
      if (path.endsWith(".jsonl")) {
        this.processFile(path);
      }
    });

    this.watcher.on("error", (err) => {
      log.error({ err }, "Watcher error");
    });

    // ignoreInitial のため ready 前の書き込みは検知されない。起動完了を観測可能にする
    this.watcher.on("ready", () => this.emit("ready"));
  }

  private processFile(filePath: string): void {
    try {
      const stat = statSync(filePath);
      const prevOffset = this.offsets.get(filePath) || 0;

      if (stat.size <= prevOffset) return;

      const byteLen = stat.size - prevOffset;
      const buf = Buffer.alloc(byteLen);
      const fd = openSync(filePath, "r");
      try {
        readSync(fd, buf, 0, byteLen, prevOffset);
      } finally {
        closeSync(fd);
      }
      const newLines = buf.toString("utf-8").split("\n").filter((l) => l.length > 0);

      if (newLines.length === 0) {
        this.offsets.set(filePath, stat.size);
        return;
      }

      const turns: ConversationTurn[] = [];
      for (const line of newLines) {
        try {
          const entry = JSON.parse(line) as Record<string, unknown>;
          const toolName = extractToolName(entry);
          if (toolName !== null) {
            if (!this.isToolPublic(toolName)) {
              this.lastToolWasPrivate.set(filePath, true);
            }
            this.emit("tool_use", toolName);
            continue;
          }
          const turn = this.extractTurn(entry, filePath);
          if (turn) turns.push(turn);
        } catch {
          // 不正な行はスキップ
        }
      }

      this.offsets.set(filePath, stat.size);

      if (turns.length > 0) {
        log.debug({ file: filePath, turns: turns.length }, "New turns detected");
        this.emit("turns", turns, filePath);
      }
    } catch (err) {
      log.error({ err, file: filePath }, "Failed to process session file");
    }
  }

  private extractTurn(entry: Record<string, unknown>, filePath: string): ConversationTurn | null {
    const role = resolveRole(entry);
    if (!role) return null;
    const content = extractContent(entry);
    if (!content) return null;

    const afterPrivateTool = this.lastToolWasPrivate.get(filePath) ?? false;
    if (role === "user") {
      this.lastToolWasPrivate.set(filePath, false);
    }

    return { role, content, timestamp: entry.timestamp as string, afterPrivateTool };
  }

  stop(): void {
    this.watcher?.close();
    this.watcher = null;
    this.offsets.clear();
    log.info("Session watcher stopped");
  }
}
