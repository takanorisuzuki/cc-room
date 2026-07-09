import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import { parse, stringify } from "yaml";
import { z } from "zod";
import {
  DEFAULT_WS_PORT,
  DEFAULT_HTTP_PORT,
  MDNS_SERVICE_NAME,
  DEFAULT_MAX_STORAGE_BYTES,
  DEFAULT_ARTIFACT_TTL_DAYS,
  DEFAULT_CONTEXT_TTL_DAYS,
  DEFAULT_MESSAGE_TTL_DAYS,
} from "@cc-room/shared";

const DEFAULT_PUBLIC_TOOLS = [
  "room_context",
  "room_messages",
  "room_files",
  "room_status",
  "room_invite",
  "room_share",
];

const ConfigSchema = z.object({
  identity: z.object({
    name: z.string().min(1),
  }),
  network: z.object({
    port: z.number().int().positive().default(DEFAULT_WS_PORT),
    http_port: z.number().int().positive().default(DEFAULT_HTTP_PORT),
    mdns_service: z.string().default(MDNS_SERVICE_NAME),
  }),
  trust: z.array(z.string()).default([]),
  sessions: z.object({
    default_mode: z.enum(["approve", "open"]).default("approve"),
    share_files: z.boolean().default(true),
    share_context: z.boolean().default(true),
  }),
  privacy: z.object({
    public_tools: z.array(z.string()).default(DEFAULT_PUBLIC_TOOLS),
    private_patterns: z.array(z.string()).default([]),
    redact_after_private_tool: z.boolean().default(true),
  }),
  summarizer: z.object({
    model: z.string().default("claude-haiku-4-5-20251001"),
    interval_turns: z.number().int().positive().default(5),
    interval_seconds: z.number().int().positive().default(30),
  }),
  storage: z.object({
    max_bytes: z.number().int().positive().default(DEFAULT_MAX_STORAGE_BYTES),
    artifact_ttl_days: z
      .number()
      .int()
      .positive()
      .default(DEFAULT_ARTIFACT_TTL_DAYS),
    context_ttl_days: z
      .number()
      .int()
      .positive()
      .default(DEFAULT_CONTEXT_TTL_DAYS),
    message_ttl_days: z
      .number()
      .int()
      .positive()
      .default(DEFAULT_MESSAGE_TTL_DAYS),
  }),
  notifications: z.object({
    enabled: z.boolean().default(true),
  }).default({ enabled: true }),
  dream: z
    .object({
      model: z.string().optional(),
      mine_trigger: z.enum(["every_stop", "threshold", "manual_only"]).optional(),
      session_threshold: z.number().int().positive().optional(),
      require_show_on: z.boolean().optional(),
      silent_merge: z.boolean().optional(),
      objection_window_hours: z.number().int().positive().optional(),
      min_confidence: z.number().min(0).max(1).optional(),
      max_mine_per_day: z.number().int().positive().optional(),
      mine_cooldown_minutes: z.number().int().nonnegative().optional(),
      auto_consolidate: z.boolean().optional(),
      org_memory_path: z.string().nullable().optional(),
      personal_memory_enabled: z.boolean().optional(),
    })
    .optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

export const CC_ROOM_DIR = process.env.CC_ROOM_HOME || join(homedir(), ".cc-room");
export const CONFIG_PATH = join(CC_ROOM_DIR, "config.yaml");
export const ROOMS_DIR = join(CC_ROOM_DIR, "rooms");
export const PID_PATH = join(CC_ROOM_DIR, "daemon.pid");

function getGitUserName(): string {
  try {
    return execFileSync("git", ["config", "user.name"], { encoding: "utf-8" }).trim();
  } catch {
    return "unknown";
  }
}

function defaultConfig(): Config {
  return {
    identity: { name: getGitUserName() },
    network: {
      port: DEFAULT_WS_PORT,
      http_port: DEFAULT_HTTP_PORT,
      mdns_service: MDNS_SERVICE_NAME,
    },
    trust: [],
    sessions: {
      default_mode: "approve",
      share_files: true,
      share_context: true,
    },
    privacy: {
      public_tools: DEFAULT_PUBLIC_TOOLS,
      private_patterns: [],
      redact_after_private_tool: true,
    },
    summarizer: {
      model: "claude-haiku-4-5-20251001",
      interval_turns: 5,
      interval_seconds: 30,
    },
    storage: {
      max_bytes: DEFAULT_MAX_STORAGE_BYTES,
      artifact_ttl_days: DEFAULT_ARTIFACT_TTL_DAYS,
      context_ttl_days: DEFAULT_CONTEXT_TTL_DAYS,
      message_ttl_days: DEFAULT_MESSAGE_TTL_DAYS,
    },
    notifications: {
      enabled: true,
    },
  };
}

export function loadConfig(): Config {
  mkdirSync(CC_ROOM_DIR, { recursive: true });

  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    const parsed = parse(raw);
    return ConfigSchema.parse(parsed);
  } catch {
    const config = defaultConfig();
    writeFileSync(CONFIG_PATH, stringify(config), { mode: 0o600 });
    return config;
  }
}

export function saveNotificationsEnabled(enabled: boolean): void {
  let raw: string;
  try {
    raw = readFileSync(CONFIG_PATH, "utf-8");
  } catch {
    raw = stringify(defaultConfig());
  }
  let parsed = parse(raw);
  if (!parsed || typeof parsed !== "object") {
    parsed = {};
  }
  const parsedObj = parsed as Record<string, unknown>;
  const notifications = (parsedObj.notifications as Record<string, unknown>) ?? {};
  notifications.enabled = enabled;
  parsedObj.notifications = notifications;
  writeFileSync(CONFIG_PATH, stringify(parsedObj), { mode: 0o600 });
}
