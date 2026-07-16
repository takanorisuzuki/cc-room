---
name: show
description: Explicit whiteboard posts and sharing of skills, commands, or CLAUDE.md. Use /private for local/public toggle.
---

Write explicitly to the room whiteboard. **Use `/private` to toggle local/public** (the old `/show` toggle is removed).

## Resolve the port

Before every HTTP request, resolve the port:

```bash
CC_ROOM_HOME="${CC_ROOM_HOME:-$HOME/.cc-room}"
HTTP_PORT=$(grep 'http_port:' "$CC_ROOM_HOME/config.yaml" 2>/dev/null | awk '{print $2}' | tr -d '[:space:]')
HTTP_PORT="${HTTP_PORT:-7332}"
BASE_URL="http://127.0.0.1:$HTTP_PORT"
```

## Subcommands

### `/show` (no args) — deprecated

The old toggle is removed. Guide the user:

```
Use /private to toggle local/public:
  /private on   — local mode (hide work)
  /private off  — back to public (choose share/drop for pending work)
To post a message, use /show "message".
```

### `/show <message>` — post a message

Post to the **Primary** room whiteboard.

1. Check `private` via `GET $BASE_URL/status`.
2. If Private ON, always confirm with the user:
   "You are in local mode. This message will be posted to Primary (<primary_room_name>). Send it?"
   → Continue only if they accept.
3. `POST $BASE_URL/share` with:
   ```json
   { "message": "<message>" }
   ```
   (Posted to Primary only.)
4. On success:
   ```
   📡 [<room_name>] <message>
   ```

### `/show skill <name>` — share a skill

Share your skill file with everyone in the room (recipients must accept).

1. Resolve the port (above).
2. Load the skill file:
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
     echo "Error: skill '$SKILL_NAME' not found"
     exit 1
   fi
   SKILL_CONTENT=$(cat "$SKILL_FILE")
   ```
3. `POST $BASE_URL/show/file` with:
   ```json
   { "share_type": "skill", "filename": "<name>.md", "content": "<file_content>" }
   ```
4. On success:
   ```
   📤 Shared skill '<name>' (recipients must approve with /room accept)
   ```

### `/show command <name>` — share a command

Share your command file with everyone in the room (recipients must accept).

1. Resolve the port (above).
2. Load the command file:
   ```bash
   CMD_NAME="<name>"
   CMD_BASE="${CMD_NAME%.md}"
   CMD_FILE=""
   for dir in "$HOME/.claude/commands"; do
     if [ -f "$dir/$CMD_BASE.md" ]; then CMD_FILE="$dir/$CMD_BASE.md"; break; fi
   done
   if [ -z "$CMD_FILE" ]; then
     echo "Error: command '$CMD_NAME' not found"
     exit 1
   fi
   CMD_CONTENT=$(cat "$CMD_FILE")
   ```
3. `POST $BASE_URL/show/file` with:
   ```json
   { "share_type": "command", "filename": "<name>.md", "content": "<file_content>" }
   ```
4. On success:
   ```
   📤 Shared command '<name>' (recipients must approve with /room accept)
   ```

### `/show claude-md` — share CLAUDE.md

Share this project's CLAUDE.md with the room (after accept it is saved room-scoped; promote globally with `/room adopt`).

1. Resolve the port (above).
2. Load CLAUDE.md from the current directory:
   ```bash
   CLAUDE_MD_FILE="$(pwd)/CLAUDE.md"
   if [ ! -f "$CLAUDE_MD_FILE" ]; then
     GIT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
     if [ -n "$GIT_ROOT" ] && [ -f "$GIT_ROOT/CLAUDE.md" ]; then
       CLAUDE_MD_FILE="$GIT_ROOT/CLAUDE.md"
     else
       echo "Error: CLAUDE.md not found"
       exit 1
     fi
   fi
   CLAUDE_MD_CONTENT=$(cat "$CLAUDE_MD_FILE")
   ```
3. `POST $BASE_URL/show/file` with:
   ```json
   { "share_type": "claude_md", "filename": "CLAUDE.md", "content": "<file_content>" }
   ```
4. On success:
   ```
   📤 Shared CLAUDE.md (recipients approve with /room accept; saved room-scoped)
   Use /room adopt to promote to ~/.claude/CLAUDE.md
   ```

## Errors

- If the daemon is not running:
  "cc-room daemon is not running."
- If not in a room:
  "You are not in a room. Use `/room open` or `/room join` first."
- If there is no Primary room:
  "Pick a room to write with `/room switch <name>`."
