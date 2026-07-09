import { createChildLogger } from "../logger.js";

const log = createChildLogger("hook:session-stop");

interface HookInput {
  session_id?: string;
  cwd?: string;
}

async function postJson(port: number, path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(2000),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return res.json();
}

export async function handleSessionStop(daemonHttpPort: number): Promise<void> {
  let input = "";
  if (!process.stdin.isTTY) {
    for await (const chunk of process.stdin) {
      input += chunk;
    }
  }

  let hookData: HookInput = {};
  if (input.trim()) {
    try {
      hookData = JSON.parse(input) as HookInput;
    } catch {
      log.warn("session-stop: stdin JSON のパースに失敗");
    }
  }

  const sessionId =
    hookData.session_id?.trim() || process.env.CC_ROOM_SESSION_ID?.trim();
  if (!sessionId) {
    log.info("session-stop: session_id なし、スキップ");
    return;
  }

  try {
    const result = (await postJson(daemonHttpPort, "/dream/queue", {
      session_id: sessionId,
      cwd: hookData.cwd ?? "",
      ts: new Date().toISOString(),
    })) as { queued?: boolean; reason?: string };
    log.info({ sessionId, ...result }, "session-stop → /dream/queue");
  } catch (err) {
    log.warn({ err, sessionId }, "session-stop: /dream/queue 失敗");
  }
}
