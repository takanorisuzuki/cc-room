import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fork } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { stringify } from "yaml";
import { encodeProjectDir } from "../../session-reader.js";

/** E2E 用 daemon config。差分は overrides で渡す（privacy.public_tools、dream 等） */
export function createDaemonConfig(
  name: string,
  wsPort: number,
  httpPort: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    identity: { name },
    network: { port: wsPort, http_port: httpPort, mdns_service: "_cc-room._tcp" },
    trust: [],
    sessions: { default_mode: "open", share_files: true, share_context: true },
    privacy: {
      public_tools: ["room_context", "room_messages", "room_files", "room_status"],
      private_patterns: [],
      redact_after_private_tool: true,
    },
    summarizer: { model: "claude-haiku-4-5-20251001", interval_turns: 5, interval_seconds: 30 },
    storage: { max_bytes: 524288000, artifact_ttl_days: 30, context_ttl_days: 7, message_ttl_days: 14 },
    ...overrides,
  };
}

export function writeDaemonConfig(homeDir: string, config: Record<string, unknown>): void {
  writeFileSync(join(homeDir, "config.yaml"), stringify(config));
}

export interface StartDaemonOptions {
  claudeHome?: string;
  extraEnv?: Record<string, string>;
  /** fallbackMine を強制する（Anthropic API に出さない） */
  dropApiKey?: boolean;
}

export function startDaemon(homeDir: string, opts: StartDaemonOptions = {}): ChildProcess {
  const daemonPath = join(__dirname, "../../../dist/index.js");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CC_ROOM_HOME: homeDir,
    NODE_ENV: "test",
    ...opts.extraEnv,
  };
  if (opts.claudeHome) env.CC_CLAUDE_HOME = opts.claudeHome;
  if (opts.dropApiKey) delete env.ANTHROPIC_API_KEY;
  // "pipe" だと親が読まない限り 64KB のパイプバッファ満杯でデーモンが書き込みブロックする
  const proc = fork(daemonPath, [], { env, stdio: "ignore" });
  proc.on("error", (err) => {
    console.error(`Daemon (${homeDir}) process error:`, err);
  });
  return proc;
}

export function killDaemon(proc: ChildProcess | undefined): Promise<void> {
  return new Promise((resolve) => {
    // killed はシグナル送信済みを示すだけで終了を保証しない。終了判定は exitCode/signalCode で行う
    if (!proc || proc.exitCode !== null || proc.signalCode !== null) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      resolve();
    }, 5000);
    proc.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    if (!proc.killed) {
      proc.kill("SIGTERM");
    }
  });
}

export async function waitForHttp(port: number, maxMs = 10000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`HTTP API on port ${port} not ready after ${maxMs}ms`);
}

export async function httpGet(port: number, path: string): Promise<unknown> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json();
}

export async function httpPost(port: number, path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

export async function waitForCondition(
  fn: () => boolean | Promise<boolean>,
  maxMs = 15000,
  intervalMs = 500,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Condition not met after ${maxMs}ms`);
}

/** alice が部屋を作成し、bob が mDNS 発見 → join → WS 接続確立まで待つ */
export async function createRoomPair(
  roomName: string,
  alicePort: number,
  bobPort: number,
): Promise<{ roomId: string; pin: string }> {
  const createRes = (await httpPost(alicePort, "/room/create", { name: roomName })) as {
    room_id: string;
    pin: string;
  };

  await waitForCondition(async () => {
    const disc = (await httpGet(bobPort, "/room/discover")) as { rooms: Array<{ name: string }> };
    return disc.rooms.some((r) => r.name === roomName);
  });

  await httpPost(bobPort, "/room/join", { name: roomName, pin: createRes.pin });

  await waitForCondition(async () => {
    const status = (await httpGet(alicePort, "/status")) as {
      rooms: Array<{ connected: string[] }>;
    };
    return status.rooms.some((r) => r.connected.includes("bob"));
  });

  return { roomId: createRes.room_id, pin: createRes.pin };
}

/** SessionWatcher 向けに Claude Code 風 jsonl を書く（fallback 要約の素材） */
export function writeSessionJsonl(
  claudeHome: string,
  cwd: string,
  sessionId: string,
  userText: string,
  assistantText: string,
): string {
  const projDir = join(claudeHome, "projects", encodeProjectDir(cwd));
  mkdirSync(projDir, { recursive: true });
  const path = join(projDir, `${sessionId}.jsonl`);
  const lines = [
    JSON.stringify({ type: "user", message: userText, timestamp: new Date().toISOString() }),
    JSON.stringify({
      type: "assistant",
      message: assistantText,
      timestamp: new Date().toISOString(),
    }),
  ];
  writeFileSync(path, lines.join("\n") + "\n");
  return path;
}

/** /context に member の要約が現れるまで待つ */
export async function waitForMemberContext(
  httpPort: number,
  member: string,
  includes: string,
  maxMs = 20000,
): Promise<string> {
  let found = "";
  await waitForCondition(async () => {
    const ctx = (await httpGet(httpPort, "/context")) as Record<string, Record<string, string>>;
    for (const members of Object.values(ctx)) {
      const summary = members[member];
      if (summary && summary.includes(includes)) {
        found = summary;
        return true;
      }
    }
    return false;
  }, maxMs);
  return found;
}
