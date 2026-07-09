#!/usr/bin/env node

import { validateAll, printResults } from "./validators.js";
import { install } from "./installer.js";

async function main() {
  console.log("\n  🏠 setup-cc-room v0.2.0\n");

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
  リモートワーク時は Tailscale などの VPN をご利用ください。

  ドキュメント: https://github.com/takanorisuzuki/cc-room
`);
}

main().catch((err) => {
  console.error("  \x1b[31mエラー:\x1b[0m", err instanceof Error ? err.message : err);
  process.exit(1);
});
