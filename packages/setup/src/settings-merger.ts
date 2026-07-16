import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { t } from "./i18n.js";

const SETTINGS_PATH = join(homedir(), ".claude", "settings.json");

const CC_ROOM_HOOKS = {
  UserPromptSubmit: [
    {
      hooks: [
        {
          type: "command",
          command: "cc-room-daemon hook user-prompt-submit",
        },
      ],
    },
  ],
  PostToolUse: [
    {
      matcher: "Write|Edit",
      hooks: [
        {
          type: "command",
          command: "cc-room-daemon hook post-tool-use",
        },
      ],
    },
  ],
  Stop: [
    {
      hooks: [
        {
          type: "command",
          command: "cc-room-daemon hook session-stop",
        },
      ],
    },
  ],
};

const CC_ROOM_MCP = {
  "cc-room": {
    type: "stdio",
    command: "cc-room-daemon",
    args: ["mcp"],
  },
};

export function mergeSettings(): void {
  let settings: Record<string, unknown> = {};
  mkdirSync(join(homedir(), ".claude"), { recursive: true });

  if (existsSync(SETTINGS_PATH)) {
    try {
      settings = JSON.parse(readFileSync(SETTINGS_PATH, "utf-8")) as Record<string, unknown>;
    } catch {
      console.log(t("settings.parse_fail_backup"));
      copyFileSync(SETTINGS_PATH, SETTINGS_PATH + ".backup");
      settings = {};
    }
  }

  // hooks のマージ（既存エントリを保持して追加）
  const existingHooks = (settings.hooks as Record<string, unknown[]> | undefined) ?? {};
  const mergedHooks: Record<string, unknown[]> = { ...existingHooks };

  for (const [event, newEntries] of Object.entries(CC_ROOM_HOOKS)) {
    const existing = (mergedHooks[event] as unknown[]) ?? [];
    // cc-room エントリが重複登録されないよう、既存の cc-room hook を削除してから追加
    const filtered = existing.filter((e) => {
      const entry = e as { hooks?: Array<{ command?: string }> };
      return !entry.hooks?.some((h) => h.command?.startsWith("cc-room-daemon hook"));
    });
    mergedHooks[event] = [...filtered, ...newEntries];
  }

  // mcpServers のマージ
  const existingMcp = (settings.mcpServers as Record<string, unknown> | undefined) ?? {};
  const mergedMcp = { ...existingMcp, ...CC_ROOM_MCP };

  settings.hooks = mergedHooks;
  settings.mcpServers = mergedMcp;

  writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n", { mode: 0o644 });
  console.log(t("settings.updated", { path: SETTINGS_PATH }));
}

/** settings.json から cc-room の hooks / mcpServers を除去（他設定は保持） */
export function stripCcRoomFromSettings(
  settings: Record<string, unknown>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...settings };

  const existingHooks = (settings.hooks as Record<string, unknown[]> | undefined) ?? {};
  const strippedHooks: Record<string, unknown[]> = {};
  for (const [event, entries] of Object.entries(existingHooks)) {
    strippedHooks[event] = (entries ?? []).filter((e) => {
      const entry = e as { hooks?: Array<{ command?: string }> };
      return !entry.hooks?.some((h) => h.command?.startsWith("cc-room-daemon hook"));
    });
  }
  if (Object.keys(existingHooks).length > 0 || Object.keys(strippedHooks).length > 0) {
    next.hooks = strippedHooks;
  }

  const existingMcp = (settings.mcpServers as Record<string, unknown> | undefined) ?? {};
  if (Object.keys(existingMcp).length > 0) {
    const { ["cc-room"]: _removed, ...rest } = existingMcp;
    next.mcpServers = rest;
  }

  return next;
}

export function unmergeSettings(): void {
  if (!existsSync(SETTINGS_PATH)) {
    console.log(t("settings.skip_missing", { path: SETTINGS_PATH }));
    return;
  }

  let settings: Record<string, unknown>;
  try {
    settings = JSON.parse(readFileSync(SETTINGS_PATH, "utf-8")) as Record<string, unknown>;
  } catch {
    console.log(t("settings.parse_fail_skip"));
    return;
  }

  const next = stripCcRoomFromSettings(settings);
  writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2) + "\n", { mode: 0o644 });
  console.log(t("settings.stripped", { path: SETTINGS_PATH }));
}
