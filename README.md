# cc-room

> Bring your own Claude into a meeting room with a shared whiteboard.

Each engineer works in their own Claude Code at their own pace. While **Live** (Private OFF), summaries and artifacts appear automatically on the whiteboard (Primary room). Local work stays invisible with `/private on`. Humans can mention each other with `@name`.

```
Typical tools = “many people drive one AI” or “many AIs coordinate”
cc-room       = “each person’s AI shares a room via a whiteboard”
```

[日本語版 README](./README.ja.md)

---

## Why cc-room now?

There is **no generally available official multiplayer** for Claude Code yet.  
cc-room is an unofficial tool that uses only official extension points (Hooks / MCP / Slash Commands) so LAN teams can get a “meeting room” experience **today**.

- **Experience**: each Claude in the same room (whiteboard sync)
- **Simple**: one-command setup; no external server; nothing sent to the cloud
- **Privacy**: `/private` toggles local vs public; raw transcripts and private tool results stay out

Started as a personal experiment; published so you can try it and bring it to your team.

---

## Quick Start

```bash
npx setup-cc-room
```

Japanese UI and slash commands:

```bash
npx setup-cc-room --lang ja
# or: CC_ROOM_LANG=ja npx setup-cc-room
```

Open Claude Code, then:

```
/room open my-room          # create a room (PIN is issued)
```

Teammates on the same LAN:

```
/room join my-room <PIN>    # join
```

The whiteboard syncs automatically.

### Uninstall

```bash
npx setup-cc-room uninstall
```

Stops the daemon (launchd/systemd), removes slash commands, strips cc-room from `settings.json`, and deletes `~/.cc-room`. Restart Claude Code afterward.

From source:

```bash
git clone https://github.com/takanorisuzuki/cc-room.git
cd cc-room && pnpm install && pnpm build
pnpm --filter setup-cc-room run pack:vendor
node packages/setup/dist/index.js
# Japanese: node packages/setup/dist/index.js --lang ja
# Uninstall: node packages/setup/dist/index.js uninstall
```

---

## Usage

```
/room open auth-feature        # create a room (becomes Primary)
/room join auth-feature <PIN>  # join (2nd+ rooms default to Watch = read-only)
/room switch other-room        # switch Primary (the room you write to)
/room                          # view the whiteboard
/room remember "JWT: pattern B, TTL 3 days"   # sticky note

/private on                    # local mode (work accumulates as pending)
/private off                   # back to public (always choose share/drop if pending)

/show "TTL of 3 days may be too long"   # post to Primary
/show skill deep-research               # share a skill
/show claude-md                         # share CLAUDE.md

/room leave                    # leave
```

After joining, whiteboard content (summaries, artifacts, messages) syncs automatically.

- **Primary** — the one room you write to. Summaries, artifacts, and Dream go here
- **Watch** — read-only. Joining a second room defaults to Watch
- **Live** (Private OFF) — summaries/artifacts auto-publish to Primary
- **`/private on`** — local mode; returning always requires share (send) or drop (discard)

### @mentions (human-to-human)

Starting input with `@` sends to **people**, not as an instruction to Claude.

| Syntax | Recipients |
|---|---|
| `@akira JWT is done` | akira only |
| `@here anyone for lunch?` | everyone Live (Primary + Private OFF) |
| `@all deploy finished` | everyone in the room (regardless of Private) |

- If the sender is Live, a work summary is attached (Private ON / Watch: body only)
- Recipients see `📬 N` on the status line
- Next time they talk to Claude, unread mentions are injected as a banner so Claude sees them too
- Names not in the room (e.g. `@dataclass`) pass through as normal Claude input

---

## What is shared?

| Data | Live (Private OFF) | Private ON |
|---|---|---|
| Conversation summary (technical work) | Auto realtime (Primary only) | Pending (private) |
| Generated files (Write/Edit) | Auto realtime (Primary only) | Pending (private) |
| `/show "msg"` | Immediate | After confirm |
| `@mention` body | Recipients only (+ sender summary) | Recipients only (no summary) |
| `/room remember` notes | Immediate | Immediate |
| Raw conversation text | Never shared | Never shared |
| Private tool results | Auto-excluded | Private |

Publish requires Primary **and** Private OFF **and** passing the privacy filter. Watch rooms are never auto-written.

---

## How it works

```
Alice’s Claude Code
  └─ watch session jsonl → summarize deltas → WebSocket (LAN) →
                                                saved under Bob’s ~/.cc-room/
                                                └─ MCP tools → Bob’s Claude answers with context
```

- **LAN only**: mDNS + WebSocket; no external server; no cloud upload
- **No Claude Code forks**: Hooks / MCP / Slash Commands only
- **Own API keys**: each person calls Anthropic with their own key
- **Room auth**: name + 6-digit PIN → HMAC key via HKDF
- **Interim summaries**: after 30+ minutes Live, a summary is shared automatically

### Demo flow

```
akira: /room open auth-feature
yuki:  /room join auth-feature <PIN>
akira: “Write a JWT design doc” → design.md (auto-shared while Live)
yuki:  receives design.md → room_context() review
yuki:  /show "TTL of 3 days may be long"
akira: "@yuki how far are auth tests?"
yuki:  next turn shows a banner → Claude sees it too
```

---

## Room lifecycle

- **Stop daemon (Ctrl+C)**: leave all rooms, then exit (no leftover garbage)
- **Idle cleanup**: auto-delete a room 30s after all peers disconnect
- **Brand-new rooms**: not idle-cleaned until someone has connected

---

## Requirements

- Node.js 20+
- Claude Code
- Teammates on the same LAN (Wi‑Fi / ethernet)

### Remote use

Designed for the same LAN; a VPN that provides a shared LAN also works (e.g. Tailscale). Optional.

---

## Development

```bash
pnpm install
pnpm build
pnpm --filter setup-cc-room run pack:vendor
pnpm dev
pnpm test
```

---

## License

MIT
