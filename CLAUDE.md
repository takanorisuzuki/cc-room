# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is cc-room

ホワイトボードのある会議室に、各自が自分の Claude を連れて入る体験を Claude Code の拡張で実現するツール。

- 各エンジニアが自分の Claude Code で作業しながら、Stop 時・定期的にサマリーが自動でホワイトボードに出る（**公開中** = Private OFF、Primary ルーム）
- `@name`/`@here`/`@all` で人間同士がメンション。**公開中**なら送信者のサマリー付きで届き、受信側 Claude も把握する
- 手元の作業は **`/private on`** で誰にも見えない。戻すときは **share / drop** を毎回選択
- プライベートツール結果（カレンダー、メール等）は公開中でも自動除外
- スキルや CLAUDE.md を「これいいよ」と AirDrop 的に永続コピーで共有できる

Claude Code 自体を改造せず、Hooks / MCP Server / Slash Commands の公式拡張ポイントのみを使う。

## Tech stack

- Language: TypeScript、Runtime: Node.js 20+
- Package manager: pnpm（モノレポ構成）
- mDNS: `multicast-dns`、WebSocket: `ws`、File watcher: `chokidar`
- MCP SDK: `@modelcontextprotocol/sdk`
- Summarizer: `@anthropic-ai/sdk`（claude-haiku-4-5）

## Development commands

```bash
pnpm install          # 依存インストール
pnpm build            # TypeScript コンパイル
pnpm dev              # watch モードでビルド
pnpm test             # テスト実行
pnpm test -- <file>   # 単一テストファイルを実行

# daemon の起動（開発時）
node dist/daemon/index.js

# セットアップスクリプトのローカルテスト
node dist/setup/index.js
```

## Architecture

### cc-room-daemon（`packages/daemon/`）

バックグラウンド常駐プロセス。mDNS で部屋を公告・発見し、WebSocket でメッセージ・ファイルを中継する。session jsonl を監視してサマリー生成（Primary かつ Private OFF 時のみ配信）。MCP server として Claude Code からの tool call を受け付ける。

主要モジュール:
- **RoomServer** (`server.ts`): WebSocket サーバー（inbound 接続の受付・認証）
- **PeerConnector** (`peer-connector.ts`): 他デーモンへの outbound WebSocket クライアント（join 時に接続）
- **RoomLifecycle** (`room-lifecycle.ts`): 部屋のクリーンアップ管理（shutdown 時の全退出 + idle 自動削除）
- **Discovery** (`discovery.ts`): mDNS による部屋の公告・発見
- **SessionWatcher** (`watcher.ts`): Claude Code の session jsonl を監視
- **Summarizer** (`summarizer.ts`): 会話サマリー生成（claude-haiku-4-5）
- **PrivacyFilter** (`privacy-filter.ts`): プライベートツール結果の自動除外
- **HttpApi** (`http-api.ts`): localhost HTTP API（MCP/Hook/スキルから呼ばれる）

MCP tools: `room_status()`, `room_context()`, `room_messages()`, `room_files()`, `room_unread()`, `room_invite()`, `room_share()` — v0.2+ で `room_memory_search()`, `room_dream()`、v0.3+ で `room_memory_trace()`

### setup-cc-room（`packages/setup/`）

`npx setup-cc-room` で実行されるインストーラー。

### slash commands（`packages/commands/`）

`.claude/commands/` 配下の Markdown ファイル。3コマンド:
- `/room` — 部屋の管理: open, join, leave, switch, ステータス表示, remember（v0.3+ チームメモリ: `dream status|objection|hold|revert|mine`, `config dream` — 詳細は [packages/commands/room/room.md](packages/commands/room/room.md)）
- `/private` — 手元/公開: on, off, share, drop
- `/show` — 明示共有のみ: メッセージ投稿, スキル共有（トグルは非推奨 → `/private`）

## Sharing model（会議室モデル）

```
ホワイトボード（全員に見える）     手元（自分だけ）         プライベート（絶対非公開）
──────────────────────────        ─────────────────       ───────────────────────
Private OFF + Primary              Private ON の執筆        カレンダー
/show 明示メッセージ               pending（share/drop 待ち） MCP プライベート結果
@メンション（公開中のみ             @メンション本文           個人連絡先
 context_summary 付き）            （Private 中は summary なし）
/room remember のメモ
共有スキル・CLAUDE.md
```

### `/private`（手元 / 公開）

- `/private on` — 手元のみ。自動共有停止
- `/private off` — pending あれば **毎回 share / drop を選択**（自動 flush なし）
- `/private share` / `/private drop` — 明示サブコマンド
- `/show "msg"` — Primary へ明示投稿（Private 中は確認後）

### ルーム参加（Primary + Watch）

- **Primary 1** — 執筆・サマリー・Dream の対象ルーム
- **Watch** — Read Only（2 部屋目 join 時 default）
- `/room switch` — Primary 切替

## Local storage layout

```
~/.cc-room/
├── bin/cc-room-daemon
├── config.yaml
├── rooms/{room-id}/
│   ├── meta.json
│   ├── context/{member}.md    # 公開中のサマリー
│   ├── artifacts/{member}/    # 公開中の成果物
│   ├── messages.jsonl
│   ├── mentions.jsonl         # @メンション（送受信）
│   ├── memory.md              # 旧形式（後方互換）
│   ├── room-memory/           # チームメモリ（v0.1+）
│   │   ├── MEMORY.md          # L0 索引（Hook 注入）
│   │   └── *.md
│   └── .last-inject           # 索引注入済みセッション ID
└── logs/daemon.log
```

## Hooks（`.claude/settings.json` に設定）

| Hook | トリガー | 動作 |
|---|---|---|
| `UserPromptSubmit` | ユーザーが Claude に送信するたび | ①`@name` を検出して mention 送信<br/>②未読メンションをバナーとしてプロンプト先頭に差し込む<br/>③セッション初回: チームメモリ索引（L0）を `<cc-room-memory>` で注入 |
| `PostToolUse` (Write/Edit) | ファイル生成/変更 | Primary かつ Private OFF なら成果物を配信 |
| `Notification` | 入退室、メッセージ受信 | notifications.jsonl に書き込み |
| `Stop` | セッション終了 | Primary かつ Private OFF なら最終サマリーを共有 |

## Room lifecycle

- **Ctrl+C / SIGTERM での停止**: 全部屋から退出（`leaveAll()`）してからプロセス終了
- **Idle 自動クリーンアップ**: ピアが接続した実績のある部屋で、全ピア切断後 30 秒間再接続がなければ自動削除
- **新規作成直後の部屋**: まだピアが接続したことがないため、idle 対象外（誤削除防止）

## Key constraints

- **Claude Code 無改造**: session jsonl は外から file watcher で読むだけ
- **外部サーバーなし**: 全通信は LAN 内のみ（mDNS + WebSocket）
- **プライバシー**: MCP ツール結果はデフォルト非公開。公開中でも自動除外。
- **settings.json の更新**: read → merge → write を必ず守る
- **部屋の認証**: 名前 + 6桁 PIN → HMAC キー導出
- **CC_ROOM_HOME**: 環境変数でデータディレクトリを変更可能（デフォルト `~/.cc-room/`）

## Local testing

`CC_ROOM_HOME` 環境変数でデータディレクトリを分離し、ポートを各自異なる設定にすることで、同一マシン上で複数デーモンを起動して E2E テストできる。

## Commit & branch conventions

コミットメッセージ・コメントは日本語 OK、`feat/fix/docs/refactor/test/chore` プレフィックス、ブランチ名は `feature/name` or `fix/name`。
