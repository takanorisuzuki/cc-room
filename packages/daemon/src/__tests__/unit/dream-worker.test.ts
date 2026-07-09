import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  existsSync,
  readdirSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DreamWorker } from "../../dream-worker.js";
import { DreamQueueService } from "../../dream-queue.js";
import { ShowStateManager } from "../../show-state.js";
import type { DreamCandidate } from "../../dream-miner.js";
import type { RoomMeta } from "@cc-room/shared";
import { encodeProjectDir } from "../../session-reader.js";

describe("DreamWorker", () => {
  let tmp: string;
  let projectsDir: string;
  let roomsDir: string;
  let showState: ShowStateManager;
  const room: RoomMeta = {
    id: "room-1",
    name: "auth",
    secret: "s",
    members: ["alice"],
    created_at: new Date().toISOString(),
    dream: { mine_trigger: "every_stop", require_show_on: false },
  };

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "cc-room-worker-"));
    projectsDir = join(tmp, "projects");
    roomsDir = join(tmp, "rooms");
    const cwd = "/tmp/work";
    const sessionId = "sess-worker-1";
    const proj = join(projectsDir, encodeProjectDir(cwd));
    mkdirSync(proj, { recursive: true });
    writeFileSync(
      join(proj, `${sessionId}.jsonl`),
      '{"type":"user","message":"JWT TTL を src/auth.ts で 1 日に決めた"}\n',
    );
    showState = new ShowStateManager(join(tmp, "show-state.json"));
    showState.onRoomJoin(room.id, { asPrimary: true });
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("writes auto-memory, proposals, and traces", async () => {
    const queue = new DreamQueueService({
      identity: "alice",
      roomsDir,
      listRooms: () => [room],
      showState,
      globalDream: { mine_trigger: "every_stop", require_show_on: false },
    });

    const worker = new DreamWorker({
      identity: "alice",
      claudeProjectsDir: projectsDir,
      roomsDir,
      queue,
      showState,
      getRoom: (id) => (id === room.id ? room : undefined),
      roomMemoryDir: (id) => join(roomsDir, id, "room-memory"),
      memberAutoMemoryDir: (id, who) => join(roomsDir, id, "members", who, "auto-memory"),
      listProposalSlugs: () => new Set(),
      listRoomMemorySlugs: () => new Set(),
      readRoomMemoryIndex: () => null,
      miner: {
        mine: async () =>
          [
            {
              id: "c1",
              category: "decision",
              title: "JWT TTL 1日",
              body: "src/auth.ts の JWT TTL を 1 日に統一する方針",
              confidence: 0.85,
              action: "create",
            },
          ] satisfies DreamCandidate[],
      },
    });

    queue.enqueue({ session_id: "sess-worker-1", cwd: "/tmp/work" });
    await worker.drain();

    const autoDir = join(roomsDir, room.id, "members", "alice", "auto-memory");
    expect(existsSync(join(autoDir, "MEMORY.md"))).toBe(true);
    const autoMd = readdirSync(autoDir).find((f) => f.endsWith(".md") && f !== "MEMORY.md");
    expect(autoMd).toBeTruthy();
    expect(readFileSync(join(autoDir, autoMd!), "utf-8")).toContain("category: decision");

    const proposalsDir = join(roomsDir, room.id, "room-memory", "_proposals");
    const proposalFiles = readdirSync(proposalsDir);
    expect(proposalFiles.length).toBe(1);
    expect(readFileSync(join(proposalsDir, proposalFiles[0]!), "utf-8")).toContain("team-proposal");

    const slug = autoMd!.replace(/\.md$/, "");
    const tracePath = join(roomsDir, room.id, "room-memory", "traces", `${slug}.jsonl`);
    expect(existsSync(tracePath)).toBe(true);
    const traceLine = readFileSync(tracePath, "utf-8").trim();
    expect(JSON.parse(traceLine).session_id).toBe("sess-worker-1");
  });
});
