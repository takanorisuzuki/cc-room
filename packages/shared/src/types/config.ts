import type { DreamGlobalConfig, DreamRoomConfig } from "./dream.js";

export interface PrivacyConfig {
  public_tools: string[];
  private_patterns: string[];
  redact_after_private_tool: boolean;
}

export interface CcRoomConfig {
  identity: {
    name: string;
  };
  network: {
    port: number;
    http_port: number;
    mdns_service: string;
  };
  trust: string[];
  sessions: {
    default_mode: "approve" | "open";
    share_files: boolean;
    share_context: boolean;
  };
  privacy: PrivacyConfig;
  summarizer: {
    model: string;
    interval_turns: number;
    interval_seconds: number;
  };
  storage: {
    max_bytes: number;
    artifact_ttl_days: number;
    context_ttl_days: number;
    message_ttl_days: number;
  };
  dream?: DreamGlobalConfig;
}

export interface RoomMeta {
  id: string;
  name: string;
  secret: string;
  pin?: string;
  hosted_by?: string;
  members: string[];
  created_at: string;
  dream?: DreamRoomConfig;
}
