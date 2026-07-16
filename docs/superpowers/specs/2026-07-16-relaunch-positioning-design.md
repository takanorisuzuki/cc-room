# cc-room 再ローンチ（位置づけ整理 + 試せる状態）デザイン

日付: 2026-07-16  
ブランチ: `feature/relaunch-positioning`  
方針: 案2 — 「試せる最小セット」を一塊にする

## 1. 背景

README / GitHub description が「Claude Code 公式マルチプレイヤーが既に出て、本リポジトリはアーカイブ」という誤った前提で書かれている。実際は公式マルチプレイヤーは未提供のため、**現行の実用ツール**として改めて伝え直す。

あわせて README が勧める `npx setup-cc-room` は npm に未公開（404）で、訴求と実態が乖離している。

## 2. ゴール

1. 「アーカイブ／本家で代替済み」という誤った位置づけを消し、現行の実用ツールとして見せる
2. 初見が **インストール → `/room open` → 2人目 join** まで迷わず到達できる
3. その経路をテストと最低限のログで支え、「人に勧めてよい」状態にする

## 3. ターゲットと非ターゲット

| 優先 | 対象 |
|---|---|
| 主 | 同一 LAN の小〜中チーム（2〜5人） |
| 主 | まず個人で試し、あとでチームに持ち込む開発者 |
| 薄め | リモート / Tailscale（「使える」程度。前面に出さない） |

## 4. メッセージング

### 4.1 価値の優先順位（README 冒頭）

1. **A 体験** — 各自の Claude が同じ会議室にいる（ホワイトボード連携）
2. **C 簡単・LAN 完結** — `npx` 一発、外部サーバーなし
3. **B プライバシー** — `/private` による手元と公開の切替
4. **D 今すぐ使える選択肢** — 公式マルチプレイヤーが出るまでの実用手段（アーカイブではない）

### 4.2 言語

- **日本語 README を主**
- 冒頭近くに **短い英語 Overview**（何をするか / なぜ今 / どう始めるか の3〜5文）

### 4.3 README 構成（案）

1. 一行キャッチ + 短い概念図（既存の対比を活かす）
2. English Overview（短）
3. なぜ今 cc-room か（公式未提供・LAN・プライバシー）— アーカイブ文言は削除
4. Quick Start（`npx setup-cc-room` → `/room open` → join）
5. 使い方（既存コマンド表を整理）
6. 何が共有されるか / プライバシー
7. 仕組み（短く）
8. 要件（Tailscale は「リモートの場合」サブ節に退避）
9. 開発・License

### 4.4 GitHub メタ

- **description**: 「アーカイブ」を除去。例: `各自の Claude Code を同じ会議室で連携させる — LAN 内ホワイトボード共有`
- **topics**: 例 `claude-code`, `multiplayer`, `lan`, `mcp`, `collaboration`（確定は実装時）
- archived フラグは付けない（現状どおり false）

## 5. 「試せる」導入経路

### 5.1 現状の問題

- `setup-cc-room` は npm 未公開
- installer は `packages/setup/vendor/{daemon,commands}` を前提にするが、`vendor/` がリポジトリに無く、生成スクリプトも無い
- `@cc-room/daemon` / `@cc-room/shared` も未公開の可能性が高い

### 5.2 方針（推奨）

**`npx setup-cc-room` 一発**を維持する。そのため:

1. `packages/setup` に **vendor 同梱用の pack スクリプト**を追加  
   - build 済み daemon（依存込みで動く形）と commands markdown を `vendor/` に配置
2. `prepack` / 公開前に vendor を生成し、`files: ["dist", "vendor"]` で npm に載せる
3. `setup-cc-room@0.2.x` を npm 公開（権限がある前提。無い場合は README を git clone 手順にフォールバックし、公開ブロッカーとして明記）

代替（フォールバック）: npm 公開がブロックされた場合のみ、README の主経路を

```bash
git clone … && pnpm install && pnpm build && node packages/setup/dist/index.js
```

に切り替え、`npx` は「公開後」と注記する。**第一目標は npx 復旧**。

### 5.3 Happy Path 定義（成功条件）

同一マシン上の2デーモン（`CC_ROOM_HOME` 分離）または実2端末で:

1. setup がエラーなく完了する
2. デーモンが起動する
3. A が `/room open` 相当の部屋作成に成功する
4. B が join できる
5. 公開中のサマリーまたはメッセージが B 側で見える

## 6. 安定化（信頼性）

スコープ深さ: **C**（Happy Path + 壊れやすい点の洗い出し・修正 + テスト補強 + 最低限のログ）

### 6.1 調査・修正の優先領域

1. setup / vendor / デーモン起動
2. mDNS 発見と join
3. WebSocket 再接続・退室クリーンアップ
4. `/private` share / drop
5. 初見が詰まりやすいエラーメッセージ（「daemon が見つからない」等）

### 6.2 テスト

- 既存: `packages/daemon` の unit / integration / e2e（two-daemons 等）を活かす
- 追加方針:
  - setup の vendor 解決・コマンド配置のユニットテスト
  - Happy Path に関わる e2e / integration の不足分を補強
  - 壊れていた箇所には回帰テストを必須化

### 6.3 ログ

- 初見・デモで原因が分かるレベルに限定（過剰な構造化ログ基盤は作らない）
- setup 失敗時・daemon 未検出・部屋発見ゼロ件などに、次に取る行動が分かるメッセージ

## 7. スコープ外

- 新機能追加（Dream 拡張、新 MCP tool など）
- デモ動画 / ブログ本編
- リモート UX の本格強化
- 大規模リファクタ

## 8. 技術スタック（変更なし）

- TypeScript / Node.js 20+ / pnpm モノレポ
- mDNS (`multicast-dns`) + WebSocket (`ws`)
- MCP SDK / Claude Code Hooks・Slash Commands
- テスト: Vitest

## 9. 成功基準

- [ ] README にアーカイブ／「公式で代替済み」の誤情報がない
- [ ] GitHub description から「アーカイブ」が消えている
- [ ] 英語 Overview が README にある
- [ ] 文書化した Quick Start が実機（または2デーモン）で通る
- [ ] `npx setup-cc-room` が動く、または README が正直な代替手順のみを主経路にしている
- [ ] Happy Path 関連のテストが緑
- [ ] 既知の壊れやすい点のリストが消化され、残件は ISSUE/ドキュメントに明示

## 10. 実装の切り方（次工程）

1. メッセージング（README + GitHub メタ）
2. setup vendor 同梱 + 公開準備（試せる経路）
3. Happy Path 検証と壊れやすい点の修正
4. テスト補強・ログ改善
5. 最終チェック（成功基準の全項目）

詳細タスクは `docs/superpowers/plans/` の実装プランに落とす。
