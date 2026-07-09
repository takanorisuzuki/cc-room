import { accessSync, constants } from "node:fs";
import { createChildLogger } from "./logger.js";
import type { Config } from "./config.js";
import type { StorageManager } from "./storage.js";

const log = createChildLogger("health");

const MEMORY_LIMIT_BYTES = 256 * 1024 * 1024; // 256MB
const HEALTH_CHECK_INTERVAL_MS = 30_000;

interface HealthStatus {
  ok: boolean;
  checks: Record<string, { ok: boolean; message: string }>;
  memory_mb: number;
}

export class HealthChecker {
  private interval: ReturnType<typeof setInterval> | null = null;
  private config: Config;
  private storage: StorageManager;
  private isWsListening: () => boolean;

  constructor(config: Config, storage: StorageManager, isWsListening: () => boolean) {
    this.config = config;
    this.storage = storage;
    this.isWsListening = isWsListening;
  }

  check(): HealthStatus {
    const memoryUsed = process.memoryUsage().heapUsed;
    const checks: Record<string, { ok: boolean; message: string }> = {};

    // WebSocket サーバーが Listen 中か
    checks.ws_listen = this.isWsListening()
      ? { ok: true, message: `Port ${this.config.network.port} listening` }
      : { ok: false, message: "WebSocket server not listening" };

    // ストレージへの書き込み可能確認
    try {
      accessSync(this.storage.getRoomsDir(), constants.W_OK);
      checks.storage = { ok: true, message: "Storage writable" };
    } catch {
      checks.storage = { ok: false, message: "Storage directory not writable" };
    }

    // メモリ使用量
    const memoryOk = memoryUsed < MEMORY_LIMIT_BYTES;
    const memory_mb = Math.round(memoryUsed / 1024 / 1024);
    checks.memory = {
      ok: memoryOk,
      message: memoryOk ? `Heap ${memory_mb}MB` : `Heap ${memory_mb}MB (>256MB limit)`,
    };

    const ok = Object.values(checks).every((c) => c.ok);
    return { ok, checks, memory_mb };
  }

  start(): void {
    this.interval = setInterval(() => {
      const status = this.check();
      if (!status.ok) {
        const failed = Object.entries(status.checks)
          .filter(([, c]) => !c.ok)
          .map(([k, c]) => `${k}: ${c.message}`)
          .join(", ");
        log.warn({ failed }, "Health check failed");
      } else {
        log.debug({ memory_mb: status.memory_mb }, "Health check ok");
      }
    }, HEALTH_CHECK_INTERVAL_MS);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }
}
