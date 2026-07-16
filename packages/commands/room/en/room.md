---
name: room
description: Unified command for creating, joining, leaving, and switching Primary rooms, viewing status, and managing notes.
---

Unified command for all room-related operations.

## Getting the port

Before every HTTP request, obtain the port as follows:

```bash
CC_ROOM_HOME="${CC_ROOM_HOME:-$HOME/.cc-room}"
HTTP_PORT=$(grep 'http_port:' "$CC_ROOM_HOME/config.yaml" 2>/dev/null | awk '{print $2}' | tr -d '[:space:]')
HTTP_PORT="${HTTP_PORT:-7332}"
BASE_URL="http://127.0.0.1:$HTTP_PORT"
```

In all subsequent steps, replace every occurrence of `http://127.0.0.1:7332` with `$BASE_URL`.

## Subcommands

### `/room` (no arguments) — View the whiteboard

1. Obtain `BASE_URL` (see above).
2. Check unread notifications, display them, and mark them as read:
   ```bash
   NOTIF_FILE="$CC_ROOM_HOME/notifications.jsonl"
   LAST_READ_FILE="$CC_ROOM_HOME/notifications_last_read"
   LAST_READ=$(cat "$LAST_READ_FILE" 2>/dev/null || echo "")
   if [ -f "$NOTIF_FILE" ]; then
     # Extract and display lines newer than LAST_READ (unread)
     UNREAD=$(awk -v last="$LAST_READ" '
       { ts = substr($0, 8, 24); if (ts > last) print }
     ' "$NOTIF_FILE")
     if [ -n "$UNREAD" ]; then
       echo "🔔 Unread notifications:"
       echo "$UNREAD" | python3 -c '
import sys, json
for line in sys.stdin:
    line = line.strip()
    if not line: continue
    try:
        d = json.loads(line)
        t = d.get("type")
        if t == "join":
            print(f"  👋 {d.get(\"identity\", \"\")} joined {d.get(\"room\", \"\")}")
        elif t == "leave":
            print(f"  🚪 {d.get(\"identity\", \"\")} left {d.get(\"room\", \"\")}")
        elif t == "message":
            print(f"  💬 {d.get(\"from\", \"\")}: {d.get(\"content\", \"\")[:80]}")
        elif t == "room_closed":
            print(f"  🔒 Room {d.get(\"room\", \"\")} was closed")
        elif t == "file_received":
            print(f"  📎 {d.get(\"from\", \"\")} shared {d.get(\"filename\", \"\")}")
        elif t == "dream_proposals":
            print(f"  📋 {d.get(\"count\", 0)} proposal(s) for the team ({d.get(\"room\", \"\")})")
        elif t == "dream_merged":
            print(f"  🧠 Team memory was updated ({d.get(\"room\", \"\")})")
    except Exception:
        pass
'
       echo ""
     fi
     # Mark as read: save the ts of the last line
     LATEST_TS=$(tail -1 "$NOTIF_FILE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('ts',''))" 2>/dev/null)
     [ -n "$LATEST_TS" ] && echo "$LATEST_TS" > "$LAST_READ_FILE"
   fi
   ```
