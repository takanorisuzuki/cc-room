#!/usr/bin/env node

import { validateAll, printResults } from "./validators.js";
import { install } from "./installer.js";
import { uninstall } from "./uninstaller.js";

const VERSION = "0.2.1";

function printHelp(): void {
  console.log(`
  🏠 setup-cc-room v${VERSION}

  Usage:
    npx setup-cc-room           Install cc-room
    npx setup-cc-room uninstall Remove cc-room (daemon, hooks, data)
    npx setup-cc-room --help    Show this help
`);
}

async function runInstall(): Promise<void> {
  console.log(`\n  🏠 setup-cc-room v${VERSION}\n`);

  console.log("  Preflight checks を実行中...");
  const { passed, results } = validateAll();
  printResults(results);

  if (!passed) {
    console.log("  \x1b[31m前提条件を満たしていません。上記の問題を解決してから再実行してください。\x1b[0m\n");
    process.exit(1);
  }

  console.log("  \x1b[32m全チェック通過。インストールを開始します。\x1b[0m\n");

  await install();

  console.log(`
  \x1b[32m✅ セットアップが完了しました！\x1b[0m

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
`);
}

async function runUninstall(): Promise<void> {
  console.log(`\n  🏠 setup-cc-room v${VERSION} — uninstall\n`);
  await uninstall();
  console.log(`
  \x1b[32m✅ アンインストールが完了しました。\x1b[0m

  Claude Code を再起動してください（hooks / MCP の反映）。
`);
}

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (arg === "--help" || arg === "-h" || arg === "help") {
    printHelp();
    return;
  }
  if (arg === "uninstall" || arg === "--uninstall") {
    await runUninstall();
    return;
  }
  if (arg && arg !== "install") {
    console.error(`  不明な引数: ${arg}`);
    printHelp();
    process.exit(1);
  }
  await runInstall();
}

main().catch((err) => {
  console.error("  \x1b[31mエラー:\x1b[0m", err instanceof Error ? err.message : err);
  process.exit(1);
});
