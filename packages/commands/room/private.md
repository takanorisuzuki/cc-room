---
name: private
description: 手元モードの ON/OFF を切り替える。OFF に戻すときは溜まった作業を share（送る）/ drop（捨てる）から毎回選択する。
---

手元（Private）/ 公開を切り替えるコマンド。公開中（Private OFF）は Primary ルームへサマリー・成果物が自動で流れる。Private ON 中の執筆は pending に蓄積され、誰にも見えない。

## ポートの取得

すべての HTTP リクエスト前に、以下でポートを取得する:

```bash
CC_ROOM_HOME="${CC_ROOM_HOME:-$HOME/.cc-room}"
HTTP_PORT=$(grep 'http_port:' "$CC_ROOM_HOME/config.yaml" 2>/dev/null | awk '{print $2}' | tr -d '[:space:]')
HTTP_PORT="${HTTP_PORT:-7332}"
BASE_URL="http://127.0.0.1:$HTTP_PORT"
```

## サブコマンド

### `/private`（引数なし）— 状態表示

1. `GET $BASE_URL/status` を取得する。
2. 以下の形式で表示する:
   ```
   🔒 Private ON（手元モード） / 📡 公開中（Private OFF）
   Primary: <primary_room_name>
   手元に溜まっている作業: <pending_turns + pending_files> 件
   ```

### `/private on` — 手元モードへ

1. `POST $BASE_URL/private` に `{ "mode": "on" }` を送信する。
2. 成功した場合:
   ```
   🔒 手元モードにしました。作業は誰にも見えません（/private off で公開に戻す）
   ```

### `/private off` — 公開へ戻る

1. `POST $BASE_URL/private` に `{ "mode": "off" }` を送信する。
2. レスポンスで分岐する:
   - `needs_choice: true` の場合、**必ずユーザーに確認する**（自動で share しない）:
     ```
     手元に <pending> 件あります。Primary（<primary_room_name>）へ送りますか？
     → share（送ってから公開に戻る） / drop（捨てて公開に戻る）
     ```
     ユーザーの選択に応じて `/private share` または `/private drop` を実行する。
   - `needs_choice` がない場合（pending 0 件）:
     ```
     📡 公開に戻りました。作業サマリーが Primary（<primary_room_name>）に流れます
     ```

### `/private share` — pending を送ってから公開へ

1. `POST $BASE_URL/private` に `{ "mode": "share" }` を送信する。
2. 成功した場合:
   ```
   📡 手元の <shared> 件を Primary（<primary_room_name>）へ共有して公開に戻りました
   ```

### `/private drop` — pending を捨てて公開へ

1. `POST $BASE_URL/private` に `{ "mode": "drop" }` を送信する。
2. 成功した場合:
   ```
   🗑 手元の <dropped> 件を破棄して公開に戻りました
   ```

## エラー処理

- daemon が起動していない場合:
  「cc-room daemon が起動していません。」
- ルームに参加していない場合:
  「ルームに参加していません。`/room open` または `/room join` で参加してください。」
