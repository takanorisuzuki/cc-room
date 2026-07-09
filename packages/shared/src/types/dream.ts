export type MineTrigger = "every_stop" | "threshold" | "manual_only";

/** ルーム meta.json の dream 上書き */
export interface DreamRoomConfig {
  mine_trigger?: MineTrigger;
  session_threshold?: number;
  require_show_on?: boolean;
  silent_merge?: boolean;
  objection_window_hours?: number;
}

/** ~/.cc-room/config.yaml の dream セクション */
export interface DreamGlobalConfig extends DreamRoomConfig {
  /** Mine 用モデル（summarizer.model と対称。デフォルト claude-haiku-4-5-20251001） */
  model?: string;
  min_confidence?: number;
  max_mine_per_day?: number;
  mine_cooldown_minutes?: number;
  auto_consolidate?: boolean;
  org_memory_path?: string | null;
  personal_memory_enabled?: boolean;
}

/** グローバル + ルーム上書きをマージした effective 設定 */
export interface EffectiveDreamConfig {
  mine_trigger: MineTrigger;
  session_threshold: number;
  require_show_on: boolean;
  silent_merge: boolean;
  objection_window_hours: number;
  min_confidence: number;
  max_mine_per_day: number;
  mine_cooldown_minutes: number;
  auto_consolidate: boolean;
}

export interface MemberDreamState {
  session_stops_since_last_mine: number;
  last_mine_at: string | null;
  mines_today: number;
  mines_today_date: string | null;
}

export type DreamQueueSkipReason =
  | "no_rooms"
  | "manual_only"
  | "require_show_off"
  | "threshold_not_reached"
  | "duplicate_session"
  | "max_mine_per_day"
  | "mine_cooldown";

export interface DreamQueueResult {
  queued: boolean;
  reason?: DreamQueueSkipReason;
  rooms?: string[];
  sessions_until_mine?: number;
  message?: string;
}

export type PendingMergeStatus = "proposed" | "objected" | "merged" | "reverted";

export interface PendingMergeObjection {
  by: string;
  reason?: string;
  at: string;
}

export interface PendingMergeRecord {
  id: string;
  room_id: string;
  proposal_slug: string;
  proposal_file: string;
  target_slug: string;
  action: "create" | "update";
  status: PendingMergeStatus;
  proposed_at: string;
  objection_deadline: string;
  proposed_by: string;
  objections: PendingMergeObjection[];
  merged_at: string | null;
  silent_merge_eligible: boolean;
}

export interface PendingMergesFile {
  merges: PendingMergeRecord[];
}

export interface MergeHistoryEntry {
  ts: string;
  merge_id: string;
  room_id: string;
  action: "merge" | "revert";
  slugs: string[];
  /** revert 用: slug → マージ前のファイル内容（無ければ create） */
  snapshots?: Record<string, string | null>;
}

export interface DreamPendingProposal {
  slug: string;
  description: string;
  category: string;
  room_id: string;
  room_name: string;
  status: string;
  proposed_by: string;
  proposed_at: string;
  objection_deadline: string;
  merge_id?: string;
}
