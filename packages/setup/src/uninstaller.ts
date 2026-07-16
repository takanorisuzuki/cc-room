import {
  existsSync,
  mkdirSync,
  rmSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { homedir, platform } from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { resolveCcRoomDir } from "./paths.js";
import { unmergeSettings } from "./settings-merger.js";

const COMMAND_FILES = ["room.md", "private.md", "show.md"] as const;

export function getLaunchdPlistPath(home = homedir()): string {
  return join(home, "Library", "LaunchAgents", "dev.ccroom.daemon.plist");
}

export function getSystemdUnitPath(home = homedir()): string {
  return join(home, ".config", "systemd", "user", "cc-room-daemon.service");
}

export function stopLaunchd(plistPath: string): void {
  if (!existsSync(plistPath)) {
    console.log("         launchd: 未登録");
    return;
  }
  try {
    execFileSync("launchctl", ["unload", plistPath], { stdio: "pipe" });
  } catch {
    // already unloaded
  }
  try {
    unlinkSync(plistPath);
    console.log(`         launchd を解除: ${plistPath}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  \x1b[33m⚠ plist 削除に失敗: ${msg}\x1b[0m`);
  }
}

export function stopSystemd(unitPath: string): void {
  try {
    execFileSync("systemctl", ["--user", "disable", "--now", "cc-room-daemon"], { stdio: "pipe" });
  } catch {
    // ignore
  }
  if (existsSync(unitPath)) {
    try {
      unlinkSync(unitPath);
      console.log(`         systemd を解除: ${unitPath}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  \x1b[33m⚠ unit 削除に失敗: ${msg}\x1b[0m`);
    }
  } else {
    console.log("         systemd: 未登録");
  }
  try {
    execFileSync("systemctl", ["--user", "daemon-reload"], { stdio: "pipe" });
  } catch {
    // ignore
  }
}

export function removeCommandFiles(commandsDir: string): void {
  mkdirSync(commandsDir, { recursive: true });
  let removed = 0;
  for (const name of COMMAND_FILES) {
    const path = join(commandsDir, name);
    if (existsSync(path)) {
      unlinkSync(path);
      removed++;
    }
  }
  console.log(`         コマンドファイルを ${removed} 件削除 (${commandsDir})`);
}

export function removeCcRoomData(ccRoomDir: string): void {
  if (!existsSync(ccRoomDir)) {
    console.log(`         スキップ: ${ccRoomDir} は存在しません`);
    return;
  }
  rmSync(ccRoomDir, { recursive: true, force: true });
  console.log(`         削除: ${ccRoomDir}`);
}

export function stopOrphanDaemon(): void {
  spawnSync("pkill", ["-f", "cc-room-daemon"], { stdio: "pipe" });
}

export async function uninstall(): Promise<void> {
  const ccRoomDir = resolveCcRoomDir();
  const commandsDir = join(homedir(), ".claude", "commands");
  const os = platform();

  console.log("  [1/4] OS サービスを停止...");
  if (os === "darwin") {
    stopLaunchd(getLaunchdPlistPath());
  } else if (os === "linux") {
    stopSystemd(getSystemdUnitPath());
  } else {
    console.log(`         ${os}: 自動起動の解除は手動で行ってください`);
  }
  stopOrphanDaemon();

  console.log("  [2/4] Slash commands を削除...");
  removeCommandFiles(commandsDir);

  console.log("  [3/4] .claude/settings.json から cc-room を除去...");
  unmergeSettings();

  console.log("  [4/4] データディレクトリを削除...");
  removeCcRoomData(ccRoomDir);
}
