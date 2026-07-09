---
name: room
description: 会議室の作成・参加・退出・Primary 切替・ステータス表示・メモを行う統合コマンド。
---

会議室に関する全ての操作を行う統合コマンド。

## ポートの取得

すべての HTTP リクエスト前に、以下でポートを取得する:

```bash
CC_ROOM_HOME="${CC_ROOM_HOME:-$HOME/.cc-room}"
HTTP_PORT=$(grep 'http_port:' "$CC_ROOM_HOME/config.yaml" 2>/dev/null | awk '{print $2}' | tr -d '[:space:]')
HTTP_PORT="${HTTP_PORT:-7332}"
BASE_URL="http://127.0.0.1:$HTTP_PORT"
```

以降の手順で `http://127.0.0.1:7332` とある箇所はすべて `$BASE_URL` に置き換える。

## サブコマンド

### `/room`（引数なし）— ホワイトボードを見る

1. `BASE_URL` を取得する（上記参照）。
2. 未読通知を確認して表示し、既読にマークする:
   ```bash
   NOTIF_FILE="$CC_ROOM_HOME/notifications.jsonl"
   LAST_READ_FILE="$CC_ROOM_HOME/notifications_last_read"
   LAST_READ=$(cat "$LAST_READ_FILE" 2>/dev/null || echo "")
   if [ -f "$NOTIF_FILE" ]; then
     # LAST_READ より新しい行（未読）を抽出して表示
     UNREAD=$(awk -v last="$LAST_READ" '
       { ts = substr($0, 8, 24); if (ts > last) print }
     ' "$NOTIF_FILE")
     if [ -n "$UNREAD" ]; then
       echo "🔔 未読通知:"
       echo "$UNREAD" | python3 -c '
import sys, json
for line in sys.stdin:
    line = line.strip()
    if not line: continue
    try:
        d = json.loads(line)
        t = d.get("type")
        if t == "join":
            print(f"  👋 {d.get(\"identity\", \"\")} が {d.get(\"room\", \"\")} に入室しました")
        elif t == "leave":
            print(f"  🚪 {d.get(\"identity\", \"\")} が {d.get(\"room\", \"\")} から退出しました")
        elif t == "message":
            print(f"  💬 {d.get(\"from\", \"\")}: {d.get(\"content\", \"\")[:80]}")
        elif t == "room_closed":
            print(f"  🔒 会議室 {d.get(\"room\", \"\")} が閉じられました")
        elif t == "file_received":
            print(f"  📎 {d.get(\"from\", \"\")} が {d.get(\"filename\", \"\")} を共有しました")
        elif t == "dream_proposals":
            print(f"  📋 チームへの提案 {d.get(\"count\", 0)} 件 ({d.get(\"room\", \"\")})")
        elif t == "dream_merged":
            print(f"  🧠 チームの記憶が更新されました ({d.get(\"room\", \"\")})")
    except Exception:
        pass
'
       echo ""
     fi
     # 既読マーク: 最終行の ts を保存
     LATEST_TS=$(tail -1 "$NOTIF_FILE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('ts',''))" 2>/dev/null)
     [ -n "$LATEST_TS" ] && echo "$LATEST_TS" > "$LAST_READ_FILE"
   fi
   ```
