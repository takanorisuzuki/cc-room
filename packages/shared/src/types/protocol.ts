import type { ErrorCode } from "../errors.js";

export type MessageType =
  | "challenge"
  | "auth"
  | "auth_ok"
  | "auth_fail"
  | "context_update"
  | "message"
  | "mention"
  | "file_offer"
  | "file_chunk"
  | "file_ack"
  | "memory_update"
  | "room_memory_sync"
  | "dream_proposal_sync"
  | "room_memory_merge"
  | "invite"
  | "invite_accept"
  | "invite_reject"
  | "peer_status"
  | "error"
  | "ping"
  | "pong"
  | "initial_sync"
  | "file_share";

export interface ProtocolMessage {
  v: number;
  id: string;
  ts: string;
  type: MessageType;
  room_id: string;
  sender: string;
}

// --- 認証 ---

export interface ChallengeMessage extends ProtocolMessage {
  type: "challenge";
  nonce: string;
}

export interface AuthMessage extends ProtocolMessage {
  type: "auth";
  identity: string;
  response: string;
  supported_versions: number[];
}

export interface AuthOkMessage extends ProtocolMessage {
  type: "auth_ok";
  members: string[];
}

export interface AuthFailMessage extends ProtocolMessage {
  type: "auth_fail";
  reason: string;
}

// --- 価値 ---

export interface ContextUpdateMessage extends ProtocolMessage {
  type: "context_update";
  summary: string;
  session_id: string;
  turn_range: [number, number];
}

export interface UserMessage extends ProtocolMessage {
  type: "message";
  content: string;
}

export interface FileOfferMessage extends ProtocolMessage {
  type: "file_offer";
  file_id: string;
  filename: string;
  size: number;
  checksum: string;
  chunks: number;
}

export interface FileChunkMessage extends ProtocolMessage {
  type: "file_chunk";
  file_id: string;
  index: number;
  data: string;
  checksum: string;
}

export interface FileAckMessage extends ProtocolMessage {
  type: "file_ack";
  file_id: string;
  accepted?: boolean;
  completed?: boolean;
  retry_chunk?: number;
}

export interface MemoryUpdateMessage extends ProtocolMessage {
  type: "memory_update";
  content: string;
}

export interface RoomMemorySyncMessage extends ProtocolMessage {
  type: "room_memory_sync";
  slug: string;
  description: string;
  content: string;
  index_md: string;
  count: number;
  /** true: revert によるエントリ削除の伝達。受信側は slug のファイルを削除し索引を差し替える */
  deleted?: boolean;
}

export interface DreamProposalSyncMessage extends ProtocolMessage {
  type: "dream_proposal_sync";
  proposals: Array<{ slug: string; description: string; status: string }>;
}

export interface RoomMemoryMergeMessage extends ProtocolMessage {
  type: "room_memory_merge";
  merged_slugs: string[];
  reverted?: boolean;
}

// --- 管理 ---

export interface InviteMessage extends ProtocolMessage {
  type: "invite";
  inviter: string;
  room_name: string;
}

export interface InviteAcceptMessage extends ProtocolMessage {
  type: "invite_accept";
}

export interface InviteRejectMessage extends ProtocolMessage {
  type: "invite_reject";
}

export type PeerState = "online" | "disconnected" | "offline";

export interface PeerStatusMessage extends ProtocolMessage {
  type: "peer_status";
  state: PeerState;
}

export interface ErrorMessage extends ProtocolMessage {
  type: "error";
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export interface PingMessage extends ProtocolMessage {
  type: "ping";
}

export interface PongMessage extends ProtocolMessage {
  type: "pong";
}

// --- @メンション ---

export interface MentionMessage extends ProtocolMessage {
  type: "mention";
  to: string;              // 宛先 identity、"here"、"all" のいずれか
  content: string;
  context_summary?: string;    // 送信者が公開中（Primary かつ Private OFF）のときのみ含まれる（それ以外は absent）
  context_summary_ts?: string; // サマリー生成時刻（ISO8601）
}

// --- ファイル共有（承認制） ---

export type FileShareType = "skill" | "command" | "claude_md";

export interface FileShareMessage extends ProtocolMessage {
  type: "file_share";
  share_type: FileShareType;
  filename: string;
  content: string;
}

// --- 初期同期 ---

export interface RoomMemorySyncPayload {
  index_md: string;
  files: Array<{ slug: string; content: string }>;
}

export interface InitialSyncMessage extends ProtocolMessage {
  type: "initial_sync";
  contexts: Record<string, string>;
  messages: Array<Record<string, unknown>>;
  memory: string | null;
  artifact_names: string[];
  room_memory?: RoomMemorySyncPayload | null;
}

// --- Envelope ---

export interface SignedEnvelope {
  payload: string;
  sig: string;
  sender: string;
}

// --- Union ---

export type AnyProtocolMessage =
  | ChallengeMessage
  | AuthMessage
  | AuthOkMessage
  | AuthFailMessage
  | ContextUpdateMessage
  | UserMessage
  | MentionMessage
  | FileOfferMessage
  | FileChunkMessage
  | FileAckMessage
  | MemoryUpdateMessage
  | RoomMemorySyncMessage
  | DreamProposalSyncMessage
  | RoomMemoryMergeMessage
  | InviteMessage
  | InviteAcceptMessage
  | InviteRejectMessage
  | PeerStatusMessage
  | ErrorMessage
  | PingMessage
  | PongMessage
  | InitialSyncMessage
  | FileShareMessage;
