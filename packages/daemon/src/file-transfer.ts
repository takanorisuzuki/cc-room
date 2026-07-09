import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { EventEmitter } from "node:events";
import {
  FILE_CHUNK_SIZE_BYTES,
  MAX_FILE_SIZE_BYTES,
  FILE_TRANSFER_TIMEOUT_MS,
  PROTOCOL_VERSION,
  generateId,
} from "@cc-room/shared";
import type {
  FileOfferMessage,
  FileChunkMessage,
  FileAckMessage,
} from "@cc-room/shared";
import { createChildLogger } from "./logger.js";
import { StorageManager } from "./storage.js";

const log = createChildLogger("file-transfer");

interface IncomingTransfer {
  fileId: string;
  filename: string;
  expectedSize: number;
  expectedChecksum: string;
  expectedChunks: number;
  chunks: Map<number, Buffer>;
  roomId: string;
  sender: string;
  startedAt: number;
}

export class FileTransferManager extends EventEmitter {
  private incoming = new Map<string, IncomingTransfer>();
  private storage: StorageManager;
  private localIdentity: string;

  constructor(storage: StorageManager, localIdentity: string) {
    super();
    this.storage = storage;
    this.localIdentity = localIdentity;
  }

  createFileOffer(filePath: string, roomId: string): { offer: FileOfferMessage; data: Buffer } | null {
    try {
      const data = readFileSync(filePath);
      const filename = basename(filePath);

      if (data.length > MAX_FILE_SIZE_BYTES) {
        log.warn({ filename, size: data.length }, "File too large, skipping");
        return null;
      }

      const checksum = StorageManager.sha256(data);
      const chunks = Math.ceil(data.length / FILE_CHUNK_SIZE_BYTES);

      const offer: FileOfferMessage = {
        v: PROTOCOL_VERSION,
        id: generateId(),
        ts: new Date().toISOString(),
        type: "file_offer",
        room_id: roomId,
        sender: this.localIdentity,
        file_id: generateId(),
        filename,
        size: data.length,
        checksum,
        chunks,
      };
      return { offer, data };
    } catch (err) {
      log.error({ err, filePath }, "Failed to create file offer");
      return null;
    }
  }

  generateChunks(data: Buffer, fileId: string, roomId: string): FileChunkMessage[] {
    const messages: FileChunkMessage[] = [];
    for (let i = 0; i < data.length; i += FILE_CHUNK_SIZE_BYTES) {
      const chunk = data.subarray(i, i + FILE_CHUNK_SIZE_BYTES);
      const index = Math.floor(i / FILE_CHUNK_SIZE_BYTES);
      messages.push({
        v: PROTOCOL_VERSION,
        id: generateId(),
        ts: new Date().toISOString(),
        type: "file_chunk",
        room_id: roomId,
        sender: this.localIdentity,
        file_id: fileId,
        index,
        data: chunk.toString("base64"),
        checksum: StorageManager.sha256(chunk),
      });
    }
    return messages;
  }

  handleFileOffer(msg: FileOfferMessage): FileAckMessage {
    const MAX_CHUNKS = Math.ceil(MAX_FILE_SIZE_BYTES / FILE_CHUNK_SIZE_BYTES);
    if (msg.size > MAX_FILE_SIZE_BYTES || msg.chunks <= 0 || msg.chunks > MAX_CHUNKS) {
      log.warn({ filename: msg.filename, size: msg.size, chunks: msg.chunks }, "Offered file rejected");
      return this.createAck(msg.file_id, msg.room_id, { accepted: false });
    }

    const transfer: IncomingTransfer = {
      fileId: msg.file_id,
      filename: msg.filename,
      expectedSize: msg.size,
      expectedChecksum: msg.checksum,
      expectedChunks: msg.chunks,
      chunks: new Map(),
      roomId: msg.room_id,
      sender: msg.sender,
      startedAt: Date.now(),
    };

    this.incoming.set(msg.file_id, transfer);
    log.info({ fileId: msg.file_id, filename: msg.filename, size: msg.size }, "Accepted file offer");

    return this.createAck(msg.file_id, msg.room_id, { accepted: true });
  }

  handleFileChunk(msg: FileChunkMessage): FileAckMessage | null {
    const transfer = this.incoming.get(msg.file_id);
    if (!transfer) {
      log.warn({ fileId: msg.file_id }, "Received chunk for unknown transfer");
      return null;
    }

    if (Date.now() - transfer.startedAt > FILE_TRANSFER_TIMEOUT_MS) {
      log.warn({ fileId: msg.file_id }, "Transfer timed out");
      this.incoming.delete(msg.file_id);
      return null;
    }

    const chunkData = Buffer.from(msg.data, "base64");
    const chunkChecksum = StorageManager.sha256(chunkData);

    if (chunkChecksum !== msg.checksum) {
      log.warn({ fileId: msg.file_id, index: msg.index }, "Chunk checksum mismatch, requesting retry");
      return this.createAck(msg.file_id, transfer.roomId, { retry_chunk: msg.index });
    }

    transfer.chunks.set(msg.index, chunkData);

    if (transfer.chunks.size === transfer.expectedChunks) {
      return this.assembleFile(transfer);
    }

    return null;
  }

  private assembleFile(transfer: IncomingTransfer): FileAckMessage {
    const parts: Buffer[] = [];
    for (let i = 0; i < transfer.expectedChunks; i++) {
      const chunk = transfer.chunks.get(i);
      if (!chunk) {
        log.error({ fileId: transfer.fileId, missingIndex: i }, "Missing chunk");
        this.incoming.delete(transfer.fileId);
        return this.createAck(transfer.fileId, transfer.roomId, { retry_chunk: i });
      }
      parts.push(chunk);
    }

    const assembled = Buffer.concat(parts);

    if (assembled.length > MAX_FILE_SIZE_BYTES) {
      log.error({ fileId: transfer.fileId, actualSize: assembled.length }, "Assembled file exceeds size limit");
      this.incoming.delete(transfer.fileId);
      return this.createAck(transfer.fileId, transfer.roomId, { accepted: false });
    }

    const checksum = StorageManager.sha256(assembled);
    if (checksum !== transfer.expectedChecksum) {
      log.error({ fileId: transfer.fileId }, "Assembled file checksum mismatch");
      this.incoming.delete(transfer.fileId);
      return this.createAck(transfer.fileId, transfer.roomId, { accepted: false });
    }

    this.storage.writeArtifact(transfer.roomId, transfer.filename, assembled);
    this.incoming.delete(transfer.fileId);

    log.info({ fileId: transfer.fileId, filename: transfer.filename }, "File transfer completed");
    this.emit("file_received", transfer.roomId, transfer.filename, transfer.sender);

    return this.createAck(transfer.fileId, transfer.roomId, { completed: true });
  }

  private createAck(
    fileId: string,
    roomId: string,
    opts: { accepted?: boolean; completed?: boolean; retry_chunk?: number },
  ): FileAckMessage {
    return {
      v: PROTOCOL_VERSION,
      id: generateId(),
      ts: new Date().toISOString(),
      type: "file_ack",
      room_id: roomId,
      sender: this.localIdentity,
      file_id: fileId,
      ...opts,
    };
  }

  cleanupTimedOut(): void {
    const now = Date.now();
    for (const [fileId, transfer] of this.incoming) {
      if (now - transfer.startedAt > FILE_TRANSFER_TIMEOUT_MS) {
        log.warn({ fileId, filename: transfer.filename }, "Cleaning up timed out transfer");
        this.incoming.delete(fileId);
      }
    }
  }
}
