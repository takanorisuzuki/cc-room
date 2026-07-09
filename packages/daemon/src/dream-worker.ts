import { join } from "node:path";
import type { DreamGlobalConfig, RoomMeta } from "@cc-room/shared";
import { createChildLogger } from "./logger.js";
import { resolveDreamConfig } from "./dream-config.js";
import type { DreamMiner } from "./dream-miner.js";
import type { DreamQueueJob, DreamQueueService } from "./dream-queue.js";
import { shouldPromoteToTeam } from "./dream-promotion.js";
import {
  buildAutoMemoryMarkdown,
  buildProposalMarkdown,
  buildTraceEntries,
  objectionDeadlineIso,
  pickSourceTurns,
  slugForCandidate,
  writeAutoMemoryEntry,
  writeProposalEntry,
  writeTraceFile,
} from "./dream-proposals.js";
import {
  encodeProjectDir,
  readRecentSessionTranscripts,
  readSessionTranscriptById,
} from "./session-reader.js";
import type { ShowStateManager } from "./show-state.js";
import type { DreamPendingMergeService } from "./dream-pending-merges.js";

const log = createChildLogger("dream-worker");

export interface DreamWorkerDeps {
  identity: string;
  claudeProjectsDir: string;
  roomsDir: string;
  globalDream?: DreamGlobalConfig;
  queue: DreamQueueService;
  showState: ShowStateManager;
  miner: DreamMiner;
  getRoom: (roomId: string) => RoomMeta | undefined;
  roomMemoryDir: (roomId: string) => string;
  memberAutoMemoryDir: (roomId: string, identity: string) => string;
  listProposalSlugs: (roomId: string) => Set<string>;
  listRoomMemorySlugs: (roomId: string) => Set<string>;
  readRoomMemoryIndex: (roomId: string) => string | null;
  pendingMergeService?: DreamPendingMergeService;
  onProposalsCreated?: (info: {
    roomId: string;
    roomName: string;
    count: number;
    slugs: string[];
  }) => void;
}

export class DreamWorker {
  private processing = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly deps: DreamWorkerDeps) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.drain();
    }, 500);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  notify(): void {
    void this.drain();
  }

  async drain(): Promise<void> {
    if (this.processing) return;
    const job = this.deps.queue.dequeue();
    if (!job) return;
    this.processing = true;
    try {
      await this.processJob(job);
    } catch (err) {
      log.error({ err, job }, "Dream job failed");
    } finally {
      this.processing = false;
      if (this.deps.queue.hasPending()) {
        void this.drain();
      }
    }
  }

  private async processJob(job: DreamQueueJob): Promise<void> {
    const room = this.deps.getRoom(job.room_id);
    if (!room) {
      log.warn({ roomId: job.room_id }, "Dream job: room not found");
      return;
    }

    const config = resolveDreamConfig(this.deps.globalDream, room.dream);
    if (config.require_show_on && !this.deps.showState.isPublic(room.id)) {
      log.info({ roomId: room.id }, "Dream job skipped: 非公開（Private ON or Watch）");
      return;
    }

    let transcript =
      readSessionTranscriptById(this.deps.claudeProjectsDir, job.session_id, job.cwd) ??
      null;
    if (!transcript && job.cwd) {
      const projectDir = join(this.deps.claudeProjectsDir, encodeProjectDir(job.cwd));
      const recent = readRecentSessionTranscripts(projectDir);
      if (recent.length > 0) {
        transcript = recent[0];
        log.warn(
          { sessionId: job.session_id, cwd: job.cwd },
          "session jsonl not found by id; using recent transcript from cwd project only",
        );
      }
    }
    if (!transcript) {
      log.info(
        { sessionId: job.session_id, cwd: job.cwd },
        "Dream job: no transcript (skipped to avoid cross-project leak)",
      );
      return;
    }

    const indexContent = this.deps.readRoomMemoryIndex(room.id);

    const candidates = await this.deps.miner.mine([transcript], indexContent);
    const filtered = candidates.filter((c) => c.confidence >= config.min_confidence);

    if (filtered.length === 0) {
      log.info({ sessionId: job.session_id, roomId: room.id }, "Dream job: no candidates");
      return;
    }

    const roomMemoryDir = this.deps.roomMemoryDir(room.id);
    const proposalsDir = join(roomMemoryDir, "_proposals");
    const tracesDir = join(roomMemoryDir, "traces");
    const autoMemoryDir = this.deps.memberAutoMemoryDir(room.id, this.deps.identity);
    const existingSlugs = new Set([
      ...this.deps.listRoomMemorySlugs(room.id),
      ...this.deps.listProposalSlugs(room.id),
    ]);
    const objectionDeadline = objectionDeadlineIso(config.objection_window_hours);

    const createdSlugs: string[] = [];
    for (const candidate of filtered) {
      const slug = slugForCandidate(candidate, existingSlugs);
      existingSlugs.add(slug);
      const content = `${candidate.title}\n\n${candidate.body}`;
      const description = candidate.title;
      const sourceTurns = pickSourceTurns(candidate, transcript.turns);
      const promotion = shouldPromoteToTeam({
        category: candidate.category,
        body: candidate.body,
        confidence: candidate.confidence,
      });

      writeAutoMemoryEntry(
        autoMemoryDir,
        slug,
        buildAutoMemoryMarkdown({
          slug,
          description,
          content,
          category: candidate.category,
          owner: this.deps.identity,
          sessionId: job.session_id,
          sourceTurns,
          confidence: candidate.confidence,
        }),
      );

      const traceEntries = buildTraceEntries(job.session_id, sourceTurns, transcript.turns);
      writeTraceFile(tracesDir, slug, traceEntries);

      if (promotion.promote === false) continue;

      const proposalFile = writeProposalEntry(
        proposalsDir,
        slug,
        buildProposalMarkdown({
          slug,
          description,
          content,
          category: candidate.category,
          proposedBy: this.deps.identity,
          sessionId: job.session_id,
          sourceTurns,
          confidence: candidate.confidence,
          promotion,
          objectionDeadline,
          action: candidate.action,
        }),
      );
      createdSlugs.push(slug);

      if (
        config.silent_merge &&
        promotion.silentMergeEligible &&
        this.deps.pendingMergeService
      ) {
        this.deps.pendingMergeService.registerPendingMerge({
          roomId: room.id,
          proposalSlug: slug,
          proposalFile,
          targetSlug: slug,
          action: candidate.action,
          proposedBy: this.deps.identity,
          objectionDeadline,
          silentMergeEligible: true,
        });
      }
    }

    if (createdSlugs.length > 0 && this.deps.onProposalsCreated) {
      this.deps.onProposalsCreated({
        roomId: room.id,
        roomName: room.name,
        count: createdSlugs.length,
        slugs: createdSlugs,
      });
    }

    log.info(
      {
        sessionId: job.session_id,
        roomId: room.id,
        candidates: filtered.length,
        proposals: createdSlugs.length,
      },
      "Dream job completed",
    );
  }
}
