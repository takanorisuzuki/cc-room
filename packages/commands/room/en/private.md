---
name: private
description: Toggle local (Private) mode. When turning off, always choose share or drop for pending work.
---

Toggle between local (Private) and public. While public (Private OFF), summaries and artifacts flow to the Primary room automatically. Work done during Private ON accumulates as pending and stays invisible to others.

## Resolve the port

Before every HTTP request, resolve the port:

```bash
CC_ROOM_HOME="${CC_ROOM_HOME:-$HOME/.cc-room}"
HTTP_PORT=$(grep 'http_port:' "$CC_ROOM_HOME/config.yaml" 2>/dev/null | awk '{print $2}' | tr -d '[:space:]')
HTTP_PORT="${HTTP_PORT:-7332}"
BASE_URL="http://127.0.0.1:$HTTP_PORT"
```

## Subcommands

### `/private` (no args) — status

1. `GET $BASE_URL/status`.
2. Display:
   ```
   🔒 Private ON (local mode) / 📡 Live (Private OFF)
   Primary: <primary_room_name>
   Pending local work: <pending_turns + pending_files> items
   ```

### `/private on` — enter local mode

1. `POST $BASE_URL/private` with `{ "mode": "on" }`.
2. On success:
   ```
   🔒 Switched to local mode. Your work is hidden (use /private off to go public)
   ```

### `/private off` — return to public

1. `POST $BASE_URL/private` with `{ "mode": "off" }`.
2. Branch on the response:
   - If `needs_choice: true`, **always ask the user** (never auto-share):
     ```
     You have <pending> pending items. Send them to Primary (<primary_room_name>)?
     → share (send, then go public) / drop (discard, then go public)
     ```
     Then run `/private share` or `/private drop` based on their choice.
   - If no `needs_choice` (0 pending):
     ```
     📡 Back to public. Work summaries will flow to Primary (<primary_room_name>)
     ```

### `/private share` — share pending, then go public

1. `POST $BASE_URL/private` with `{ "mode": "share" }`.
2. On success:
   ```
   📡 Shared <shared> pending items to Primary (<primary_room_name>) and returned to public
   ```

### `/private drop` — discard pending, then go public

1. `POST $BASE_URL/private` with `{ "mode": "drop" }`.
2. On success:
   ```
   🗑 Discarded <dropped> pending items and returned to public
   ```

## Errors

- If the daemon is not running:
  "cc-room daemon is not running."
- If not in a room:
  "You are not in a room. Use `/room open` or `/room join` first."