3. `GET $BASE_URL/status` でルーム一覧を取得する。
4. `GET $BASE_URL/context` で全メンバーのサマリーを取得する。
5. `GET $BASE_URL/messages` でメッセージ一覧を取得する。
6. 以下の形式で表示する:

   ```
   🏠 <room_name>  ★ Primary / 👀 Watch  🔒 Private ON / 📡 公開中
   メンバー: <member1>, <member2>, ...
   通知: ON（🔔）/ OFF（🔕）

   📋 ホワイトボード:
   （context にサマリーがあれば表示）
     <member1>: <summary>

   💬 メッセージ:
   （messages に内容があれば新しい順に表示）
     [時刻] <from>: <content>
   ```

   各ルームの role / Private は `GET $BASE_URL/status` の `rooms[]` から表示する:
   ```bash
   curl -s "$BASE_URL/status" | python3 -c '
import sys, json
d = json.load(sys.stdin)
primary = d.get("primary_room_name") or "(なし)"
priv = "🔒 Private ON" if d.get("private") else "📡 公開中"
print(f"Primary: {primary}  {priv}")
for r in d.get("rooms", []):
    mark = "★" if r.get("role") == "primary" else "👀"
    print(f" {mark} {r[\"name\"]} ({r.get(\"role\", \"watch\")})")
'
   ```

   通知状態は `~/.cc-room/config.yaml` の `notifications.enabled` を参照して表示する:
   ```bash
   CC_ROOM_HOME="${CC_ROOM_HOME:-$HOME/.cc-room}"
   NOTIFY_ENABLED=$(python3 -c "
   import sys
   enabled = True
   try:
       with open('$CC_ROOM_HOME/config.yaml') as f:
           in_sect = False
           for line in f:
               if line.startswith('notifications:'):
                   in_sect = True
               elif in_sect and line.strip().startswith('enabled:'):
                   enabled = 'false' not in line.lower()
                   break
               elif in_sect and line.strip() and not line.startswith(' '):
                   in_sect = False
   except Exception:
       pass
   print('ON' if enabled else 'OFF')
   " 2>/dev/null || echo "ON")
   [ "$NOTIFY_ENABLED" = "ON" ] && echo "通知: ON 🔔" || echo "通知: OFF 🔕"
   ```

7. ルームに参加していない場合:
   「ルームに参加していません。`/room open <名前>` で作成するか `/room join` で参加してください。」

### `/room open <name> [--quiet] [--dream-mine=...] [--dream-threshold=N] [--dream-silent=on|off]` — 会議室を開く

1. `--quiet` がある場合は `"quiet": true`、なければ `false`。
2. dream オプションがある場合、`dream` オブジェクトを body に含める（ルーム作成時のみ設定可）:
   - `--dream-mine=every_stop|threshold|manual_only` → `"mine_trigger"`
   - `--dream-threshold=N` → `"session_threshold": N`（threshold 時）
   - `--dream-silent=on|off` → `"silent_merge": true/false`
3. `POST $BASE_URL/room/create` に以下を送信する:
   ```json
   { "name": "<name>", "quiet": false, "dream": { "mine_trigger": "every_stop" } }
   ```
   `dream` は省略可（グローバル default を使用）。
4. 成功した場合:
   ```
   ✅ 会議室 '<name>' を開きました
   PIN: <6桁の数字>

   チームメイトに部屋名と PIN を伝えてください。
   /room join <name> <PIN> で参加できます。

   ★ この部屋が Primary（執筆するルーム）になります
   📡 公開中 / 🔒 Private ON（レスポンスの private に従う）

   チームメモリ設定:
   <dream_summary>
   ```

オプション:
- `--quiet`: 入室時から Private ON（手元モード）
- `--dream-mine=...`: Mine トリガー（every_stop / threshold / manual_only）
- `--dream-threshold=N`: threshold 時の Stop 回数
- `--dream-silent=on|off`: 72h サイレントマージ ON/OFF

※ `--keep session|ttl|permanent` は将来対応予定

### `/room join [name] [pin] [--quiet]` — 会議室に入る

引数なしの場合:
1. `GET $BASE_URL/room/discover` で LAN 上の部屋一覧を取得する。
2. 一覧を表示:
   ```
   📡 LAN 上の部屋:
   • <room_name> (hosted by <identity>, <N>人)

   /room join <名前> <PIN> で参加
   ```

引数ありの場合:
1. `POST $BASE_URL/room/join` に `{ "name": "<name>", "pin": "<pin>", "quiet": false }` を送信する（`--quiet` 時は `true`）。
2. 成功した場合、レスポンスの `role` に応じて表示する:
   - `role: "primary"`（最初のルーム）:
     ```
     ✅ '<name>' に入室しました
     ★ この部屋が Primary（執筆するルーム）になります
     ホワイトボードの内容を受信中...
     ```
   - `role: "watch"`（2 部屋目以降）:
     ```
     ✅ '<name>' に Watch（見るだけ）で入室しました
     執筆するには /room switch <name> で Primary を切り替えてください
     ```

