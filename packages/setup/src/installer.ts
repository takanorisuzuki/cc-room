import {
  mkdirSync,
  writeFileSync,
  existsSync,
  copyFileSync,
  chmodSync,
  unlinkSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { stringify } from "yaml";
import { mergeSettings } from "./settings-merger.js";
import { registerService } from "./register-service.js";
import { resolveDaemonSource } from "./daemon-resolver.js";
import { resolveCcRoomDir } from "./paths.js";
import { type Locale, t } from "./i18n.js";

const CC_ROOM_DIR = resolveCcRoomDir();
const BIN_DIR = join(CC_ROOM_DIR, "bin");
const CONFIG_PATH = join(CC_ROOM_DIR, "config.yaml");
const COMMANDS_DIR = join(homedir(), ".claude", "commands");
const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const SETUP_PACKAGE_ROOT = join(THIS_DIR, "..");

function getGitUserName(): string {
  try {
    return execFileSync("git", ["config", "user.name"], { encoding: "utf-8", stdio: "pipe" }).trim();
  } catch {
    return "unknown";
  }
}

export function resolveCommandSources(setupPackageRoot: string, locale: Locale): string | null {
  const candidates = [
    join(setupPackageRoot, "vendor", "commands", "room", locale),
    join(setupPackageRoot, "..", "commands", "room", locale),
    // legacy flat layout (pre-i18n)
    join(setupPackageRoot, "vendor", "commands", "room"),
    join(setupPackageRoot, "..", "commands", "room"),
  ];
  for (const dir of candidates) {
    if (existsSync(join(dir, "room.md"))) return dir;
  }
  return null;
}

export async function install(locale: Locale = "en"): Promise<void> {
  console.log(t("install.step1", { dir: CC_ROOM_DIR }));
  mkdirSync(BIN_DIR, { recursive: true });

  const daemonSrc = resolveDaemonSource(SETUP_PACKAGE_ROOT);
  const daemonDest = join(BIN_DIR, "cc-room-daemon");

  if (daemonSrc) {
    copyFileSync(daemonSrc, daemonDest);
    chmodSync(daemonDest, 0o755);
    console.log(t("install.copied", { path: daemonDest }));
  } else {
    const globalBin = spawnSync("which", ["cc-room-daemon"], { encoding: "utf-8" });
    if (globalBin.status === 0) {
      console.log(t("install.global_ok", { path: globalBin.stdout.trim() }));
    } else {
      console.log(`  \x1b[33m⚠ ${t("daemon.missing")}\x1b[0m`);
    }
  }

  console.log(t("install.step2", { path: CONFIG_PATH }));
  if (!existsSync(CONFIG_PATH)) {
    const identity = getGitUserName();
    const config = {
      identity: { name: identity },
      ui: { locale },
      network: { port: 7331, http_port: 7332 },
      trust: [],
      sessions: { default_mode: "approve", share_files: true, share_context: true },
      privacy: {
        public_tools: ["room_context", "room_messages", "room_files", "room_status", "room_invite", "room_share"],
        private_patterns: [],
        redact_after_private_tool: true,
      },
      summarizer: { model: "claude-haiku-4-5-20251001", interval_turns: 5, interval_seconds: 30 },
      storage: { max_bytes: 524288000, artifact_ttl_days: 30, context_ttl_days: 7, message_ttl_days: 14 },
    };
    writeFileSync(CONFIG_PATH, stringify(config), { mode: 0o600 });
    console.log(t("install.config_created", { path: CONFIG_PATH, identity }));
  } else {
    console.log(t("install.config_skip", { path: CONFIG_PATH }));
  }

  console.log(t("install.step3", { locale }));
  mkdirSync(COMMANDS_DIR, { recursive: true });
  const commandFiles = ["room.md", "private.md", "show.md"];
  const legacyFiles = ["invite.md", "join.md", "leave.md", "files.md", "remember.md", "share.md"];
  const commandsSrcDir = resolveCommandSources(SETUP_PACKAGE_ROOT, locale);
  if (!commandsSrcDir) {
    throw new Error(`Command source directory not found for locale=${locale}`);
  }
  for (const cmd of commandFiles) {
    const src = join(commandsSrcDir, cmd);
    if (!existsSync(src)) throw new Error(`Command source file not found: ${src}`);
    copyFileSync(src, join(COMMANDS_DIR, cmd));
  }
  for (const legacy of legacyFiles) {
    const dest = join(COMMANDS_DIR, legacy);
    if (existsSync(dest)) {
      unlinkSync(dest);
    }
  }
  console.log(t("install.commands_ok", { count: commandFiles.length, dir: COMMANDS_DIR }));

  console.log(t("install.step4"));
  mergeSettings();

  console.log(t("install.step5"));
  await registerService();
}
