import type { DreamPendingProposal } from "@cc-room/shared";
import { createChildLogger } from "../logger.js";

const log = createChildLogger("hook:user-prompt-submit");

const BANNER_MAX_ITEMS = 5;
const RESERVED_MENTIONS = new Set(["here", "all"]);

interface HookInput {
  prompt?: string;
  session_id?: string;
}

interface StatusResponse {
  identity: string;
  private: boolean;
  rooms: Array<{ id: string; name: string; members: string[]; connected: string[] }>;
}

interface UnreadResponse {
  total: number;
  rooms: Array<{
    room_id: string;
    room_name: string;
    mentions: Array<{
      id: string;
      from: string;
      to: string;
      content: string;
      ts: string;
      context_summary?: string;
    }>;
  }>;
}

interface MemoryInjectResponse {
  inject: string;
}

interface DreamPendingResponse {
  total: number;
  proposals: DreamPendingProposal[];
}

function writeResponse(additionalContext: string): void {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext,
    },
  }));
}

export async function handleUserPromptSubmit(
  daemonHttpPort: number,
): Promise<void> {
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
  }

  const emptyResponse = JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: "" } });

  let hookData: HookInput;
  try {
    hookData = JSON.parse(input) as HookInput;
  } catch {
    log.error("Failed to parse hook input");
    process.stdout.write(emptyResponse);
    return;
  }

  const prompt = hookData.prompt ?? "";
  const sessionId = hookData.session_id ?? "";
  const baseUrl = `http://127.0.0.1:${daemonHttpPort}`;

  // @メンション検出（行頭の @name/@here/@all のみ対象）
  const mentionMatch = prompt.match(/^@([a-zA-Z0-9._-]+)\s+([\s\S]+)$/);
  const mentionTarget = mentionMatch?.[1];
  const mentionContent = mentionMatch?.[2]?.trim();

  let status: StatusResponse | null = null;
  let unread: UnreadResponse | null = null;
  let dreamPending: DreamPendingResponse | null = null;
  let memoryInject = "";
  try {
    const [statusRes, unreadRes, dreamPendingRes, memoryRes] = await Promise.all([
      fetch(`${baseUrl}/status`, { signal: AbortSignal.timeout(2000) }),
      fetch(`${baseUrl}/unread`, { signal: AbortSignal.timeout(2000) }),
      fetch(`${baseUrl}/dream/pending`, { signal: AbortSignal.timeout(2000) }),
      sessionId
        ? fetch(`${baseUrl}/memory/inject?session_id=${encodeURIComponent(sessionId)}`, {
            signal: AbortSignal.timeout(2000),
          }).catch(() => null)
        : Promise.resolve(null),
    ]);
    if (statusRes.ok) status = await statusRes.json() as StatusResponse;
    if (unreadRes.ok) unread = await unreadRes.json() as UnreadResponse;
    if (dreamPendingRes.ok) {
      dreamPending = await dreamPendingRes.json() as DreamPendingResponse;
    }
    if (memoryRes?.ok) {
      const data = await memoryRes.json() as MemoryInjectResponse;
      memoryInject = data.inject ?? "";
    }
  } catch {
    log.warn("Could not reach daemon — skipping hook");
    process.stdout.write(emptyResponse);
    return;
  }

  if (!status) {
    process.stdout.write(emptyResponse);
    return;
  }

  // @メンション送信
  if (mentionTarget && mentionContent) {
    const isReserved = RESERVED_MENTIONS.has(mentionTarget);
    const members = status.rooms.flatMap((r) => r.members);
    const isKnownMember = members.includes(mentionTarget);

    if (isReserved || isKnownMember) {
      try {
        await fetch(`${baseUrl}/mention`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ to: mentionTarget, content: mentionContent }),
        });
        log.info({ to: mentionTarget }, "@メンションを送信");
      } catch (err) {
        log.error({ err }, "Failed to send mention");
      }
    }
  }

  const contextParts: string[] = [];
  if (memoryInject) contextParts.push(memoryInject);

  if (unread && unread.total > 0) {
    const allMentions = unread.rooms.flatMap((r) => r.mentions.map((m) => ({ ...m, room_name: r.room_name })));
    const items = allMentions.slice(0, BANNER_MAX_ITEMS);
    const allIds = items.map((m) => m.id);
    const bannerLines: string[] = [];

    for (const m of items) {
      bannerLines.push(`[${m.room_name}] @${m.from}: ${m.content}`);
      if (m.context_summary) {
        bannerLines.push(`  作業状況: ${m.context_summary}`);
      }
    }

    const remaining = unread.total - items.length;
    if (remaining > 0) {
      bannerLines.push(`... 他 ${remaining} 件`);
    }

    contextParts.push(
      `<cc-room-context>\n未読メンション ${items.length} 件:\n${bannerLines.join("\n")}\n</cc-room-context>`,
    );

    await fetch(`${baseUrl}/unread/mark-read`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: allIds }),
      signal: AbortSignal.timeout(2000),
    }).catch(() => {});
  }

  if (dreamPending && dreamPending.total > 0) {
    const items = dreamPending.proposals.slice(0, BANNER_MAX_ITEMS);
    const previewRoom = items[0].room_name;
    const nearestDeadline = items[0].objection_deadline;
    const hoursLeft = Math.max(
      0,
      Math.round((new Date(nearestDeadline).getTime() - Date.now()) / 3_600_000),
    );
    const lines = items.map(
      (p, i) => `  ${i + 1}. [${p.category}] ${p.description}`,
    );
    const remaining = dreamPending.total - items.length;
    if (remaining > 0) {
      lines.push(`  ... 他 ${remaining} 件`);
    }
    contextParts.push(
      `<cc-room-dream-pending>\n` +
        `📋 あなたの作業から ${dreamPending.total} 件がチームへの提案として保留中です（${previewRoom}）:\n` +
        `${lines.join("\n")}\n\n` +
        `異議がある場合: /room dream objection\n` +
        `今すぐ反映を止めたい場合: /room dream hold\n` +
        `（残り約 ${hoursLeft}h 以内に異議がなければチームメモリに自動反映されます）\n` +
        `</cc-room-dream-pending>`,
    );
  }

  if (contextParts.length === 0) {
    process.stdout.write(emptyResponse);
    return;
  }

  writeResponse(contextParts.join("\n\n"));
}