### `/room leave` — 会議室を出る

1. `GET $BASE_URL/status` でルーム一覧を取得する。
2. ホストで他メンバーがいる場合:
   「ゲストが接続中です。[引き継いで退出 / 全員退出で閉鎖]」
3. `POST $BASE_URL/leave` に `{ "room_id": "<id>" }` を送信する。
4. 成功した場合: 「会議室を退出しました。」

### `/room pending` — 承認待ちファイル一覧

共有を受信したが、まだ承認していないファイルの一覧を表示する。

1. `GET $BASE_URL/room/pending` を取得する。
2. 以下の形式で表示する:
   ```
   📥 承認待ちファイル:
     [<id>] <type>: <filename>
             from: <送信者>
             保存先: <save_path（フルパス）>
   ```
   一覧が空の場合: 「承認待ちのファイルはありません」

### `/room accept <id>` — 共有ファイルを承認

承認待ちのファイルを受け入れ、指定された保存先に書き込む。

1. `POST $BASE_URL/room/accept` に以下を送信する:
   ```json
   { "pending_id": "<id>" }
   ```
2. 成功した場合:
   ```
   ✅ <filename> を承認しました
   保存先: <save_path（フルパス）>
   ```
   `claude_md` タイプの場合: 「Room-scoped に保存されました。グローバルに追加するには /room adopt を実行してください」

### `/room reject <id>` — 共有ファイルを拒否

承認待ちのファイルを破棄する。

1. `POST $BASE_URL/room/reject` に以下を送信する:
   ```json
   { "pending_id": "<id>" }
   ```
2. 成功した場合: 「🗑 <id> を破棄しました」

### `/room adopt` — Room-scoped CLAUDE.md をグローバルへ昇格

現在の部屋の CLAUDE.md を `~/.claude/CLAUDE.md` に追記する。

1. `GET $BASE_URL/status` で現在の room_id を取得する。
2. `POST $BASE_URL/room/adopt` に以下を送信する:
   ```json
   { "room_id": "<room_id>" }
   ```
3. 成功した場合:
   ```
   ✅ Room-scoped CLAUDE.md を ~/.claude/CLAUDE.md に追記しました
   パス: <path>
   ```

### `/room notify on` / `/room notify off` — 通知を切り替える

自分の OS 通知を有効化・無効化する。設定は `~/.cc-room/config.yaml` に永続保存される。

1. `POST $BASE_URL/notify/toggle` に以下を送信する:
   - `on` の場合: `{ "enabled": true }`
   - `off` の場合: `{ "enabled": false }`
2. 成功した場合:
   - `on`: 「🔔 通知を有効にしました」
   - `off`: 「🔕 通知を無効にしました」

### `/room switch <name>` — Primary（執筆するルーム）を切り替える

サマリー・成果物・Dream の対象ルームを切り替える。旧 Primary は Watch に降格する。

1. `POST $BASE_URL/room/switch` に以下を送信する:
   ```json
   { "name": "<name>" }
   ```
2. 成功した場合:
   ```
   ★ Primary: <name>（旧 Primary は Watch になりました）
   ```
3. 失敗（未参加の部屋名）: 「部屋 '<name>' が見つかりません」

```bash
curl -s -X POST "$BASE_URL/room/switch" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"<name>\"}" | python3 -m json.tool
```

### `/room status` — Primary / Private / チームメモリ設定を確認

各ルームの role（Primary/Watch）、Private 状態、effective dream 設定を一覧表示する。

