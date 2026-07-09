import type { DreamGlobalConfig, DreamQueueResult, RoomMeta } from "@cc-room/shared";
import { createChildLogger } from "./logger.js";
import { resolveDreamConfig } from "./dream-config.js";
import {
  incrementStopCount,
  memberDreamStatePath,
  readMemberDreamState,
  resetStopCountAfterMine,
  todayDateString,
  writeMemberDreamState,
} from "./dream-state.js";
import type { ShowStateManager } from "./show-state.js";

const log = createChildLogger("dream-queue");

export interface DreamQueueJob {
  session_id: string;
  cwd: string;
  ts: string;
  room_id: string;
}

export interface DreamQueueDeps {
  identity: string;
  roomsDir: string;
  globalDream?: DreamGlobalConfig;
  listRooms: () => RoomMeta[];
  showState: ShowStateManager;
}

export class DreamQueueService {
  private readonly queuedSessions = new Set<string>();
  private readonly fifo: DreamQueueJob[] = [];
  private onEnqueued?: () => void;

  constructor(private readonly deps: DreamQueueDeps) {}

  setOnEnqueued(handler: () => void): void {
    this.onEnqueued = handler;
  }

  /** テスト・デバッグ用 */
  pendingJobs(): DreamQueueJob[] {
    return [...this.fifo];
  }

  hasPending(): boolean {
    return this.fifo.length > 0;
  }

  dequeue(): DreamQueueJob | undefined {
    return this.fifo.shift();
  }

  enqueue(body: { session_id: string; cwd?: string; ts?: string }): DreamQueueResult {
    if (typeof body?.session_id !== "string") {
      throw new Error("session_id must be a string");
    }
    const sessionId = body.session_id.trim();
    if (!sessionId) {
      throw new Error("session_id is required");
    }

    const rooms = this.deps.listRooms();
    if (rooms.length === 0) {
      return { queued: false, reason: "no_rooms", message: "参加中のルームがありません" };
    }

    const primaryId = this.deps.showState.getPrimaryRoomId() ?? rooms[0]?.id;
    const primary = rooms.find((r) => r.id === primaryId) ?? rooms[0];
    if (!primary) {
      return { queued: false, reason: "no_rooms", message: "参加中のルームがありません" };
    }

    const config = resolveDreamConfig(this.deps.globalDream, primary.dream);

    if (config.mine_trigger === "manual_only") {
      return {
        queued: false,
        reason: "manual_only",
        message: "このルームは手動 Dream のみです",
      };
    }

    if (config.require_show_on && !this.deps.showState.isPublic(primary.id)) {
      return {
        queued: false,
        reason: "require_show_off",
        message: "公開中（Private OFF）のときのみ自動整理します",
      };
    }

    if (this.queuedSessions.has(sessionId)) {
      return { queued: false, reason: "duplicate_session", message: "同一セッションは既にキュー済みです" };
    }

    const statePath = memberDreamStatePath(
      this.deps.roomsDir,
      primary.id,
      this.deps.identity,
    );
    let memberState = readMemberDreamState(statePath);

    const today = todayDateString();
    if (
      memberState.mines_today_date === today &&
      memberState.mines_today >= config.max_mine_per_day
    ) {
      return {
        queued: false,
        reason: "max_mine_per_day",
        message: "本日の自動整理上限に達しました",
      };
    }

    if (memberState.last_mine_at && config.mine_cooldown_minutes > 0) {
      const elapsed =
        Date.now() - new Date(memberState.last_mine_at).getTime();
      if (elapsed < config.mine_cooldown_minutes * 60_000) {
        return {
          queued: false,
          reason: "mine_cooldown",
          message: "クールダウン中です",
        };
      }
    }

    memberState = incrementStopCount(memberState);
    writeMemberDreamState(statePath, memberState);

    if (config.mine_trigger === "threshold") {
      if (memberState.session_stops_since_last_mine < config.session_threshold) {
        const remaining =
          config.session_threshold - memberState.session_stops_since_last_mine;
        return {
          queued: false,
          reason: "threshold_not_reached",
          sessions_until_mine: remaining,
          message: `あと ${remaining} 回のセッション終了で自動整理します`,
        };
      }
    }

    const job: DreamQueueJob = {
      session_id: sessionId,
      cwd: body.cwd ?? "",
      ts: body.ts ?? new Date().toISOString(),
      room_id: primary.id,
    };
    this.fifo.push(job);
    this.queuedSessions.add(sessionId);
    writeMemberDreamState(statePath, resetStopCountAfterMine(memberState));

    log.info(
      { sessionId, roomId: primary.id, queueDepth: this.fifo.length },
      "Dream job queued",
    );

    this.onEnqueued?.();

    return {
      queued: true,
      rooms: [primary.name],
      message: "バックグラウンドで知見を整理します",
    };
  }
}
