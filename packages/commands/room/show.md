---
name: show
description: ホワイトボードへの明示投稿と、スキル・コマンド・CLAUDE.md の共有を行う。手元/公開の切替は /private。
---

会議室のホワイトボードへ明示的に書き込むコマンド。**手元/公開の切替は `/private` を使う**（旧 `/show` トグルは廃止）。

## ポートの取得

すべての HTTP リクエスト前に、以下でポートを取得する:

```bash
CC_ROOM_HOME="${CC_ROOM_HOME:-$HOME/.cc-room}"
HTTP_PORT=$(grep 'http_port:' "$CC_ROOM_HOME/config.yaml" 2>/dev/null | awk '{print $2}' | tr -d '[:space:]')
HTTP_PORT="${HTTP_PORT:-7332}"
BASE_URL="http://127.0.0.1:$HTTP_PORT"
```

## サブコマンド

### `/show`（引数なし）— 非推奨

旧トグルは廃止。以下を案内する:

```
手元/公開の切替は /private を使ってください:
  /private on   — 手元モード（作業を見せない）
  /private off  — 公開に戻る（溜まった作業は share/drop を選択）
メッセージ投稿は /show "メッセージ" です。
```

### `/show <message>` — メッセージ投稿

**Primary ルーム**のホワイトボードにメッセージを書く。

1. `GET $BASE_URL/status` で `private` を確認する。
2. Private ON の場合は必ずユーザーに確認する:
   「手元モード中です。このメッセージは Primary（<primary_room_name>）に公開されます。送りますか？」
   → 承諾された場合のみ続行。
3. `POST $BASE_URL/share` に以下を送信する:
   ```json
   { "message": "<message>" }
   ```
   （Primary ルームにのみ投稿される）
4. 成功した場合:
   ```
   📡 [<room_name>] <message>
   ```

### `/show skill <name>` — スキル共有

自分のスキルファイルを部屋全員に共有する（受信側は承認が必要）。

1. ポートを取得する（上記参照）。
2. スキルファイルを読み込む:
   ```bash
   SKILL_NAME="<name>"
   SKILL_BASE="${SKILL_NAME%.md}"
   SKILL_FILE=""
   CC_CLAUDE_HOME="${CC_CLAUDE_HOME:-$HOME/.claude}"
   for dir in "$CC_CLAUDE_HOME/skills" "$CC_CLAUDE_HOME/commands"; do
     if [ -f "$dir/$SKILL_BASE.md" ]; then
       SKILL_FILE="$dir/$SKILL_BASE.md"
       break
     elif [ -f "$dir/$SKILL_BASE" ]; then
       SKILL_FILE="$dir/$SKILL_BASE"
       break
     fi
   done
   if [ -z "$SKILL_FILE" ]; then
     echo "エラー: スキル '$SKILL_NAME' が見つかりません"
     exit 1
   fi
   SKILL_CONTENT=$(cat "$SKILL_FILE")
   ```
3. `POST $BASE_URL/show/file` に以下を送信する:
   ```json
   { "share_type": "skill", "filename": "<name>.md", "content": "<file_content>" }
   ```
4. 成功した場合:
   ```
   📤 スキル '<name>' を共有しました（受信側は /room accept で承認が必要です）
   ```

### `/show command <name>` — コマンド共有

自分のコマンドファイルを部屋全員に共有する（受信側は承認が必要）。

1. ポートを取得する（上記参照）。
2. コマンドファイルを読み込む:
   ```bash
   CMD_NAME="<name>"
   CMD_BASE="${CMD_NAME%.md}"
   CMD_FILE=""
   for dir in "$HOME/.claude/commands"; do
     if [ -f "$dir/$CMD_BASE.md" ]; then CMD_FILE="$dir/$CMD_BASE.md"; break; fi
   done
   if [ -z "$CMD_FILE" ]; then
     echo "エラー: コマンド '$CMD_NAME' が見つかりません"
     exit 1
   fi
   CMD_CONTENT=$(cat "$CMD_FILE")
   ```
3. `POST $BASE_URL/show/file` に以下を送信する:
   ```json
   { "share_type": "command", "filename": "<name>.md", "content": "<file_content>" }
   ```
4. 成功した場合:
   ```
   📤 コマンド '<name>' を共有しました（受信側は /room accept で承認が必要です）
   ```

### `/show claude-md` — CLAUDE.md 共有

自分のプロジェクトの CLAUDE.md を部屋全員に共有する（受信側は承認後 Room-scoped に保存され、グローバルへの昇格は `/room adopt` で行う）。

1. ポートを取得する（上記参照）。
2. カレントディレクトリの CLAUDE.md を読み込む:
   ```bash
   CLAUDE_MD_FILE="$(pwd)/CLAUDE.md"
   if [ ! -f "$CLAUDE_MD_FILE" ]; then
     GIT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
     if [ -n "$GIT_ROOT" ] && [ -f "$GIT_ROOT/CLAUDE.md" ]; then
       CLAUDE_MD_FILE="$GIT_ROOT/CLAUDE.md"
     else
       echo "エラー: CLAUDE.md が見つかりません"
       exit 1
     fi
   fi
   CLAUDE_MD_CONTENT=$(cat "$CLAUDE_MD_FILE")
   ```
3. `POST $BASE_URL/show/file` に以下を送信する:
   ```json
   { "share_type": "claude_md", "filename": "CLAUDE.md", "content": "<file_content>" }
   ```
4. 成功した場合:
   ```
   📤 CLAUDE.md を共有しました（受信側は /room accept で承認後、Room-scoped に保存されます）
   /room adopt で ~/.claude/CLAUDE.md に昇格できます
   ```

## エラー処理

- daemon が起動していない場合:
  「cc-room daemon が起動していません。」
- ルームに参加していない場合:
  「ルームに参加していません。`/room open` または `/room join` で参加してください。」
- Primary ルームがない場合:
  「`/room switch <name>` で執筆するルームを選んでください。」