1. `GET $BASE_URL/status` を取得する。
2. 以下の形式で表示する:

   ```
   Primary: <primary_room_name>  📡 公開中 / 🔒 Private ON

     ★ auth-feature (primary)
       mine: threshold (20 セッションごと) / silent ON / 公開中のみ Mine
     👀 side-project (watch)
       mine: every_stop / silent OFF / 公開中のみ Mine
   ```

   `rooms[].dream` は effective 設定（グローバル default + ルーム override 解決済み）。主要フィールド:
   - `mine_trigger` — `every_stop` / `threshold` / `manual_only`
   - `session_threshold` — threshold 時の Stop 回数
   - `silent_merge` — 72h サイレントマージ ON/OFF
   - `require_show_on` — 公開中のみ Mine

   実装例:
   ```bash
   curl -s "$BASE_URL/status" | python3 -c '
import sys, json
d = json.load(sys.stdin)
if not d.get("rooms"):
    print("ルームに参加していません")
    sys.exit(0)
primary = d.get("primary_room_name") or "(未設定 — /room switch <name>)"
priv = "🔒 Private ON" if d.get("private") else "📡 公開中"
print(f"Primary: {primary}  {priv}\n")

def dream_line(cfg):
    if not cfg:
        return ""
    mine = cfg.get("mine_trigger", "?")
    if mine == "threshold":
        threshold = cfg.get("session_threshold", "?")
        mine = f"threshold ({threshold} セッションごと)"
    silent = "ON" if cfg.get("silent_merge") else "OFF"
    show_req = "公開中のみ Mine" if cfg.get("require_show_on") else "常に Mine"
    return f"       mine: {mine} / silent {silent} / {show_req}"

for r in d.get("rooms", []):
    mark = "★" if r.get("role") == "primary" else "👀"
    print(f"  {mark} {r[\"name\"]} ({r.get(\"role\", \"watch\")})")
    line = dream_line(r.get("dream"))
    if line:
        print(line)
'
   ```

### `@name <message>` / `@here <message>` / `@all <message>` — チームメイトにメンション

通常の Claude Code 入力欄で `@` から始まるメッセージを送ると、Claude ではなく人間に届く。**このコマンドは Claude に指示するのではなく、ユーザーが直接入力するもの**。

| 構文 | 届く先 |
|---|---|
| `@akira JWT終わったよ` | akira だけに届く |
| `@here ランチ行く人いる？` | 公開中（Private OFF）のメンバー全員（今この場にいる人）|
| `@all デプロイ完了しました` | 部屋の全員（Private ON/OFF 問わず） |

日常的なやりとりは `@here` が自然。`@all` は強制割り込みになるため緊急時に使う。

**内部動作（UserPromptSubmit Hook が処理）**:
1. `@` プレフィックスを検出
2. 部屋のメンバーリストと照合:
   - `@name` → メンバーに存在する場合のみ mention 送信。存在しない名前（`@dataclass` 等）は通常入力として Claude に渡す
   - `@here` / `@all` → 予約語のため常に mention 送信
   - 大文字小文字無視（`@Akira` = `@akira`）
3. 自分の公開状態に応じて context_summary を決定:
   - 公開中（Primary かつ Private OFF）→ 直近サマリーを `context_summary` として同梱
   - Private ON または Watch ルーム → `context_summary` は省略
4. WebSocket 経由で宛先の daemon に `mention` メッセージを送信
5. プロンプトはそのまま Claude にも渡る（`@name` 付きの文として Claude が解釈できる）

**受信側**:
- `mentions.jsonl` にメンションが追記される
- ステータスラインに `📬 N件` が表示される
- 次に Claude に話しかけた際、`<cc-room-context>` タグ付きバナーとしてプロンプト先頭に挿入され、その時点で既読になる

未読メンションを今すぐ確認したい場合:
1. `GET $BASE_URL/unread` で未読メンション一覧を取得する。
2. 以下の形式で表示する:
   ```
   📬 未読メンション (<N>件):
     [<時刻>] <from>: <content>
              状況: <context_summary>  ← 送信者が公開中（Private OFF）のときのみ表示
   ```
   未読なし: 「📭 未読メンションはありません」

### `/room remember <content>` — 付箋を貼る（チームメモリ）

チームメモリに即時共有する（Private 状態に関係なく常に即時配信）。v0.1 以降は `room-memory/` に `.md` 生成 + `MEMORY.md` 索引更新。現行は `memory.md` への追記（後方互換）。

1. `POST $BASE_URL/memory` に `{ "content": "<content>" }` を送信する。
2. レスポンスの `message` フィールドをそのままユーザーに表示する（件数つき確認メッセージ）。

