export type Locale = "en" | "ja";

export function resolveLocale(argv: string[] = process.argv, env: NodeJS.ProcessEnv = process.env): Locale {
  const langFlagIdx = argv.findIndex((a) => a === "--lang" || a === "--locale");
  if (langFlagIdx >= 0 && argv[langFlagIdx + 1]) {
    return normalizeLocale(argv[langFlagIdx + 1]);
  }
  const inline = argv.find((a) => a.startsWith("--lang=") || a.startsWith("--locale="));
  if (inline) {
    return normalizeLocale(inline.split("=")[1] ?? "en");
  }
  if (env.CC_ROOM_LANG) {
    return normalizeLocale(env.CC_ROOM_LANG);
  }
  return "en";
}

function normalizeLocale(raw: string): Locale {
  const v = raw.trim().toLowerCase();
  if (v === "ja" || v === "jp" || v === "japanese" || v.startsWith("ja-")) return "ja";
  return "en";
}

type Dict = Record<string, string>;

const en: Dict = {
  "cli.running_preflight": "  Running preflight checks...",
  "cli.preflight_failed": "  \x1b[31mPrerequisites not met. Fix the issues above and try again.\x1b[0m\n",
  "cli.preflight_ok": "  \x1b[32mAll checks passed. Starting install...\x1b[0m\n",
  "cli.install_done": "  \x1b[32m✅ Setup complete!\x1b[0m",
  "cli.uninstall_done": "  \x1b[32m✅ Uninstall complete.\x1b[0m",
  "cli.restart_claude": "  Restart Claude Code so hooks / MCP take effect.",
  "cli.unknown_arg": "  Unknown argument: {arg}",
  "cli.error": "  \x1b[31mError:\x1b[0m",
  "cli.help": `
  🏠 setup-cc-room v{version}

  Usage:
    npx setup-cc-room                 Install cc-room (English by default)
    npx setup-cc-room --lang ja       Install with Japanese UI / commands
    npx setup-cc-room uninstall       Remove cc-room
    npx setup-cc-room --help          Show this help

  Language: --lang en|ja  or  CC_ROOM_LANG=ja
`,
  "cli.install_guide": `
  How to use cc-room:

  [Open a room]
    1. Restart Claude Code (enable MCP and Hooks)
    2. /room open <name>  ← creates a room (PIN issued)
    3. Tell teammates the room name and PIN
    4. They run /room join <name> <PIN>

  [If invited]
    1. Restart Claude Code
    2. /room join <name> <PIN>

  [Daily]
    /room             … view the whiteboard
    /private          … status / local vs public (on|off|share|drop)

  ⚠️  cc-room does not notify others automatically.
      Share the room name and PIN yourself.

  You need to be on the same Wi‑Fi (LAN).
  (A VPN that creates a shared LAN also works.)

  Uninstall: npx setup-cc-room uninstall
  Japanese UI: npx setup-cc-room --lang ja

  Docs: https://github.com/takanorisuzuki/cc-room
`,
  "install.step1": "  [1/5] Setting up {dir}/bin/...",
  "install.copied": "         Copied: {path}",
  "install.global_ok": "         Found global binary: {path}",
  "install.step2": "  [2/5] Writing {path}...",
  "install.config_created": "         Created: {path} (identity: {identity})",
  "install.config_skip": "         Skip: {path} already exists",
  "install.step3": "  [3/5] Installing slash commands ({locale})...",
  "install.commands_ok": "         Installed {count} files into {dir}",
  "install.step4": "  [4/5] Updating .claude/settings.json...",
  "install.step5": "  [5/5] Registering OS auto-start...",
  "daemon.missing":
    "cc-room-daemon not found. In the repo run `pnpm --filter setup-cc-room run pack:vendor`, or use the npm setup-cc-room package.",
  "settings.updated": "         Updated {path}",
  "settings.parse_fail_backup":
    "  \x1b[33m⚠ Failed to parse settings.json. Creating a backup and overwriting.\x1b[0m",
  "settings.skip_missing": "         Skip: {path} does not exist",
  "settings.parse_fail_skip":
    "  \x1b[33m⚠ Failed to parse settings.json; skipped removing hooks/MCP.\x1b[0m",
  "settings.stripped": "         Removed cc-room from {path}",
  "svc.launchd_ok": "         Registered with launchd: {path}",
  "svc.launchd_fail": "  \x1b[33m⚠ launchd registration failed: {msg}\x1b[0m",
  "svc.launchd_manual": "    Manual: launchctl load {path}",
  "svc.systemd_ok": "         Registered with systemd: {path}",
  "svc.systemd_fail": "  \x1b[33m⚠ systemd registration failed: {msg}\x1b[0m",
  "svc.systemd_manual": "    Manual: systemctl --user enable --now cc-room-daemon",
  "svc.cc_room_home_unsafe":
    "  \x1b[33m⚠ CC_ROOM_HOME contains characters unsafe for systemd (newline/quote); omitting from unit file\x1b[0m",
  "svc.unsupported":
    "  \x1b[33m⚠ Auto-start is not supported on {os}. Start cc-room-daemon manually.\x1b[0m",
  "svc.waiting": "         Waiting for daemon to start...",
  "svc.started": "         Daemon started",
  "svc.start_unconfirmed":
    "  \x1b[33m⚠ Could not confirm daemon start. Run cc-room-daemon manually.\x1b[0m",
  "un.step1": "  [1/4] Stopping OS service...",
  "un.launchd_none": "         launchd: not registered",
  "un.launchd_ok": "         Unregistered launchd: {path}",
  "un.plist_fail": "  \x1b[33m⚠ Failed to remove plist: {msg}\x1b[0m",
  "un.systemd_ok": "         Unregistered systemd: {path}",
  "un.unit_fail": "  \x1b[33m⚠ Failed to remove unit: {msg}\x1b[0m",
  "un.systemd_none": "         systemd: not registered",
  "un.os_manual": "         {os}: unregister auto-start manually",
  "un.step2": "  [2/4] Removing slash commands...",
  "un.commands_ok": "         Removed {count} command files ({dir})",
  "un.step3": "  [3/4] Removing cc-room from .claude/settings.json...",
  "un.step4": "  [4/4] Removing data directory...",
  "un.data_skip": "         Skip: {dir} does not exist",
  "un.data_ok": "         Deleted: {dir}",
  "val.node_bad": "Node.js {version} (20+ required)",
  "val.node_hint": "Upgrade to Node.js 20+: https://nodejs.org/",
  "val.claude_ok": "Claude Code is installed",
  "val.claude_missing": "Claude Code not found",
  "val.claude_hint": "Install Claude Code: https://claude.ai/code",
  "val.claude_dir_ok": "~/.claude/ directory exists",
  "val.claude_dir_missing": "~/.claude/ not found",
  "val.claude_dir_hint": "Start Claude Code once to create a session",
  "val.settings_writable": "settings.json is writable",
  "val.settings_not_writable": "No write permission for settings.json",
  "val.settings_chmod": "Run chmod 644 {path}",
  "val.settings_creatable": "Can create settings.json",
  "val.claude_dir_not_writable": "No write permission for ~/.claude/",
  "val.claude_dir_chmod": "Run chmod 755 {path}",
  "val.hooks_unset": "Hooks: unrestricted (no settings.json yet)",
  "val.hooks_disabled": "Hooks are disabled",
  "val.hooks_disabled_hint":
    "cc-room needs the PostToolUse hook. Remove the hooks disable setting from settings.json",
  "val.hooks_ok": "Hooks: enabled",
  "val.hooks_unrestricted": "Hooks: unrestricted",
  "val.mcp_ok": "MCP Server: can register",
  "val.mcp_disabled": "MCP Server registration is disabled",
  "val.mcp_disabled_hint":
    "cc-room talks to Claude Code via MCP. Remove the MCP disable setting from settings.json",
  "val.session_ok": "Session directory exists",
  "val.session_pending": "Session directory not created yet (appears after first session)",
  "val.git_ok": "Git user: {name}",
  "val.git_no_name": "git user.name is not set",
  "val.git_no_name_hint":
    'Set with git config --global user.name "Your Name" (used as cc-room identity)',
  "val.git_missing": "git not found",
  "val.git_hint": "Install git",
};

