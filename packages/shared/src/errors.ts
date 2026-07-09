export enum ErrorCode {
  // 認証 (1xxx)
  AUTH_FAILED = 1001,
  AUTH_TIMEOUT = 1002,
  ROOM_NOT_FOUND = 1003,
  ALREADY_MEMBER = 1004,

  // プロトコル (2xxx)
  VERSION_MISMATCH = 2001,
  INVALID_MESSAGE = 2002,
  UNKNOWN_TYPE = 2003,

  // ファイル転送 (3xxx)
  FILE_TOO_LARGE = 3001,
  CHECKSUM_MISMATCH = 3002,
  TRANSFER_TIMEOUT = 3003,
  STORAGE_FULL = 3004,

  // 接続 (4xxx)
  PEER_UNREACHABLE = 4001,
  CONNECTION_RESET = 4002,
  MAX_CONNECTIONS = 4003,

  // 内部 (5xxx)
  SUMMARIZER_FAILED = 5001,
  STORAGE_ERROR = 5002,
  CONFIG_INVALID = 5003,
}

export class CcRoomError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "CcRoomError";
  }
}
