import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir, platform } from "node:os";
import { execFileSync } from "node:child_process";

const CC_ROOM_DIR = join(homedir(), ".cc-room");

function getDaemonBinPath(): string {
  // インストール済みの場合はグローバルバイナリ
  try {
    const which = execFileSync("which", ["cc-room-daemon"], { encoding: "utf-8", stdio: "pipe" }).trim();
    if (which) return which;
  } catch {
    // ignore
  }
  return join(CC_ROOM_DIR, "bin", "cc-room-daemon");
}

function registerLaunchd(): void {
  const plistDir = join(homedir(), "Library", "LaunchAgents");
  const plistPath = join(plistDir, "dev.ccroom.daemon.plist");
  const daemonBin = getDaemonBinPath();
  const logPath = join(CC_ROOM_DIR, "logs", "daemon.log");

  mkdirSync(join(CC_ROOM_DIR, "logs"), { recursive: true });
  mkdirSync(plistDir, { recursive: true });

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>dev.ccroom.daemon</string>
  <key>ProgramArguments</key>
  <array>
    <string>${daemonBin}</string>
  </array>
  <key>KeepAlive</key>
  <true/>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${logPath}</string>
  <key>StandardErrorPath</key>
  <string>${logPath}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
  </dict>
</dict>
</plist>
`;

  writeFileSync(plistPath, plist, { mode: 0o644 });

  try {
    // 既存のサービスをアンロードしてから再ロード
    execFileSync("launchctl", ["unload", plistPath], { stdio: "pipe" });
  } catch {
    // 未登録の場合はエラーを無視
  }

  try {
    execFileSync("launchctl", ["load", plistPath], { stdio: "pipe" });
    console.log(`         launchd に登録しました: ${plistPath}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  \x1b[33m⚠ launchd 登録に失敗しました: ${msg}\x1b[0m`);
    console.log(`    手動で登録: launchctl load ${plistPath}`);
  }
}

function registerSystemd(): void {
  const serviceDir = join(homedir(), ".config", "systemd", "user");
  const servicePath = join(serviceDir, "cc-room-daemon.service");
  const daemonBin = getDaemonBinPath();
  const logPath = join(CC_ROOM_DIR, "logs", "daemon.log");

  mkdirSync(join(CC_ROOM_DIR, "logs"), { recursive: true });
  mkdirSync(serviceDir, { recursive: true });

  const unit = `[Unit]
Description=cc-room daemon
After=network.target

[Service]
ExecStart=${daemonBin}
Restart=on-failure
RestartSec=5
StandardOutput=append:${logPath}
StandardError=append:${logPath}

[Install]
WantedBy=default.target
`;

  writeFileSync(servicePath, unit, { mode: 0o644 });

  try {
    execFileSync("systemctl", ["--user", "daemon-reload"], { stdio: "pipe" });
    execFileSync("systemctl", ["--user", "enable", "--now", "cc-room-daemon"], { stdio: "pipe" });
    console.log(`         systemd に登録しました: ${servicePath}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  \x1b[33m⚠ systemd 登録に失敗しました: ${msg}\x1b[0m`);
    console.log(`    手動で登録: systemctl --user enable --now cc-room-daemon`);
  }
}

export async function registerService(): Promise<void> {
  const os = platform();
  if (os === "darwin") {
    registerLaunchd();
  } else if (os === "linux") {
    registerSystemd();
  } else {
    console.log(`  \x1b[33m⚠ ${os} での自動起動登録はサポートされていません。手動で cc-room-daemon を起動してください。\x1b[0m`);
  }

  // サービス起動確認
  const pidPath = join(CC_ROOM_DIR, "daemon.pid");
  if (!existsSync(pidPath)) {
    console.log("         daemon の起動を待機中...");
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  if (existsSync(pidPath)) {
    console.log("         daemon が起動しました");
  } else {
    console.log("  \x1b[33m⚠ daemon の自動起動確認できませんでした。手動で cc-room-daemon を実行してください。\x1b[0m");
  }
}