const ja: Dict = {
  "cli.running_preflight": "  Preflight checks を実行中...",
  "cli.preflight_failed":
    "  \x1b[31m前提条件を満たしていません。上記の問題を解決してから再実行してください。\x1b[0m\n",
  "cli.preflight_ok": "  \x1b[32m全チェック通過。インストールを開始します。\x1b[0m\n",
  "cli.install_done": "  \x1b[32m✅ セットアップが完了しました！\x1b[0m",
  "cli.uninstall_done": "  \x1b[32m✅ アンインストールが完了しました。\x1b[0m",
  "cli.restart_claude": "  Claude Code を再起動してください（hooks / MCP の反映）。",
  "cli.unknown_arg": "  不明な引数: {arg}",
  "cli.error": "  \x1b[31mエラー:\x1b[0m",
  "cli.help": `
  🏠 setup-cc-room v{version}

  使い方:
    npx setup-cc-room                 インストール（デフォルトは英語）
    npx setup-cc-room --lang ja       日本語 UI / コマンドでインストール
    npx setup-cc-room uninstall       アンインストール
    npx setup-cc-room --help          ヘルプ

  言語: --lang en|ja  または  CC_ROOM_LANG=ja
`,
  "cli.install_guide": `
  cc-room の使い方:

  【会議室を開く場合】
    1. Claude Code を再起動（MCP と Hooks を有効化）
    2. /room open <name>  ← 会議室を開く（PIN 発行）
    3. 表示される部屋名と PIN を相手に口頭や DM で伝える
    4. 相手が /room join <name> <PIN> を実行すれば参加完了

  【招待された場合】
    1. Claude Code を再起動
    2. /room join <name> <PIN>  ← 相手から受け取った値を入力

  【日常操作】
    /room             … ホワイトボードを見る
    /private          … 状態表示、手元/公開の切替（on|off|share|drop）

  ⚠️  cc-room は自動で相手に通知しません。
      部屋名と PIN は自分で相手に伝えてください。

  接続後は同じ WiFi（LAN）内にいる必要があります。
  （VPN で同一 LAN 相当になればリモートでも使えます）

  アンインストール: npx setup-cc-room uninstall

  ドキュメント: https://github.com/takanorisuzuki/cc-room
`,
  "install.step1": "  [1/5] {dir}/bin/ のセットアップ...",
  "install.copied": "         コピー完了: {path}",
  "install.global_ok": "         グローバルインストール確認済み: {path}",
  "install.step2": "  [2/5] {path} の生成...",
  "install.config_created": "         生成完了: {path} (identity: {identity})",
  "install.config_skip": "         スキップ: {path} は既に存在します",
  "install.step3": "  [3/5] コマンドファイルの配置 ({locale})...",
  "install.commands_ok": "         {count} ファイルを {dir} に配置しました",
  "install.step4": "  [4/5] .claude/settings.json の更新...",
  "install.step5": "  [5/5] OS自動起動の登録...",
  "daemon.missing":
    "cc-room-daemon が見つかりません。リポジトリでは `pnpm --filter setup-cc-room run pack:vendor` を実行するか、npm の setup-cc-room パッケージを使ってください。",
  "settings.updated": "         {path} を更新しました",
  "settings.parse_fail_backup":
    "  \x1b[33m⚠ settings.json のパースに失敗しました。バックアップを作成して上書きします。\x1b[0m",
  "settings.parse_fail_skip":
    "  \x1b[33m⚠ settings.json のパースに失敗したため、hooks/MCP の除去をスキップします。\x1b[0m",
  "settings.skip_missing": "         スキップ: {path} は存在しません",
  "settings.stripped": "         {path} から cc-room を除去しました",
  "svc.launchd_ok": "         launchd に登録しました: {path}",
  "svc.launchd_fail": "  \x1b[33m⚠ launchd 登録に失敗しました: {msg}\x1b[0m",
  "svc.launchd_manual": "    手動で登録: launchctl load {path}",
  "svc.systemd_ok": "         systemd に登録しました: {path}",
  "svc.systemd_fail": "  \x1b[33m⚠ systemd 登録に失敗しました: {msg}\x1b[0m",
  "svc.systemd_manual": "    手動で登録: systemctl --user enable --now cc-room-daemon",
  "svc.cc_room_home_unsafe":
    "  \x1b[33m⚠ CC_ROOM_HOME に systemd で危険な文字（改行/引用符）が含まれるため unit から省略します\x1b[0m",
  "svc.unsupported":
    "  \x1b[33m⚠ {os} での自動起動登録はサポートされていません。手動で cc-room-daemon を起動してください。\x1b[0m",
  "svc.waiting": "         daemon の起動を待機中...",
  "svc.started": "         daemon が起動しました",
  "svc.start_unconfirmed":
    "  \x1b[33m⚠ daemon の自動起動確認できませんでした。手動で cc-room-daemon を実行してください。\x1b[0m",
  "un.step1": "  [1/4] OS サービスを停止...",
  "un.launchd_none": "         launchd: 未登録",
  "un.launchd_ok": "         launchd を解除: {path}",
  "un.plist_fail": "  \x1b[33m⚠ plist 削除に失敗: {msg}\x1b[0m",
  "un.systemd_ok": "         systemd を解除: {path}",
  "un.unit_fail": "  \x1b[33m⚠ unit 削除に失敗: {msg}\x1b[0m",
  "un.systemd_none": "         systemd: 未登録",
  "un.os_manual": "         {os}: 自動起動の解除は手動で行ってください",
  "un.step2": "  [2/4] Slash commands を削除...",
  "un.commands_ok": "         コマンドファイルを {count} 件削除 ({dir})",
  "un.step3": "  [3/4] .claude/settings.json から cc-room を除去...",
  "un.step4": "  [4/4] データディレクトリを削除...",
  "un.data_skip": "         スキップ: {dir} は存在しません",
  "un.data_ok": "         削除: {dir}",
  "val.node_bad": "Node.js {version} (20+ が必要)",
  "val.node_hint": "Node.js 20 以上にアップグレードしてください: https://nodejs.org/",
  "val.claude_ok": "Claude Code がインストール済み",
  "val.claude_missing": "Claude Code が見つかりません",
  "val.claude_hint": "Claude Code をインストールしてください: https://claude.ai/code",
  "val.claude_dir_ok": "~/.claude/ ディレクトリが存在",
  "val.claude_dir_missing": "~/.claude/ が見つかりません",
  "val.claude_dir_hint": "Claude Code を一度起動してセッションを作成してください",
  "val.settings_writable": "settings.json に書き込み可能",
  "val.settings_not_writable": "settings.json に書き込み権限がありません",
  "val.settings_chmod": "chmod 644 {path} を実行してください",
  "val.settings_creatable": "settings.json を作成可能",
  "val.claude_dir_not_writable": "~/.claude/ に書き込み権限がありません",
  "val.claude_dir_chmod": "chmod 755 {path} を実行してください",
  "val.hooks_unset": "Hooks: 制限なし（settings.json 未作成）",
  "val.hooks_disabled": "Hooks が無効化されています",
  "val.hooks_disabled_hint":
    "cc-room はファイル共有に PostToolUse hook を使用します。settings.json から hooks の無効化設定を削除してください",
  "val.hooks_ok": "Hooks: 有効",
  "val.hooks_unrestricted": "Hooks: 制限なし",
  "val.mcp_ok": "MCP Server: 登録可能",
  "val.mcp_disabled": "MCP Server の登録が無効化されています",
  "val.mcp_disabled_hint":
    "cc-room は MCP Server 経由で Claude Code と連携します。settings.json から MCP の無効化設定を削除してください",
  "val.session_ok": "セッションディレクトリが存在",
  "val.session_pending": "セッションディレクトリ未作成（初回セッション後に生成される）",
  "val.git_ok": "Git ユーザー: {name}",
  "val.git_no_name": "git user.name が未設定",
  "val.git_no_name_hint":
    'git config --global user.name "Your Name" で設定してください（cc-room の identity に使用）',
  "val.git_missing": "git が見つかりません",
  "val.git_hint": "git をインストールしてください",
};

const catalogs: Record<Locale, Dict> = { en, ja };

let activeLocale: Locale = "en";

export function setLocale(locale: Locale): void {
  activeLocale = locale;
}

export function getLocale(): Locale {
  return activeLocale;
}

export function t(key: string, vars: Record<string, string | number> = {}): string {
  const catalog = catalogs[activeLocale] ?? catalogs.en;
  let template = catalog[key] ?? catalogs.en[key] ?? key;
  for (const [k, v] of Object.entries(vars)) {
    template = template.replaceAll(`{${k}}`, String(v));
  }
  return template;
}