### `/room dream` — チームメモリ（自動整理・提案・マージ）

ユーザー向けには「Dream」と言わず **「チームメモリ」** と伝える。サブコマンドで操作する。

#### `/room dream status` — 設定と保留中の提案を確認

1. `GET $BASE_URL/dream/config`（必要なら `?room_id=`）で effective 設定を取得。
2. `GET $BASE_URL/dream/pending` で自分の保留提案一覧を取得。
3. 以下の形式で表示:

   ```
   📋 チームメモリ設定（<room_name>）:
   mine_trigger: threshold (20 セッションごと)
   silent_merge: ON（72h 異議申し立て）
   require_show_on: ON（公開中のみ Mine）

   あなたの保留提案: <N> 件
     1. [decision] JWT TTL を 1 日に短縮（期限: <objection_deadline>）
     2. ...
   ```

#### `/room dream objection [番号|slug]` — 自分の提案を保留（マージ停止）

1. 引数なし: 保留提案が 1 件ならそれを対象。複数なら一覧を出して選ばせる。
2. 番号 `N` または `slug` を指定。
3. `POST $BASE_URL/dream/objection` に送信:
   ```json
   { "proposal_slug": "<slug>", "reason": "まだ早い" }
   ```
4. レスポンスの `message` を表示（例: ⏸ 提案を保留しました）。

#### `/room dream hold [番号|slug]` — 異議申し立て期限を 72h 延長

1. 対象提案を特定（status と同様）。
2. `POST $BASE_URL/dream/hold` に `{ "proposal_slug": "<slug>" }` を送信。
3. レスポンスの `message` を表示。

#### `/room dream revert` — 直近のサイレントマージを取り消し

1. `POST $BASE_URL/dream/revert` に `{}` または `{ "room_id": "<id>" }` を送信。
2. レスポンスの `message` を表示（72h 以内の直近マージのみ）。

#### `/room dream mine` — 手動で知見候補を抽出（v0.2 手動 accept フロー）

直近セッションから候補を抽出し、ユーザーが選んで即時反映する（サイレントマージなし）。

1. `POST $BASE_URL/dream` を実行。
2. レスポンスの `candidates` を番号付きリストで表示。
3. 採用する項目を選んだら `POST $BASE_URL/dream/accept` に `{ "indices": [0, 2] }`（全件なら `{}`）。
4. レスポンスの `message` を表示。

MCP: 詳細検索 `room_memory_search(query)`、L2 原典 `room_memory_trace(entry_name)`。

### `/room config dream [key=value ...]` — ルームの Mine/マージ設定（ホストのみ）

Primary ルームの dream 設定を変更する。ホスト以外はエラー。

1. `GET $BASE_URL/dream/config` で現在値を表示。
2. 変更がある場合、`POST $BASE_URL/dream/config` にパッチを送信:

   | ユーザー入力 | JSON フィールド | 値 |
   |---|---|---|
   | `mine=every_stop` | `mine_trigger` | `every_stop` |
   | `mine=threshold` | `mine_trigger` | `threshold` |
   | `mine=manual` | `mine_trigger` | `manual_only` |
   | `threshold=10` | `session_threshold` | `10` |
   | `silent=on` | `silent_merge` | `true` |
   | `silent=off` | `silent_merge` | `false` |
   | `public=on` | `require_show_on` | `true`（公開中のみ Mine） |
   | `public=off` | `require_show_on` | `false`（常に Mine） |

   例: `POST $BASE_URL/dream/config` `{ "mine_trigger": "every_stop", "silent_merge": false }`

3. レスポンスの `summary` と `message` を表示。

**対話例:**

```
現在の設定（auth-feature）:
  mine_trigger: threshold (20 セッションごと)
  silent_merge: ON（72h 異議申し立て）
  require_show_on: ON（公開中のみ Mine）

/room config dream mine=every_stop
→ ✅ auth-feature のチームメモリ設定を更新しました
```

## エラー処理

- daemon が起動していない場合:
  「cc-room daemon が起動していません。`cc-room-daemon` を起動してください。」
