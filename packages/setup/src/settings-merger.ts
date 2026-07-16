import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import { t } from "./i18n.js";
import { resolveCcRoomDir } from "./paths.js";

const SETTINGS_PATH = join(homedir(), ".claude", "settings.json");

/** Claude Code hooks / MCP から呼ぶ daemon の絶対パスを解決する */
export function resolveDaemonCommand(env: NodeJS.ProcessEnv = process.env): string {
  const bundled = join(resolveCcRoomDir(env), "bin", "cc-room-daemon");
  if (existsSync(bundled)) return bundled;
  try {
    const which = execFileSync("which", ["cc-room-daemon"], {
      encoding: "utf-8",
      stdio: "pipe",
    }).trim();
    if (which) return which;
  } catch {
    // ignore
  }
  return bundled;
}

function isCcRoomHookCommand(command?: string): boolean {
  if (!command) return false;
  return command.includes("cc-room-daemon") && command.includes("hook");
}

export function buildCcRoomHooks(daemonBin: string) {
  return {
    UserPromptSubmit: [
      {
        hooks: [
          {
            type: "command",
            command: `${daemonBin} hook user-prompt-submit`,
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
            command: `${daemonBin} hook post-tool-use`,
          },
        ],
      },
    ],
    Stop: [
      {
        hooks: [
          {
            type: "command",
            command: `${daemonBin} hook session-stop`,
          },
        ],
      },
    ],
  };
}

export function buildCcRoomMcp(daemonBin: string) {
  return {
    "cc-room": {
      type: "stdio",
      command: daemonBin,
      args: ["mcp"],
    },
  };
}

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

  const daemonBin = resolveDaemonCommand();
  const ccRoomHooks = buildCcRoomHooks(daemonBin);
  const ccRoomMcp = buildCcRoomMcp(daemonBin);

  const existingHooks = (settings.hooks as Record<string, unknown[]> | undefined) ?? {};
  const mergedHooks: Record<string, unknown[]> = { ...existingHooks };

  for (const [event, newEntries] of Object.entries(ccRoomHooks)) {
    const existing = (mergedHooks[event] as unknown[]) ?? [];
    const filtered = existing.filter((e) => {
      const entry = e as { hooks?: Array<{ command?: string }> };
      return !entry.hooks?.some((h) => isCcRoomHookCommand(h.command));
    });
    mergedHooks[event] = [...filtered, ...newEntries];
  }

  const existingMcp = (settings.mcpServers as Record<string, unknown> | undefined) ?? {};
  const mergedMcp = { ...existingMcp, ...ccRoomMcp };

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
      return !entry.hooks?.some((h) => isCcRoomHookCommand(h.command));
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
