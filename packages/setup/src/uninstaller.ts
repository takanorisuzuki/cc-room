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
import { t } from "./i18n.js";

const COMMAND_FILES = ["room.md", "private.md", "show.md"] as const;

export function getLaunchdPlistPath(home = homedir()): string {
  return join(home, "Library", "LaunchAgents", "dev.ccroom.daemon.plist");
}

export function getSystemdUnitPath(home = homedir()): string {
  return join(home, ".config", "systemd", "user", "cc-room-daemon.service");
}

export function stopLaunchd(plistPath: string): void {
  if (!existsSync(plistPath)) {
    console.log(t("un.launchd_none"));
    return;
  }
  try {
    execFileSync("launchctl", ["unload", plistPath], { stdio: "pipe" });
  } catch {
    // already unloaded
  }
  try {
    unlinkSync(plistPath);
    console.log(t("un.launchd_ok", { path: plistPath }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(t("un.plist_fail", { msg }));
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
      console.log(t("un.systemd_ok", { path: unitPath }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(t("un.unit_fail", { msg }));
    }
  } else {
    console.log(t("un.systemd_none"));
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
  console.log(t("un.commands_ok", { count: removed, dir: commandsDir }));
}

export function removeCcRoomData(ccRoomDir: string): void {
  if (!existsSync(ccRoomDir)) {
    console.log(t("un.data_skip", { dir: ccRoomDir }));
    return;
  }
  rmSync(ccRoomDir, { recursive: true, force: true });
  console.log(t("un.data_ok", { dir: ccRoomDir }));
}

export function stopOrphanDaemon(): void {
  spawnSync("pkill", ["-f", "cc-room-daemon"], { stdio: "pipe" });
}

export async function uninstall(): Promise<void> {
  const ccRoomDir = resolveCcRoomDir();
  const commandsDir = join(homedir(), ".claude", "commands");
  const os = platform();

  console.log(t("un.step1"));
  if (os === "darwin") {
    stopLaunchd(getLaunchdPlistPath());
  } else if (os === "linux") {
    stopSystemd(getSystemdUnitPath());
  } else {
    console.log(t("un.os_manual", { os }));
  }
  stopOrphanDaemon();

  console.log(t("un.step2"));
  removeCommandFiles(commandsDir);

  console.log(t("un.step3"));
  unmergeSettings();

  console.log(t("un.step4"));
  removeCcRoomData(ccRoomDir);
}
