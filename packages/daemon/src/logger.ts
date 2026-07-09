import pino from "pino";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { CC_ROOM_DIR } from "./config.js";

const logDir = join(CC_ROOM_DIR, "logs");

try {
  mkdirSync(logDir, { recursive: true });
} catch {
  // ログディレクトリ作成失敗はベストエフォート
}

export const logger = pino(
  {
    level: process.env.CC_ROOM_LOG_LEVEL || "info",
    transport:
      process.env.NODE_ENV === "development"
        ? { target: "pino-pretty", options: { colorize: true, destination: 2 } }
        : undefined,
  },
  pino.destination(2),
);

export function createChildLogger(component: string) {
  return logger.child({ component });
}
