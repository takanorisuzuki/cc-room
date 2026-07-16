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
import { DAEMON_MISSING_HINT, resolveDaemonSource } from "./daemon-resolver.js";

const CC_ROOM_DIR = join(homedir(), ".cc-room");
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

export async function install(): Promise<void> {
  console.log("  [1/5] ~/.cc-room/bin/ のセットアップ...");
  mkdirSync(BIN_DIR, { recursive: true });

  const daemonSrc = resolveDaemonSource(SETUP_PACKAGE_ROOT);
  const daemonDest = join(BIN_DIR, "cc-room-daemon");

  if (daemonSrc) {
    copyFileSync(daemonSrc, daemonDest);
    chmodSync(daemonDest, 0o755);
    console.log(`         コピー完了: ${daemonDest}`);
  } else {
    const globalBin = spawnSync("which", ["cc-room-daemon"], { encoding: "utf-8" });
    if (globalBin.status === 0) {
      console.log(`         グローバルインストール確認済み: ${globalBin.stdout.trim()}`);
    } else {
      console.log(`  \x1b[33m⚠ ${DAEMON_MISSING_HINT}\x1b[0m`);
    }
  }

  console.log("  [2/5] ~/.cc-room/config.yaml の生成...");
  if (!existsSync(CONFIG_PATH)) {
    const identity = getGitUserName();
    const config = {
      identity: { name: identity },
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
    console.log(`         生成完了: ${CONFIG_PATH} (identity: ${identity})`);
  } else {
    console.log(`         スキップ: ${CONFIG_PATH} は既に存在します`);
  }

  console.log("  [3/5] コマンドファイルの配置...");
  mkdirSync(COMMANDS_DIR, { recursive: true });
  const commandFiles = ["room.md", "private.md", "show.md"];
  const legacyFiles = ["invite.md", "join.md", "leave.md", "files.md", "remember.md", "share.md"];
  for (const cmd of commandFiles) {
    const src = [
      join(THIS_DIR, "..", "vendor", "commands", "room", cmd),
      join(THIS_DIR, "..", "..", "commands", "room", cmd),
      join(THIS_DIR, "..", "commands", "room", cmd),
    ].find(existsSync);
    if (!src) throw new Error(`Command source file not found: ${cmd}`);
    copyFileSync(src, join(COMMANDS_DIR, cmd));
  }
  for (const legacy of legacyFiles) {
    const dest = join(COMMANDS_DIR, legacy);
    if (existsSync(dest)) {
      unlinkSync(dest);
    }
  }
  console.log(`         ${commandFiles.length} ファイルを ${COMMANDS_DIR} に配置しました`);

  console.log("  [4/5] .claude/settings.json の更新...");
  mergeSettings();

  console.log("  [5/5] OS自動起動の登録...");
  await registerService();
}