3. Fetch the room list with `GET $BASE_URL/status`.
4. Fetch all member summaries with `GET $BASE_URL/context`.
5. Fetch the message list with `GET $BASE_URL/messages`.
6. Display in the following format:

   ```
   🏠 <room_name>  ★ Primary / 👀 Watch  🔒 Private ON / 📡 Live
   Members: <member1>, <member2>, ...
   Notifications: ON (🔔) / OFF (🔕)

   📋 Whiteboard:
   (display summaries from context if present)
     <member1>: <summary>

   💬 Messages:
   (display messages newest-first if present)
     [time] <from>: <content>
   ```

   Display each room's role / Private state from `rooms[]` in `GET $BASE_URL/status`:
   ```bash
   curl -s "$BASE_URL/status" | python3 -c '
import sys, json
d = json.load(sys.stdin)
primary = d.get("primary_room_name") or "(none)"
priv = "🔒 Private ON" if d.get("private") else "📡 Live"
print(f"Primary: {primary}  {priv}")
for r in d.get("rooms", []):
    mark = "★" if r.get("role") == "primary" else "👀"
    print(f" {mark} {r[\"name\"]} ({r.get(\"role\", \"watch\")})")
'
   ```

   Display notification state by reading `notifications.enabled` from `~/.cc-room/config.yaml`:
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
   [ "$NOTIFY_ENABLED" = "ON" ] && echo "Notifications: ON 🔔" || echo "Notifications: OFF 🔕"
   ```

7. If not joined to any room:
   "You are not in a room. Create one with `/room open <name>` or join with `/room join`."

### `/room open <name> [--quiet] [--dream-mine=...] [--dream-threshold=N] [--dream-silent=on|off]` — Open a room

1. If `--quiet` is present, set `"quiet": true`; otherwise `false`.
2. If dream options are present, include a `dream` object in the body (configurable only at room creation):
   - `--dream-mine=every_stop|threshold|manual_only` → `"mine_trigger"`
   - `--dream-threshold=N` → `"session_threshold": N` (when using threshold)
   - `--dream-silent=on|off` → `"silent_merge": true/false`
3. Send the following to `POST $BASE_URL/room/create`:
   ```json
   { "name": "<name>", "quiet": false, "dream": { "mine_trigger": "every_stop" } }
   ```
   `dream` is optional (global default is used if omitted).
4. On success:
   ```
   ✅ Opened room '<name>'
   PIN: <6-digit number>

   Share the room name and PIN with your teammates.
   They can join with /room join <name> <PIN>.

   ★ This room becomes Primary (the room you write to)
   📡 Live / 🔒 Private ON (follow the private field in the response)

   Team memory settings:
   <dream_summary>
   ```

Options:
- `--quiet`: Private ON from the moment you join (local mode)
- `--dream-mine=...`: Mine trigger (every_stop / threshold / manual_only)
- `--dream-threshold=N`: Number of Stop events when using threshold
- `--dream-silent=on|off`: 72h silent merge ON/OFF

※ `--keep session|ttl|permanent` is planned for a future release

### `/room join [name] [pin] [--quiet]` — Join a room

When called with no arguments:
1. Fetch the list of rooms on the LAN with `GET $BASE_URL/room/discover`.
2. Display the list:
   ```
   📡 Rooms on the LAN:
   • <room_name> (hosted by <identity>, <N> members)

   Join with /room join <name> <PIN>
   ```

When called with arguments:
1. Send `{ "name": "<name>", "pin": "<pin>", "quiet": false }` to `POST $BASE_URL/room/join` (set `true` when `--quiet` is used).
2. On success, display according to the `role` in the response:
   - `role: "primary"` (first room):
     ```
     ✅ Joined '<name>'
     ★ This room becomes Primary (the room you write to)
     Receiving whiteboard content...
     ```
   - `role: "watch"` (second room and beyond):
     ```
     ✅ Joined '<name>' as Watch (read-only)
     Switch Primary with /room switch <name> to write
     ```

### `/room leave` — Leave a room

1. Fetch the room list with `GET $BASE_URL/status`.
2. If you are the host and other members are connected:
   "Guests are connected. [Hand off and leave / Close room for everyone]"
3. Send `{ "room_id": "<id>" }` to `POST $BASE_URL/leave`.
4. On success: "Left the room."

### `/room pending` — List files awaiting approval

Display files received for sharing that have not yet been approved.

1. Fetch `GET $BASE_URL/room/pending`.
2. Display in the following format:
   ```
   📥 Files awaiting approval:
     [<id>] <type>: <filename>
             from: <sender>
             save path: <save_path (full path)>
   ```
   If the list is empty: "No files awaiting approval"

### `/room accept <id>` — Approve a shared file

Accept a pending file and write it to the specified save path.

1. Send the following to `POST $BASE_URL/room/accept`:
   ```json
   { "pending_id": "<id>" }
   ```
2. On success:
   ```
   ✅ Approved <filename>
   Save path: <save_path (full path)>
   ```
   For `claude_md` type: "Saved as room-scoped. Run /room adopt to add it globally"

### `/room reject <id>` — Reject a shared file

Discard a pending file.

1. Send the following to `POST $BASE_URL/room/reject`:
   ```json
   { "pending_id": "<id>" }
   ```
2. On success: "🗑 Discarded <id>"

### `/room adopt` — Promote room-scoped CLAUDE.md to global

Append the current room's CLAUDE.md to `~/.claude/CLAUDE.md`.

1. Fetch the current room_id with `GET $BASE_URL/status`.
2. Send the following to `POST $BASE_URL/room/adopt`:
   ```json
   { "room_id": "<room_id>" }
   ```
3. On success:
   ```
   ✅ Appended room-scoped CLAUDE.md to ~/.claude/CLAUDE.md
   Path: <path>
   ```

### `/room notify on` / `/room notify off` — Toggle notifications

Enable or disable OS notifications for yourself. Settings are persisted in `~/.cc-room/config.yaml`.

1. Send the following to `POST $BASE_URL/notify/toggle`:
   - For `on`: `{ "enabled": true }`
   - For `off`: `{ "enabled": false }`
2. On success:
   - `on`: "🔔 Notifications enabled"
   - `off`: "🔕 Notifications disabled"

### `/room switch <name>` — Switch Primary (the room you write to)

Switch the room targeted for summaries, artifacts, and Dream. The previous Primary is demoted to Watch.

1. Send the following to `POST $BASE_URL/room/switch`:
   ```json
   { "name": "<name>" }
   ```
2. On success:
   ```
   ★ Primary: <name> (previous Primary is now Watch)
   ```
3. On failure (room name not joined): "Room '<name>' not found"

```bash
curl -s -X POST "$BASE_URL/room/switch" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"<name>\"}" | python3 -m json.tool
```

### `/room status` — Check Primary / Private / team memory settings

List each room's role (Primary/Watch), Private state, and effective dream settings.

1. Fetch `GET $BASE_URL/status`.
2. Display in the following format:

   ```
   Primary: <primary_room_name>  📡 Live / 🔒 Private ON

     ★ auth-feature (primary)
       mine: threshold (every 20 sessions) / silent ON / Mine only when live
     👀 side-project (watch)
       mine: every_stop / silent OFF / Mine only when live
   ```

   `rooms[].dream` is the effective configuration (global default + room override resolved). Key fields:
   - `mine_trigger` — `every_stop` / `threshold` / `manual_only`
   - `session_threshold` — number of Stop events when using threshold
   - `silent_merge` — 72h silent merge ON/OFF
   - `require_show_on` — Mine only when live

   Example implementation:
   ```bash
   curl -s "$BASE_URL/status" | python3 -c '
