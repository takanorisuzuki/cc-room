import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileTransferManager } from "../../file-transfer.js";
import { StorageManager } from "../../storage.js";
import { generateRoomSecret, FILE_CHUNK_SIZE_BYTES } from "@cc-room/shared";

describe("FileTransferManager", () => {
  let tempDir: string;
  let storage: StorageManager;
  let manager: FileTransferManager;
  const roomId = "test-room-ft";
  const identity = "test-sender";

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "cc-room-ft-"));
    storage = new StorageManager(tempDir);
    storage.createRoom({
      id: roomId,
      name: "FT Test",
      secret: generateRoomSecret(),
      members: [identity, "receiver"],
      created_at: new Date().toISOString(),
    });
    manager = new FileTransferManager(storage, identity);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("小ファイルの offer を作成できる", () => {
    const filePath = join(tempDir, "test.md");
    writeFileSync(filePath, "# Hello");

    const result = manager.createFileOffer(filePath, roomId);
    expect(result).not.toBeNull();
    expect(result!.offer.filename).toBe("test.md");
    expect(result!.offer.size).toBe(7);
    expect(result!.offer.chunks).toBe(1);
    expect(result!.offer.checksum).toBe(StorageManager.sha256(Buffer.from("# Hello")));
  });

  it("10MB 超過ファイルは null を返す", () => {
    const filePath = join(tempDir, "big.bin");
    writeFileSync(filePath, Buffer.alloc(11 * 1024 * 1024));

    const result = manager.createFileOffer(filePath, roomId);
    expect(result).toBeNull();
  });

  it("チャンクを生成できる", () => {
    const filePath = join(tempDir, "multi.bin");
    const data = Buffer.alloc(FILE_CHUNK_SIZE_BYTES * 2 + 100, "x");
    writeFileSync(filePath, data);

    const result = manager.createFileOffer(filePath, roomId);
    expect(result!.offer.chunks).toBe(3);

    const chunks = manager.generateChunks(result!.data, result!.offer.file_id, roomId);
    expect(chunks.length).toBe(3);
    expect(chunks[0].index).toBe(0);
    expect(chunks[1].index).toBe(1);
    expect(chunks[2].index).toBe(2);
  });

  it("受信側でファイルを再構成できる", () => {
    const receiver = new FileTransferManager(storage, "receiver");
    const filePath = join(tempDir, "transfer.txt");
    const content = "Hello, this is a test file for transfer!";
    writeFileSync(filePath, content);

    const result = manager.createFileOffer(filePath, roomId);
    expect(result).not.toBeNull();

    // receiver が offer を受理
    const ack1 = receiver.handleFileOffer(result!.offer);
    expect(ack1.accepted).toBe(true);

    // chunks を送信
    const chunks = manager.generateChunks(result!.data, result!.offer.file_id, roomId);
    let finalAck = null;
    for (const chunk of chunks) {
      const ack = receiver.handleFileChunk(chunk);
      if (ack) finalAck = ack;
    }

    expect(finalAck).not.toBeNull();
    expect(finalAck!.completed).toBe(true);

    // ファイルが保存されている
    const saved = storage.readArtifact(roomId, "transfer.txt");
    expect(saved?.toString()).toBe(content);
  });

  it("checksum 不一致で retry_chunk を返す", () => {
    const receiver = new FileTransferManager(storage, "receiver");
    const filePath = join(tempDir, "bad.txt");
    writeFileSync(filePath, "good data");

    const result = manager.createFileOffer(filePath, roomId);
    receiver.handleFileOffer(result!.offer);

    const chunks = manager.generateChunks(result!.data, result!.offer.file_id, roomId);
    // チャンクの checksum を改ざん
    chunks[0].checksum = "0000000000000000000000000000000000000000000000000000000000000000";

    const ack = receiver.handleFileChunk(chunks[0]);
    expect(ack).not.toBeNull();
    expect(ack!.retry_chunk).toBe(0);
  });
});
