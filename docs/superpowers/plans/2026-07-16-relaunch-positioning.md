# cc-room 再ローンチ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** アーカイブ誤表記を消し、`npx setup-cc-room`（または同等）で試せる現行ツールとして再提示し、Happy Path をテストで支える。

**Architecture:** 訴求は README / GitHub メタのみ。導入は `setup-cc-room` に daemon+commands を vendor 同梱し単一パッケージで配布。安定化は既存 e2e（two-daemons）と setup の回帰テストを軸にする。

**Tech Stack:** TypeScript, pnpm, tsup (daemon 単一バンドル), Vitest, npm (setup-cc-room), GitHub

## Global Constraints

- メッセージ順: 体験 → 簡単/LAN → プライバシー → 公式までの実用選択肢
- 日本語 README 主 + 短い英語 Overview
- リモート/Tailscale は前面に出さない
- 新機能追加・デモ動画・大規模リファクタはしない
- Node.js >= 20, pnpm >= 9
- コミットメッセージは日本語 OK、`feat/fix/docs/...` プレフィックス

---

### Task 1: README と GitHub メタの刷新

**Files:**
- Modify: `README.md`
- Modify (via gh): GitHub repo description / topics

**Interfaces:**
- Produces: 初見向け Quick Start 文言（Task 2 の導入経路と一致させる）

- [ ] **Step 1: README を書き換え**

構成:
1. キャッチ + 対比図
2. English Overview（3〜5文）
3. なぜ今か（アーカイブ文言削除、公式未提供を正確に）
4. Quick Start
5. 以降は既存の使い方・共有表・仕組みを整理して維持（Tailscale はサブ節）

- [ ] **Step 2: GitHub description / topics 更新**

```bash
gh repo edit takanorisuzuki/cc-room \
  --description "各自の Claude Code を同じ会議室で連携させる — LAN内ホワイトボード共有" \
  --add-topic claude-code --add-topic multiplayer --add-topic lan --add-topic mcp --add-topic collaboration
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: アーカイブ誤表記を直し現行ツールとして再提示"
```

---

### Task 2: setup の vendor 同梱（試せる経路）

**Files:**
- Create: `packages/setup/scripts/pack-vendor.mjs`
- Modify: `packages/setup/package.json`（`pack:vendor` / `prepack`）
- Modify: `packages/setup/src/installer.ts`（単一バンドル検出・エラーメッセージ改善）
- Create: `packages/setup/src/__tests__/find-daemon.test.ts`（または installer から抽出した関数のテスト）
- Modify: `packages/daemon/package.json`（`build:bundle` 追加）

**Interfaces:**
- Produces: `packages/setup/vendor/daemon/dist/index.js`（shebang 付き単一バンドル）
- Produces: `packages/setup/vendor/commands/room/{room,private,show}.md`
- Consumes: `packages/daemon` のソース / dist、`packages/commands/room/*.md`

- [ ] **Step 1: daemon 単一バンドル用スクリプトを追加**

`packages/daemon/package.json` に:

```json
"build:bundle": "tsup src/index.ts --format esm --bundle --platform node --target node20 --outDir dist-bundle --banner.mjs '#!/usr/bin/env node' --no-splitting"
```

必要なら `noExternal` で workspace 依存を巻き込む。ネイティブでバンドル不可なら vendor に `node_modules` をコピーする方式にフォールバック（実装時に検証）。

- [ ] **Step 2: `pack-vendor.mjs` を書く**

処理:
1. `pnpm --filter @cc-room/daemon run build:bundle`（または同等）
2. `vendor/daemon/dist/index.js` にコピーし executable bit
3. commands を `vendor/commands/room/` にコピー
4. `vendor/` は gitignore（npm pack 時のみ生成）

- [ ] **Step 3: installer の検出パスと失敗メッセージを改善**

daemon 未検出時に「vendor 未生成 / `pnpm --filter setup-cc-room run pack:vendor` / npm 公開版を使う」と次の行動を示す。

- [ ] **Step 4: ユニットテスト**

`findDaemonBin` 相当をテスト可能に export（または `resolveDaemonSource(baseDir)` を抽出）し、vendor パス優先を検証。

- [ ] **Step 5: ローカルで pack:vendor → setup 実行検証**

```bash
pnpm build
pnpm --filter setup-cc-room run pack:vendor
CC_ROOM_HOME=/tmp/cc-room-test-a node packages/setup/dist/index.js
```

Expected: エラーなく [1/5]〜[5/5] 完了、daemon バイナリ配置。

- [ ] **Step 6: Commit**

```bash
git commit -m "feat: setup-cc-room に daemon/commands を vendor 同梱できるようにする"
```

---

### Task 3: npm 公開準備（可能な範囲）

**Files:**
- Modify: `packages/setup/package.json`（description を訴求に合わせて更新）
- Create or note: 公開手順（README の Quick Start と整合）

- [ ] **Step 1: `npm pack` で tarball 内容を確認**（vendor 含むこと）
- [ ] **Step 2: `npm whoami` が通れば `npm publish --access public`（setup-cc-room）**
- [ ] **Step 3: 未ログインなら README Quick Start に git clone 手順を併記し、npx は「npm 公開後」と注記。ユーザーに `npm login` を依頼**

---

### Task 4: Happy Path 検証と壊れやすい点

**Files:**
- Run / possibly fix: `packages/daemon/src/__tests__/e2e/two-daemons.test.ts`
- Fix as found under `packages/daemon/src/`, `packages/setup/src/`
- Modify: installer / register-service のログ文言

- [ ] **Step 1: 既存テスト実行**

```bash
pnpm test
```

- [ ] **Step 2: two-daemons e2e を重点確認。失敗なら修正 + 回帰**
- [ ] **Step 3: setup → daemon 起動の手動 or スクリプト検証（CC_ROOM_HOME 分離）**
- [ ] **Step 4: 発見した脆い点を潰し、残件は仕様の成功基準リストに明示**
- [ ] **Step 5: Commit（修正単位）**

---

### Task 5: 最終整合チェック

- [ ] 仕様の成功基準チェックリストをすべて確認
- [ ] README の Quick Start と実際の導入経路が一致
- [ ] `git status` クリーン、ブランチ上にコミット済み

---

## Spec coverage

| Spec 項目 | Task |
|---|---|
| README / メッセージ順 / EN Overview | 1 |
| GitHub description / topics | 1 |
| npx / vendor 同梱 | 2, 3 |
| Happy Path / 安定化 / テスト / ログ | 2, 4 |
| スコープ外（新機能等） | 触らない |