import sys, json
d = json.load(sys.stdin)
if not d.get("rooms"):
    print("Not joined to any room")
    sys.exit(0)
primary = d.get("primary_room_name") or "(unset — /room switch <name>)"
priv = "🔒 Private ON" if d.get("private") else "📡 Live"
print(f"Primary: {primary}  {priv}\n")

def dream_line(cfg):
    if not cfg:
        return ""
    mine = cfg.get("mine_trigger", "?")
    if mine == "threshold":
        threshold = cfg.get("session_threshold", "?")
        mine = f"threshold (every {threshold} sessions)"
    silent = "ON" if cfg.get("silent_merge") else "OFF"
    show_req = "Mine only when live" if cfg.get("require_show_on") else "Mine always"
    return f"       mine: {mine} / silent {silent} / {show_req}"

for r in d.get("rooms", []):
    mark = "★" if r.get("role") == "primary" else "👀"
    print(f"  {mark} {r[\"name\"]} ({r.get(\"role\", \"watch\")})")
    line = dream_line(r.get("dream"))
    if line:
        print(line)
'
   ```

### `@name <message>` / `@here <message>` / `@all <message>` — Mention teammates

When you send a message starting with `@` in the normal Claude Code input field, it reaches humans—not Claude. **This is not a command for Claude; the user types it directly.**

| Syntax | Recipients |
|---|---|
| `@akira JWT is done` | Only akira |
| `@here Anyone up for lunch?` | All members who are live (Private OFF)—everyone here right now |
| `@all Deploy is complete` | Everyone in the room (regardless of Private ON/OFF) |

For everyday chat, `@here` feels natural. Use `@all` for urgent interruptions since it reaches everyone forcefully.

**Internal behavior (handled by the UserPromptSubmit Hook)**:
1. Detect the `@` prefix
2. Match against the room member list:
   - `@name` → send mention only if the member exists. Unknown names (`@dataclass`, etc.) are passed to Claude as normal input
   - `@here` / `@all` → reserved words, so mention is always sent
   - Case-insensitive (`@Akira` = `@akira`)
3. Determine `context_summary` based on your public state:
   - Live (Primary and Private OFF) → include the latest summary as `context_summary`
   - Private ON or Watch room → omit `context_summary`
4. Send a `mention` message to the destination daemon over WebSocket
5. The prompt is still passed to Claude as-is (Claude can interpret the text with `@name`)

**On the receiving side**:
- Mentions are appended to `mentions.jsonl`
- The status line shows `📬 N`
- The next time you talk to Claude, a banner is inserted at the top of the prompt inside `<cc-room-context>` tags and marked as read at that point

To check unread mentions right now:
1. Fetch the unread mention list with `GET $BASE_URL/unread`.
2. Display in the following format:
   ```
   📬 Unread mentions (<N>):
     [<time>] <from>: <content>
              context: <context_summary>  ← shown only when the sender was live (Private OFF)
   ```
   If none: "📭 No unread mentions"

### `/room remember <content>` — Post a sticky note (team memory)

Share to team memory immediately (always delivered instantly regardless of Private state). From v0.1 onward, generates `.md` files under `room-memory/` and updates the `MEMORY.md` index. Currently appends to `memory.md` (backward compatible).

1. Send `{ "content": "<content>" }` to `POST $BASE_URL/memory`.
2. Display the `message` field from the response to the user as-is (confirmation message with count).

### `/room dream` — Team memory (auto-organize, propose, merge)

Refer to this as **"team memory"** with users—not "Dream". Operate it via subcommands.

#### `/room dream status` — Check settings and pending proposals

1. Fetch effective settings with `GET $BASE_URL/dream/config` (add `?room_id=` if needed).
2. Fetch your pending proposals with `GET $BASE_URL/dream/pending`.
3. Display in the following format:

   ```
   📋 Team memory settings (<room_name>):
   mine_trigger: threshold (every 20 sessions)
   silent_merge: ON (72h objection window)
   require_show_on: ON (Mine only when live)

   Your pending proposals: <N>
     1. [decision] Shorten JWT TTL to 1 day (deadline: <objection_deadline>)
     2. ...
   ```

#### `/room dream objection [number|slug]` — Hold your proposal (stop merge)

1. With no argument: if there is exactly one pending proposal, use it; if multiple, show the list and ask the user to choose.
2. Specify number `N` or `slug`.
3. Send to `POST $BASE_URL/dream/objection`:
   ```json
   { "proposal_slug": "<slug>", "reason": "まだ早い" }
   ```
4. Display the `message` from the response (e.g., ⏸ Proposal held).

#### `/room dream hold [number|slug]` — Extend the objection deadline by 72h

1. Identify the target proposal (same as status).
2. Send `{ "proposal_slug": "<slug>" }` to `POST $BASE_URL/dream/hold`.
3. Display the `message` from the response.

#### `/room dream revert` — Undo the most recent silent merge

1. Send `{}` or `{ "room_id": "<id>" }` to `POST $BASE_URL/dream/revert`.
2. Display the `message` from the response (only the most recent merge within 72h).

#### `/room dream mine` — Manually extract knowledge candidates (v0.2 manual accept flow)

Extract candidates from the recent session; the user selects items to apply immediately (no silent merge).

1. Run `POST $BASE_URL/dream`.
2. Display `candidates` from the response as a numbered list.
3. After choosing items to adopt, send `POST $BASE_URL/dream/accept` with `{ "indices": [0, 2] }` (use `{}` for all).
4. Display the `message` from the response.

MCP: detailed search `room_memory_search(query)`, L2 source `room_memory_trace(entry_name)`.

### `/room config dream [key=value ...]` — Room Mine/merge settings (host only)

Change dream settings for the Primary room. Non-hosts receive an error.

1. Display current values with `GET $BASE_URL/dream/config`.
2. If changes are requested, send a patch to `POST $BASE_URL/dream/config`:

   | User input | JSON field | Value |
   |---|---|---|
   | `mine=every_stop` | `mine_trigger` | `every_stop` |
   | `mine=threshold` | `mine_trigger` | `threshold` |
   | `mine=manual` | `mine_trigger` | `manual_only` |
   | `threshold=10` | `session_threshold` | `10` |
   | `silent=on` | `silent_merge` | `true` |
   | `silent=off` | `silent_merge` | `false` |
   | `public=on` | `require_show_on` | `true` (Mine only when live) |
   | `public=off` | `require_show_on` | `false` (Mine always) |

   Example: `POST $BASE_URL/dream/config` `{ "mine_trigger": "every_stop", "silent_merge": false }`

3. Display `summary` and `message` from the response.

**Example dialogue:**

```
Current settings (auth-feature):
  mine_trigger: threshold (every 20 sessions)
  silent_merge: ON (72h objection window)
  require_show_on: ON (Mine only when live)

/room config dream mine=every_stop
→ ✅ Updated team memory settings for auth-feature
```

## Error handling

- If the daemon is not running:
  "cc-room daemon is not running. Start `cc-room-daemon`."
