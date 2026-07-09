import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { CC_ROOM_DIR } from "./config.js";
import { createChildLogger } from "./logger.js";

const log = createChildLogger("notifier");

const NOTIFICATIONS_PATH = join(CC_ROOM_DIR, "notifications.jsonl");
const IS_MACOS = process.platform === "darwin";

export type NotificationEvent =
  | { type: "join"; room: string; identity: string }
  | { type: "leave"; room: string; identity: string }
  | { type: "message"; room: string; from: string; content: string }
  | { type: "room_closed"; room: string }
  | { type: "file_received"; room: string; from: string; filename: string }
  | { type: "dream_proposals"; room: string; count: number; preview: string }
  | { type: "dream_merged"; room: string; count: number; descriptions: string[] };

export class Notifier {
  private enabled: boolean;

  constructor(enabled = true) {
    this.enabled = enabled;
    mkdirSync(CC_ROOM_DIR, { recursive: true });
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  notify(event: NotificationEvent): void {
    const entry = { ts: new Date().toISOString(), ...event };
    try {
      appendFileSync(NOTIFICATIONS_PATH, JSON.stringify(entry) + "\n", "utf-8");
    } catch (err) {
      log.warn({ err }, "通知ファイルへの書き込みに失敗");
    }

    if (IS_MACOS && this.enabled) {
      const { title, body } = this.buildNotification(event);
      this.osNotify(title, body);
    }
  }

  private buildNotification(event: NotificationEvent): { title: string; body: string } {
    switch (event.type) {
      case "join":         return { title: `${event.identity} が入室しました`, body: event.room };
      case "leave":        return { title: `${event.identity} が退出しました`, body: event.room };
      case "message":      return { title: `${event.from} からメッセージ`, body: event.content.slice(0, 100) };
      case "room_closed":  return { title: "会議室が閉じられました", body: event.room };
      case "file_received": return { title: `${event.from} がファイルを共有しました`, body: event.filename };
      case "dream_proposals": {
        const suffix = event.count > 1 ? ` 他 ${event.count - 1} 件` : "";
        return {
          title: `チームへの提案が ${event.count} 件あります`,
          body: `${event.preview}${suffix}`,
        };
      }
      case "dream_merged": {
        const preview = event.descriptions.slice(0, 2).join("、");
        const suffix = event.count > 2 ? ` 他 ${event.count - 2} 件` : "";
        return {
          title: "チームの記憶が更新されました",
          body: `${preview}${suffix} — 取り消し: /room dream revert`,
        };
      }
    }
  }

  private osNotify(title: string, body: string): void {
    const script = `display notification ${JSON.stringify(body)} with title ${JSON.stringify(title)}`;
    execFile("osascript", ["-e", script], (err) => {
      if (err) log.debug({ err }, "OS 通知の送信に失敗");
    });
  }
}
