import type {
  DreamGlobalConfig,
  DreamRoomConfig,
  EffectiveDreamConfig,
  MineTrigger,
} from "@cc-room/shared";

export const DEFAULT_DREAM_CONFIG: EffectiveDreamConfig = {
  mine_trigger: "threshold",
  session_threshold: 20,
  require_show_on: true,
  silent_merge: true,
  objection_window_hours: 72,
  min_confidence: 0.7,
  max_mine_per_day: 10,
  mine_cooldown_minutes: 30,
  auto_consolidate: true,
};

export function resolveDreamConfig(
  global: DreamGlobalConfig | undefined,
  room: DreamRoomConfig | undefined,
): EffectiveDreamConfig {
  const merged = { ...DEFAULT_DREAM_CONFIG, ...global, ...room };
  return {
    mine_trigger: merged.mine_trigger as MineTrigger,
    session_threshold: merged.session_threshold ?? DEFAULT_DREAM_CONFIG.session_threshold,
    require_show_on: merged.require_show_on ?? DEFAULT_DREAM_CONFIG.require_show_on,
    silent_merge: merged.silent_merge ?? DEFAULT_DREAM_CONFIG.silent_merge,
    objection_window_hours:
      merged.objection_window_hours ?? DEFAULT_DREAM_CONFIG.objection_window_hours,
    min_confidence: merged.min_confidence ?? DEFAULT_DREAM_CONFIG.min_confidence,
    max_mine_per_day: merged.max_mine_per_day ?? DEFAULT_DREAM_CONFIG.max_mine_per_day,
    mine_cooldown_minutes:
      merged.mine_cooldown_minutes ?? DEFAULT_DREAM_CONFIG.mine_cooldown_minutes,
    auto_consolidate: merged.auto_consolidate ?? DEFAULT_DREAM_CONFIG.auto_consolidate,
  };
}

function parseBoolField(value: unknown, field: string): boolean {
  if (typeof value === "boolean") return value;
  if (value === "on" || value === "true" || value === 1 || value === "1") return true;
  if (value === "off" || value === "false" || value === 0 || value === "0") return false;
  throw new Error(`${field} must be boolean or on/off`);
}

function parsePositiveInt(value: unknown, field: string): number {
  if (typeof value !== "number" && !(typeof value === "string" && /^\d+$/.test(value))) {
    throw new Error(`${field} must be a positive integer`);
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`${field} must be a positive integer`);
  }
  return n;
}

export function sanitizeDreamRoomConfig(raw: Record<string, unknown>): DreamRoomConfig {
  const patch: DreamRoomConfig = {};
  if (raw.mine_trigger !== undefined) {
    const v = raw.mine_trigger;
    if (v !== "every_stop" && v !== "threshold" && v !== "manual_only") {
      throw new Error("mine_trigger must be every_stop, threshold, or manual_only");
    }
    patch.mine_trigger = v;
  }
  if (raw.session_threshold !== undefined) {
    patch.session_threshold = parsePositiveInt(raw.session_threshold, "session_threshold");
  }
  if (raw.require_show_on !== undefined) {
    patch.require_show_on = parseBoolField(raw.require_show_on, "require_show_on");
  }
  if (raw.silent_merge !== undefined) {
    patch.silent_merge = parseBoolField(raw.silent_merge, "silent_merge");
  }
  if (raw.objection_window_hours !== undefined) {
    patch.objection_window_hours = parsePositiveInt(raw.objection_window_hours, "objection_window_hours");
  }
  return patch;
}

export function parseDreamRoomPatch(raw: Record<string, unknown>): DreamRoomConfig {
  const patch = sanitizeDreamRoomConfig(raw);
  if (Object.keys(patch).length === 0) {
    throw new Error("更新する dream 設定がありません");
  }
  return patch;
}

export function formatDreamConfigSummary(cfg: EffectiveDreamConfig): string {
  const mine =
    cfg.mine_trigger === "threshold"
      ? `threshold (${cfg.session_threshold} セッションごと)`
      : cfg.mine_trigger;
  const silent = cfg.silent_merge
    ? `ON（${cfg.objection_window_hours}h 異議申し立て）`
    : "OFF（明示 accept のみ）";
  const show = cfg.require_show_on ? "ON（公開中のみ Mine）" : "OFF";
  return [
    `mine_trigger: ${mine}`,
    `silent_merge: ${silent}`,
    `require_show_on: ${show}`,
  ].join("\n");
}
