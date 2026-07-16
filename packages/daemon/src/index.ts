#!/usr/bin/env node
import { writeFileSync, unlinkSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import {
  PROTOCOL_VERSION,
  generateId,
  generateRoomSecret,
  generateRoomPin,
  pinToSecret,
  STORAGE_CLEANUP_INTERVAL_MS,
  ROOM_NAME_MAX_LENGTH,
} from "@cc-room/shared";
import type {
  AnyProtocolMessage,
  ContextUpdateMessage,
  UserMessage,
  MentionMessage,
  FileOfferMessage,
  FileChunkMessage,
  MemoryUpdateMessage,
  RoomMemorySyncMessage,
  DreamProposalSyncMessage,
  RoomMemoryMergeMessage,
  InitialSyncMessage,
  FileShareMessage,
  FileShareType,
} from "@cc-room/shared";
import { buildL0Injection, isValidRoomMemorySlug } from "./room-memory.js";
import { searchRoomMemoryEntries } from "./room-memory-search.js";
import {
  buildOrgL0Injection,
  listOrgMemoryEntries,
  readOrgLastInjectSession,
  resolveOrgMemoryDir,
  writeOrgLastInjectSession,
} from "./org-memory.js";
import { formatTraceForDisplay, readTraceEntries } from "./dream-proposals.js";
import { listProposalFiles } from "./dream-pending-merges.js";
import { readRecentSessionTranscripts } from "./session-reader.js";
import { DreamMiner, type DreamCandidate } from "./dream-miner.js";
import type { PendingShareEntry, MentionEntry } from "./storage.js";
import { logger } from "./logger.js";
import { loadConfig, saveNotificationsEnabled, PID_PATH, CC_ROOM_DIR, ROOMS_DIR } from "./config.js";
import { RoomServer } from "./server.js";
import { Discovery } from "./discovery.js";
import { PeerConnector } from "./peer-connector.js";
import { StorageManager } from "./storage.js";
import { SessionWatcher } from "./watcher.js";
import type { ConversationTurn } from "./watcher.js";
import { Summarizer } from "./summarizer.js";
import { PrivacyFilter } from "./privacy-filter.js";
import { FileTransferManager } from "./file-transfer.js";
import { HttpApi } from "./http-api.js";
import type { HttpApiHandlers } from "./http-api.js";
import { HealthChecker } from "./health.js";
import { RoomLifecycle } from "./room-lifecycle.js";
import { Notifier } from "./notifier.js";
import { ShowStateManager } from "./show-state.js";
import { DreamQueueService } from "./dream-queue.js";
import { DreamWorker } from "./dream-worker.js";
import { DreamPendingMergeService } from "./dream-pending-merges.js";
import { DreamMergeScanner } from "./dream-merge-scanner.js";
import { resolveDreamConfig, formatDreamConfigSummary, parseDreamRoomPatch, sanitizeDreamRoomConfig } from "./dream-config.js";

async function main() {
  const config = loadConfig();
  const identity = config.identity.name;
  logger.info({ identity }, "cc-room daemon starting");

  writeFileSync(PID_PATH, process.pid.toString(), { mode: 0o644 });

  const orgDir = resolveOrgMemoryDir(config.dream?.org_memory_path);
  const storage = new StorageManager();
  const server = new RoomServer(config);
  const discovery = new Discovery(config);
  const peerConnector = new PeerConnector(identity);
  const notifier = new Notifier(config.notifications.enabled);
  const summarizer = new Summarizer(config.summarizer.model);
  const privacyFilter = new PrivacyFilter(config.privacy);
  const fileTransfer = new FileTransferManager(storage, identity);
  const roomLifecycle = new RoomLifecycle(storage);
  const watcher = new SessionWatcher((name) => privacyFilter.isToolPublic(name));
  const showState = new ShowStateManager(join(CC_ROOM_DIR, "show-state.json"));
  showState.load();
  showState.syncValidRooms(storage.listRooms().map((r) => r.id));
  const dreamQueue = new DreamQueueService({
    identity,
    roomsDir: ROOMS_DIR,
    globalDream: config.dream,
    listRooms: () => storage.listRooms(),
    showState,
  });
  const dreamMiner = new DreamMiner(process.env.ANTHROPIC_API_KEY, config.dream?.model);
  const dreamPendingMergeService = new DreamPendingMergeService({
    roomMemoryDir: (id) => storage.roomMemoryDir(id),
    proposalsDir: (id) => storage.proposalsDir(id),
    listRoomMemoryEntries: (id) => storage.listRoomMemoryEntries(id),
  });
  function broadcastMergedEntry(
    roomId: string,
    slug: string,
    options?: {
      cached?: { entries: ReturnType<StorageManager["listRoomMemoryEntries"]>; indexMd: string };
      /** revert の伝達: 受信側はエントリ削除（content 空）or スナップショット上書きを行う */
      reverted?: boolean;
    },
  ): void {
    const room = storage.getRoomMeta(roomId);
    if (!room) return;
    const entryPath = join(storage.roomMemoryDir(roomId), `${slug}.md`);
    // revert 時はファイル不在 = 削除（content 空のまま送る）。存在すればスナップショット復元後の内容
    let entryContent = "";
    if (existsSync(entryPath)) {
      try {
        entryContent = readFileSync(entryPath, "utf-8");
      } catch {
        return;
      }
    } else if (!options?.reverted) {
      return;
    }
    const entries = options?.cached?.entries ?? storage.listRoomMemoryEntries(roomId);
    const indexMd = options?.cached?.indexMd ?? storage.readRoomMemoryIndex(roomId) ?? "";
    const desc = entries.find((e) => e.slug === slug)?.description ?? slug;
    const syncMsg: RoomMemorySyncMessage = {
      v: PROTOCOL_VERSION,
      id: generateId(),
      ts: new Date().toISOString(),
      type: "room_memory_sync",
      room_id: roomId,
      sender: identity,
      slug,
      description: desc,
      content: entryContent,
      index_md: indexMd,
      count: entries.length,
      ...(options?.reverted && { deleted: true }),
    };
    server.broadcastMessage(roomId, syncMsg);
    peerConnector.broadcastToRoom(roomId, syncMsg, room.secret);
  }
  function broadcastDreamProposalSync(
    roomId: string,
    proposals: Array<{ slug: string; description: string; status: string }>,
  ): void {
    if (proposals.length === 0) return;
    const room = storage.getRoomMeta(roomId);
    if (!room) return;
    const syncMsg: DreamProposalSyncMessage = {
      v: PROTOCOL_VERSION,
      id: generateId(),
      ts: new Date().toISOString(),
      type: "dream_proposal_sync",
      room_id: roomId,
      sender: identity,
      proposals,
    };
    server.broadcastMessage(roomId, syncMsg);
    peerConnector.broadcastToRoom(roomId, syncMsg, room.secret);
  }
  function broadcastRoomMemoryMerge(
    roomId: string,
    mergedSlugs: string[],
    reverted = false,
  ): void {
    if (mergedSlugs.length === 0) return;
    const room = storage.getRoomMeta(roomId);
    if (!room) return;
    const mergeMsg: RoomMemoryMergeMessage = {
      v: PROTOCOL_VERSION,
      id: generateId(),
      ts: new Date().toISOString(),
      type: "room_memory_merge",
      room_id: roomId,
      sender: identity,
      merged_slugs: mergedSlugs,
      reverted,
    };
    server.broadcastMessage(roomId, mergeMsg);
    peerConnector.broadcastToRoom(roomId, mergeMsg, room.secret);
  }
  function resolveTargetRoom(roomId?: string) {
    if (roomId) {
      const room = storage.getRoomMeta(roomId);
      if (!room) throw new Error("ルームが見つかりません");
      return room;
    }
    const rooms = storage.listRooms();
    if (rooms.length === 0) throw new Error("ルームに参加していません");
    const primaryId = showState.getPrimaryRoomId();
    return rooms.find((r) => r.id === primaryId) ?? rooms[0];
  }

  function assertRoomHost(room: { hosted_by?: string; members: string[] }): void {
    const host = room.hosted_by ?? room.members[0];
    if (host !== identity) {
      throw new Error("ホストのみ変更できます");
    }
  }

  const dreamWorker = new DreamWorker({
    identity,
    claudeProjectsDir: join(process.env.CC_CLAUDE_HOME ?? join(homedir(), ".claude"), "projects"),
    roomsDir: ROOMS_DIR,
    globalDream: config.dream,
    queue: dreamQueue,
    showState,
    miner: dreamMiner,
    getRoom: (id) => storage.getRoomMeta(id) ?? undefined,
    roomMemoryDir: (id) => storage.roomMemoryDir(id),
    memberAutoMemoryDir: (id, who) => storage.memberAutoMemoryDir(id, who),
    listProposalSlugs: (id) => storage.listProposalSlugs(id),
    listRoomMemorySlugs: (id) => storage.listRoomMemorySlugSet(id),
    readRoomMemoryIndex: (id) => storage.readRoomMemoryIndex(id),
    pendingMergeService: dreamPendingMergeService,
    onProposalsCreated: ({ roomId, roomName, count, slugs }) => {
      if (count === 0) return;
      const preview = slugs[0] ?? "";
      notifier.notify({
        type: "dream_proposals",
        room: roomName,
        count,
        preview,
      });
      const slugSet = new Set(slugs);
      const proposals = listProposalFiles(storage.proposalsDir(roomId))
        .filter((p) => slugSet.has(p.slug))
        .map((p) => ({ slug: p.slug, description: p.description, status: p.status }));
      broadcastDreamProposalSync(roomId, proposals);
    },
  });
  dreamQueue.setOnEnqueued(() => {
    dreamWorker.notify();
  });
  dreamWorker.start();
  const dreamMergeScanner = new DreamMergeScanner({
    listRoomIds: () => storage.listRooms().map((r) => r.id),
    mergeService: dreamPendingMergeService,
    onMerged: (roomId, results) => {
      const room = storage.getRoomMeta(roomId);
      if (!room) return;
      broadcastRoomMemoryMerge(
        roomId,
        results.map((r) => r.slug),
        false,
      );
      const entries = storage.listRoomMemoryEntries(roomId);
      const indexMd = storage.readRoomMemoryIndex(roomId) ?? "";
      for (const r of results) {
        broadcastMergedEntry(roomId, r.slug, { cached: { entries, indexMd } });
      }
      notifier.notify({
        type: "dream_merged",
        room: room.name,
        count: results.length,
        descriptions: results.map((r) => r.description),
      });
    },
  });
  dreamMergeScanner.start();

  // 既存ルームを server に登録
  for (const room of storage.listRooms()) {
    server.registerRoom(room.id, room.secret);
  }

  // メッセージハンドラ（inbound + outbound 両方で共通）
  server.on("message", (msg: AnyProtocolMessage, senderIdentity: string) => {
    handleIncomingMessage(msg, senderIdentity);
  });

  peerConnector.on("message", (msg: AnyProtocolMessage, senderIdentity: string) => {
    handleIncomingMessage(msg, senderIdentity);
  });

  // 接続状態変化で idle 管理
  // peer が抜けたときだけ idle チェック（部屋作成直後に消えないようにする）
  const roomHadPeers = new Set<string>();
  const claudeHome = process.env.CC_CLAUDE_HOME ?? join(homedir(), ".claude");

  function roomDisplayName(roomId: string): string {
    return storage.getRoomMeta(roomId)?.name ?? roomId;
  }

  function findPending(pendingId: string): { roomId: string; entry: PendingShareEntry } | null {
    for (const room of storage.listRooms()) {
      const entry = storage.getPending(room.id, pendingId);
      if (entry) return { roomId: room.id, entry };
    }
    return null;
  }

  function rememberAndBroadcast(
    room: { id: string; secret: string },
    content: string,
    sessionId?: string,
  ): { slug: string; count: number; description: string } {
    const result = storage.rememberRoomMemory(room.id, content, identity, sessionId);
    const entryPath = join(storage.roomMemoryDir(room.id), `${result.slug}.md`);
    const entryContent = readFileSync(entryPath, "utf-8");
    const indexMd = storage.readRoomMemoryIndex(room.id) ?? "";
    const syncMsg: RoomMemorySyncMessage = {
      v: PROTOCOL_VERSION,
      id: generateId(),
      ts: new Date().toISOString(),
      type: "room_memory_sync",
      room_id: room.id,
      sender: identity,
      slug: result.slug,
      description: result.description,
      content: entryContent,
      index_md: indexMd,
      count: result.count,
    };
    server.broadcastMessage(room.id, syncMsg);
    peerConnector.broadcastToRoom(room.id, syncMsg, room.secret);
    storage.appendMessage(room.id, {
      ts: syncMsg.ts,
      from: identity,
      type: "memory",
      content,
    });
    return result;
  }

  function handlePeerConnect(joinerIdentity: string, roomId: string) {
    roomHadPeers.add(roomId);
    roomLifecycle.markActive(roomId);
    // ホスト（自分が room を作成した場合）のみ初期同期を送信
    const meta = storage.getRoomMeta(roomId);
    notifier.notify({ type: "join", room: meta?.name ?? roomId, identity: joinerIdentity });
    if (!meta || meta.hosted_by !== identity) return;

    const syncMsg: InitialSyncMessage = {
      v: PROTOCOL_VERSION,
      id: generateId(),
      ts: new Date().toISOString(),
      type: "initial_sync",
      room_id: roomId,
      sender: identity,
      contexts: storage.readAllContexts(roomId),
      messages: storage.readMessages(roomId),
      memory: storage.readMemory(roomId),
      artifact_names: storage.listArtifacts(roomId).map((a) => a.name),
      room_memory: storage.readAllRoomMemoryForSync(roomId),
    };

    server.sendTo(joinerIdentity, syncMsg);
  }

  function handlePeerDisconnect(peerIdentity: string, roomId: string) {
    notifier.notify({ type: "leave", room: roomDisplayName(roomId), identity: peerIdentity });
    if (!roomHadPeers.has(roomId)) return;
    const inbound = server.getConnectedPeers(roomId);
    const outbound = peerConnector.getConnectedPeers(roomId);
    if (inbound.length === 0 && outbound.length === 0) {
      roomLifecycle.markIdle(roomId);
    }
  }

  server.on("peer_connect", handlePeerConnect);
  server.on("peer_disconnect", handlePeerDisconnect);
  peerConnector.on("peer_connect", handlePeerConnect);
  peerConnector.on("peer_disconnect", handlePeerDisconnect);

  // 部屋が idle timeout で削除されたとき、関連リソースもクリーンアップ
  roomLifecycle.onRoomRemoved((roomId: string) => {
    server.unregisterRoom(roomId);
    discovery.removeRoomAdvertisement(roomId);
  });

  function handleIncomingMessage(msg: AnyProtocolMessage, senderIdentity: string) {
    try {
    switch (msg.type) {
      case "context_update": {
        const ctx = msg as ContextUpdateMessage;
        storage.writeContext(ctx.room_id, ctx.sender, ctx.summary);
        storage.appendMessage(ctx.room_id, {
          ts: ctx.ts,
          from: ctx.sender,
          type: "context",
          summary: ctx.summary,
        });
        break;
      }
      case "message": {
        const userMsg = msg as UserMessage;
        storage.appendMessage(userMsg.room_id, {
          ts: userMsg.ts,
          from: userMsg.sender,
          type: "message",
          content: userMsg.content,
        });
        notifier.notify({ type: "message", room: roomDisplayName(userMsg.room_id), from: userMsg.sender, content: userMsg.content ?? "" });
        break;
      }
      case "mention": {
        const mention = msg as MentionMessage;
        const isForMe =
          mention.to === identity ||
          mention.to === "all" ||
          (mention.to === "here" && showState.isPublic(mention.room_id));
        if (!isForMe) break;
        const entry: MentionEntry = {
          id: mention.id,
          ts: mention.ts,
          from: mention.sender,
          to: mention.to,
          content: mention.content,
          read: false,
          ...(mention.context_summary !== undefined && { context_summary: mention.context_summary }),
          ...(mention.context_summary_ts !== undefined && { context_summary_ts: mention.context_summary_ts }),
        };
        storage.appendMention(mention.room_id, entry);
        logger.info({ from: mention.sender, to: mention.to }, "@メンションを受信");
        break;
      }
      case "file_offer": {
        const offer = msg as FileOfferMessage;
        const ack = fileTransfer.handleFileOffer(offer);
        server.sendTo(senderIdentity, ack);
        break;
      }
      case "file_chunk": {
        const chunk = msg as FileChunkMessage;
        const ack = fileTransfer.handleFileChunk(chunk);
        if (ack) server.sendTo(senderIdentity, ack);
        break;
      }
      case "file_ack": {
        // 送信側での ack 処理（再送等）
        break;
      }
      case "memory_update": {
        const mem = msg as MemoryUpdateMessage;
        storage.writeMemory(mem.room_id, mem.content);
        storage.appendMessage(mem.room_id, {
          ts: mem.ts,
          from: mem.sender,
          type: "memory",
          content: mem.content,
        });
        break;
      }
      case "room_memory_sync": {
        const sync = msg as RoomMemorySyncMessage;
        if (sync.deleted) {
          // revert の伝達: エントリ削除（content 空）or スナップショット復元
          storage.applyRoomMemoryRevert(sync.room_id, sync.slug, sync.content);
        } else {
          storage.applyRoomMemorySync(sync.room_id, {
            index_md: sync.index_md,
            files: [{ slug: sync.slug, content: sync.content }],
          });
        }
        storage.appendMessage(sync.room_id, {
          ts: sync.ts,
          from: sync.sender,
          type: "memory",
          content: sync.description,
        });
        break;
      }
      case "dream_proposal_sync": {
        const sync = msg as DreamProposalSyncMessage;
        if (sync.sender !== identity && sync.proposals.length > 0) {
          notifier.notify({
            type: "dream_proposals",
            room: roomDisplayName(sync.room_id),
            count: sync.proposals.length,
            preview: sync.proposals[0]?.slug ?? "",
          });
        }
        break;
      }
      case "room_memory_merge": {
        const merge = msg as RoomMemoryMergeMessage;
        if (merge.sender !== identity && merge.merged_slugs.length > 0) {
          notifier.notify({
            type: "dream_merged",
            room: roomDisplayName(merge.room_id),
            count: merge.merged_slugs.length,
            descriptions: merge.merged_slugs,
          });
        }
        break;
      }
      case "file_share": {
        const shareMsg = msg as FileShareMessage;
        if (
          typeof shareMsg.filename !== "string" ||
          !shareMsg.filename ||
          typeof shareMsg.content !== "string" ||
          !["skill", "command", "claude_md"].includes(shareMsg.share_type)
        ) {
          logger.warn({ msg }, "無効なファイル共有メッセージを受信したため無視します");
          break;
        }
        try {
          const savePath = storage.resolveShareSavePath(shareMsg.share_type, shareMsg.filename, shareMsg.room_id, claudeHome);
          const entry: PendingShareEntry = {
            id: generateId(),
            ts: shareMsg.ts,
            room_id: shareMsg.room_id,
            from: shareMsg.sender,
            share_type: shareMsg.share_type,
            filename: shareMsg.filename,
            content: shareMsg.content,
            save_path: savePath,
          };
          storage.savePending(shareMsg.room_id, entry);
          const roomName = roomDisplayName(shareMsg.room_id);
          notifier.notify({ type: "file_received", room: roomName, from: shareMsg.sender, filename: shareMsg.filename });
          logger.info({ type: shareMsg.share_type, filename: shareMsg.filename, from: shareMsg.sender, savePath }, "ファイル共有を受信・承認待ち");
        } catch (err) {
          logger.error({ err, msg }, "ファイル共有の処理中にエラーが発生しました");
        }
        break;
      }
      case "initial_sync": {
        const sync = msg as InitialSyncMessage;
        // 既存データがない場合のみ書き込む（後着の initial_sync で上書きしない）
        if (sync.contexts && typeof sync.contexts === "object") {
          for (const [member, summary] of Object.entries(sync.contexts)) {
            if (!/^[a-zA-Z0-9._-]+$/.test(member)) {
              logger.warn({ member, roomId: sync.room_id }, "initial_sync: invalid member name, skipping");
              continue;
            }
            if (!storage.readContext(sync.room_id, member)) {
              storage.writeContext(sync.room_id, member, summary);
            }
          }
        }
        if (sync.memory && !storage.readMemory(sync.room_id)) {
          storage.writeMemory(sync.room_id, sync.memory);
        }
        if (sync.room_memory?.files?.length) {
          storage.applyRoomMemorySync(sync.room_id, sync.room_memory);
        }
        // メッセージ履歴は既存がなければ一括書き込み
        if (Array.isArray(sync.messages) && storage.readMessages(sync.room_id).length === 0) {
          for (const entry of sync.messages) {
            if (entry && typeof entry === "object" && "ts" in entry && "from" in entry && "type" in entry) {
              storage.appendMessage(sync.room_id, entry as Parameters<typeof storage.appendMessage>[1]);
            }
          }
        }
        break;
      }
    }
    } catch (err) {
      logger.error({ err, type: msg.type, sender: senderIdentity }, "メッセージ処理中にエラーが発生");
    }
  }

  // Private ON 中の執筆は Primary ルームの pending に蓄積（v2.0: share/drop 選択待ち）
  const pendingTurnsByRoom = new Map<string, ConversationTurn[]>();
  const pendingFilesByRoom = new Map<string, string[]>();
  const MAX_PENDING_TURNS = 1000;
  let processingTurns = Promise.resolve();

  function getPendingTurns(roomId: string): ConversationTurn[] {
    let buf = pendingTurnsByRoom.get(roomId);
    if (!buf) {
      buf = [];
      pendingTurnsByRoom.set(roomId, buf);
    }
    return buf;
  }

  function pushPendingTurns(roomId: string, turns: ConversationTurn[]): void {
    const buf = getPendingTurns(roomId);
    buf.push(...turns);
    if (buf.length > MAX_PENDING_TURNS) {
      buf.splice(0, buf.length - MAX_PENDING_TURNS);
    }
  }

  function getPendingFiles(roomId: string): string[] {
    let buf = pendingFilesByRoom.get(roomId);
    if (!buf) {
      buf = [];
      pendingFilesByRoom.set(roomId, buf);
    }
    return buf;
  }

  function broadcastFileToRoom(filePath: string, roomId: string) {
    const room = storage.getRoomMeta(roomId);
    if (!room) return;
    const result = fileTransfer.createFileOffer(filePath, roomId);
    if (!result) return;
    server.broadcastMessage(roomId, result.offer);
    peerConnector.broadcastToRoom(roomId, result.offer, room.secret);
    const chunks = fileTransfer.generateChunks(result.data, result.offer.file_id, roomId);
    for (const chunk of chunks) {
      server.broadcastMessage(roomId, chunk);
      peerConnector.broadcastToRoom(roomId, chunk, room.secret);
    }
  }

  function enqueueSummary(turns: ConversationTurn[], roomId: string) {
    processingTurns = processingTurns.then(async () => {
      try {
        const filtered = privacyFilter.filterTurns(turns);
        if (filtered.length > 0) {
          const summary = await summarizer.summarize(filtered);
          if (summary) broadcastSummary(summary, turns.length, roomId);
        }
      } catch (err) {
        logger.error({ err, roomId }, "サマリー自動配信に失敗");
      }
    });
  }

  // 執筆は Primary ルームのみ（Watch は Read Only）。Private ON 中は pending に蓄積
  watcher.on("turns", (turns: ConversationTurn[]) => {
    const primaryId = showState.getPrimaryRoomId();
    if (!primaryId || !storage.getRoomMeta(primaryId)) return;
    if (showState.isPublic(primaryId)) {
      enqueueSummary(turns, primaryId);
    } else {
      pushPendingTurns(primaryId, turns);
    }
  });

  function broadcastSummary(summary: string, turnCount: number, roomId: string) {
    const room = storage.getRoomMeta(roomId);
    if (!room) return;
    storage.writeContext(roomId, identity, summary);

    const msg: ContextUpdateMessage = {
      v: PROTOCOL_VERSION,
      id: generateId(),
      ts: new Date().toISOString(),
      type: "context_update",
      room_id: roomId,
      sender: identity,
      summary,
      session_id: "",
      turn_range: [0, turnCount],
    };

    server.broadcastMessage(roomId, msg);
    peerConnector.broadcastToRoom(roomId, msg, room.secret);
  }

  // ファイル受信通知
  fileTransfer.on("file_received", (roomId: string, filename: string, sender: string) => {
    storage.appendMessage(roomId, {
      ts: new Date().toISOString(),
      from: sender,
      type: "artifact",
      file: filename,
    });
    notifier.notify({ type: "file_received", room: roomDisplayName(roomId), from: sender, filename });
  });

  const health = new HealthChecker(config, storage, () => server.isListening());

  // HTTP API ハンドラ
  const httpHandlers: HttpApiHandlers = {
    getHealth: () => {
      const status = health.check();
      return { ...status, identity, pid: process.pid };
    },

    getStatus: () => {
      const joinedIds = storage.listRooms().map((r) => r.id);
      showState.syncValidRooms(joinedIds);
      const rooms = storage.listRooms().map((room) => {
        const inbound = server.getConnectedPeers(room.id);
        const outbound = peerConnector.getConnectedPeers(room.id);
        const connected = [...new Set([...inbound, ...outbound])];
        return {
          id: room.id,
          name: room.name,
          members: room.members,
          connected,
          role: showState.getRole(room.id) ?? "watch",
          public: showState.isPublic(room.id),
          dream: resolveDreamConfig(config.dream, room.dream),
        };
      });
      const primaryId = showState.getPrimaryRoomId();
      const primaryRoom = primaryId ? storage.getRoomMeta(primaryId) : null;
      return {
        identity,
        private: showState.isPrivate(),
        primary_room_id: primaryId,
        primary_room_name: primaryRoom?.name ?? null,
        pending_turns: primaryId ? getPendingTurns(primaryId).length : 0,
        pending_files: primaryId ? getPendingFiles(primaryId).length : 0,
        rooms,
      };
    },

    getContext: () => {
      const result: Record<string, Record<string, string>> = {};
      for (const room of storage.listRooms()) {
        result[room.id] = storage.readAllContexts(room.id);
      }
      return result;
    },

    getMessages: () => {
      const result: Record<string, unknown[]> = {};
      for (const room of storage.listRooms()) {
        result[room.id] = storage.readMessages(room.id);
      }
      return result;
    },

    getFiles: () => {
      const result: Record<string, unknown[]> = {};
      for (const room of storage.listRooms()) {
        result[room.id] = storage.listArtifacts(room.id);
      }
      return result;
    },

    postInvite: async (body) => {
      const roomId = generateId();
      const secret = generateRoomSecret();
      storage.createRoom({
        id: roomId,
        name: `Room with ${body.name}`,
        secret,
        members: [identity, body.name],
        created_at: new Date().toISOString(),
      });
      server.registerRoom(roomId, secret);
      return { room_id: roomId, secret, message: `Room created. Share this secret with ${body.name}: ${secret}` };
    },

    postJoin: async (body) => {
      if (!body || typeof body.room_id !== "string" || typeof body.secret !== "string") {
        throw new Error("room_id and secret are required");
      }
      const existing = storage.getRoomMeta(body.room_id);
      if (existing) {
        return { ok: true, room_id: body.room_id, message: "Already in this room" };
      }
      storage.createRoom({
        id: body.room_id,
        name: `Room ${body.room_id}`,
        secret: body.secret,
        members: [identity],
        created_at: new Date().toISOString(),
      });
      server.registerRoom(body.room_id, body.secret);
      return { ok: true, room_id: body.room_id };
    },

    postLeave: async (body) => {
      if (!body || typeof body.room_id !== "string") {
        throw new Error("room_id is required");
      }
      const meta = storage.getRoomMeta(body.room_id);
      if (!meta) {
        return { ok: false, message: "Room not found" };
      }
      peerConnector.disconnectRoom(body.room_id);
      server.unregisterRoom(body.room_id);
      discovery.removeRoomAdvertisement(body.room_id);
      notifier.notify({ type: "room_closed", room: meta.name });
      const remaining = storage.listRooms().filter((r) => r.id !== body.room_id).map((r) => r.id);
      showState.onRoomLeave(body.room_id, remaining);
      storage.deleteRoom(body.room_id);
      return { ok: true, room_id: body.room_id };
    },

    postShare: async (body) => {
      const joined = storage.listRooms();
      if (joined.length === 0) {
        throw new Error("ルームに参加していません");
      }
      // /show "msg" は Primary への明示投稿。pending は flush しない（share/drop は /private で選択）
      const explicitRoomId = typeof body.room_id === "string" ? body.room_id : undefined;
      const targetRoomId = explicitRoomId ?? showState.getPrimaryRoomId();
      if (!targetRoomId || !joined.some((r) => r.id === targetRoomId)) {
        throw new Error("Primary ルームがありません。/room switch <name> で切り替えてください");
      }

      const room = joined.find((r) => r.id === targetRoomId);
      if (!room) throw new Error("Room not found");

      if (body.message) {
        const msg: UserMessage = {
          v: PROTOCOL_VERSION,
          id: generateId(),
          ts: new Date().toISOString(),
          type: "message",
          room_id: room.id,
          sender: identity,
          content: body.message,
        };
        server.broadcastMessage(room.id, msg);
        peerConnector.broadcastToRoom(room.id, msg, room.secret);
        storage.appendMessage(room.id, {
          ts: msg.ts,
          from: identity,
          type: "message",
          content: body.message,
        });
      }

      return { sent: true, room_id: room.id, room_name: room.name };
    },

    postMemory: async (body) => {
      if (!body || typeof body.content !== "string") {
        throw new Error("content is required");
      }
      const sessionId =
        typeof body.session_id === "string" ? body.session_id : undefined;
      let lastResult: { slug: string; count: number; description: string } | null = null;
      for (const room of storage.listRooms()) {
        lastResult = rememberAndBroadcast(room, body.content, sessionId);
      }
      const count = lastResult?.count ?? 0;
      return {
        saved: true,
        count,
        slug: lastResult?.slug,
        message: `✅ チームメモリに追加しました。次のセッションからチーム全員の Claude が参照します。(現在 ${count}件)`,
      };
    },

    getMemoryInject: (sessionId: string) => {
      const blocks: string[] = [];
      if (orgDir) {
        const orgEntries = listOrgMemoryEntries(orgDir);
        if (orgEntries.length > 0 && readOrgLastInjectSession(orgDir) !== sessionId) {
          const orgBlock = buildOrgL0Injection(orgEntries);
          if (orgBlock) {
            blocks.push(orgBlock);
            writeOrgLastInjectSession(orgDir, sessionId);
          }
        }
      }
      for (const room of storage.listRooms()) {
        const entries = storage.listRoomMemoryEntries(room.id);
        if (entries.length === 0) continue;
        const last = storage.readLastInjectSession(room.id);
        if (last === sessionId) continue;
        const block = buildL0Injection(entries, room.name);
        if (block) {
          blocks.push(block);
          storage.writeLastInjectSession(room.id, sessionId);
        }
      }
      return { inject: blocks.join("\n\n") };
    },

    getMemoryTrace: (slug: string, roomId?: string) => {
      const normalized = slug.trim();
      if (!normalized || !isValidRoomMemorySlug(normalized)) {
        return { found: false, slug: normalized, entries: [] };
      }
      const rooms = roomId
        ? (storage.getRoomMeta(roomId) ? [storage.getRoomMeta(roomId)!] : [])
        : storage.listRooms();
      for (const room of rooms) {
        const tracesDir = join(storage.roomMemoryDir(room.id), "traces");
        const entries = readTraceEntries(tracesDir, normalized);
        if (entries.length > 0) {
          return {
            found: true,
            room_id: room.id,
            room_name: room.name,
            slug: normalized,
            entries,
            text: formatTraceForDisplay(normalized, entries, room.name),
          };
        }
      }
      return {
        found: false,
        slug: normalized,
        entries: [],
        text: formatTraceForDisplay(normalized, []),
      };
    },

    getMemorySearch: (query: string) => {
      if (!query.trim()) return { results: [] };
      const all: ReturnType<typeof searchRoomMemoryEntries> = [];
      for (const room of storage.listRooms()) {
        const entries = storage.listRoomMemoryEntriesWithRaw(room.id);
        all.push(...searchRoomMemoryEntries(room.id, entries, query));
      }
      return { results: all.sort((a, b) => b.score - a.score).slice(0, 5) };
    },

    postDream: async () => {
      const rooms = storage.listRooms();
      if (rooms.length === 0) {
        throw new Error("ルームに参加していません");
      }
      const projectsDir = join(claudeHome, "projects");
      const sessions = readRecentSessionTranscripts(projectsDir);
      const miner = new DreamMiner(process.env.ANTHROPIC_API_KEY, config.dream?.model);
      const index = storage.readRoomMemoryIndex(rooms[0].id);
      const candidates = await miner.mine(sessions, index);
      storage.saveDreamPending(rooms[0].id, candidates);
      return {
        candidates,
        message:
          candidates.length > 0
            ? `チームの記憶を整理しました。${candidates.length} 件の候補があります。採用する項目を選んでください（/room dream accept または番号指定）。`
            : "直近のセッションから共有に値する知見は見つかりませんでした。",
      };
    },

    postDreamAccept: async (body: { ids?: string[]; indices?: number[] }) => {
      const rooms = storage.listRooms();
      if (rooms.length === 0) {
        throw new Error("ルームに参加していません");
      }
      const pending = storage.readDreamPending(rooms[0].id);
      if (!pending) {
        throw new Error("保留中の候補がありません。先に /room dream を実行してください。");
      }
      const candidates = pending.candidates as DreamCandidate[];
      let selected: DreamCandidate[];
      if (body?.ids?.length) {
        selected = candidates.filter((c) => body.ids!.includes(c.id));
      } else if (body?.indices?.length) {
        selected = body.indices
          .map((i) => candidates[i])
          .filter((c): c is DreamCandidate => !!c);
      } else {
        selected = candidates;
      }
      const titles: string[] = [];
      for (const c of selected) {
        const content = `${c.title}\n\n${c.body}`;
        for (const room of rooms) {
          rememberAndBroadcast(room, content);
        }
        titles.push(c.title);
      }
      storage.clearDreamPending(rooms[0].id);
      return {
        accepted: titles.length,
        titles,
        message: `✅ ${titles.length} 件をチームメモリに追加しました。`,
      };
    },

    postDreamQueue: async (body) => dreamQueue.enqueue(body),

    getDreamPending: () => {
      const proposals = storage.listRooms().flatMap((room) =>
        dreamPendingMergeService.listPendingProposalsForUser(room.id, room.name, identity),
      );
      return { total: proposals.length, proposals };
    },

    postDreamObjection: async (body: {
      room_id?: string;
      merge_id?: string;
      proposal_slug?: string;
      reason?: string;
    }) => {
      const rooms = storage.listRooms();
      if (rooms.length === 0) throw new Error("ルームに参加していません");
      const targets = body.room_id
        ? rooms.filter((r) => r.id === body.room_id)
        : rooms;
      if (targets.length === 0) throw new Error("ルームが見つかりません");
      let lastErrorMsg = "対象の提案が見つかりません";
      for (const room of targets) {
        const result = dreamPendingMergeService.recordObjection({
          roomId: room.id,
          identity,
          mergeId: body.merge_id,
          proposalSlug: body.proposal_slug,
          reason: body.reason,
        });
        if (result.ok) return result;
        if (result.message !== "対象の提案が見つかりません") {
          lastErrorMsg = result.message;
        }
      }
      throw new Error(lastErrorMsg);
    },

    postDreamHold: async (body: { room_id?: string; proposal_slug?: string }) => {
      if (typeof body?.proposal_slug !== "string") {
        throw new Error("proposal_slug is required");
      }
      const room = resolveTargetRoom(body.room_id);
      const dreamCfg = resolveDreamConfig(config.dream, room.dream);
      const result = dreamPendingMergeService.extendHold({
        roomId: room.id,
        identity,
        proposalSlug: body.proposal_slug,
        extensionHours: dreamCfg.objection_window_hours,
      });
      if (!result.ok) throw new Error(result.message);
      return result;
    },

    postDreamRevert: async (body?: { room_id?: string }) => {
      const roomId = resolveTargetRoom(body?.room_id).id;
      const result = dreamPendingMergeService.revertLastMerge(roomId);
      if (!result.ok) throw new Error(result.message);
      if (result.slugs) {
        broadcastRoomMemoryMerge(roomId, result.slugs, true);
        for (const slug of result.slugs) {
          broadcastMergedEntry(roomId, slug, { reverted: true });
        }
      }
      return result;
    },

    getDreamConfig: (roomId?: string) => {
      const room = resolveTargetRoom(roomId);
      const effective = resolveDreamConfig(config.dream, room.dream);
      const hostedBy = room.hosted_by ?? room.members[0];
      return {
        room_id: room.id,
        room_name: room.name,
        hosted_by: hostedBy,
        is_host: hostedBy === identity,
        room_override: room.dream ?? {},
        global_default: config.dream ?? {},
        effective,
        summary: formatDreamConfigSummary(effective),
      };
    },

    postDreamConfig: async (body) => {
      const room = resolveTargetRoom(body?.room_id as string | undefined);
      assertRoomHost(room);
      const patch = parseDreamRoomPatch(body);
      const updated = storage.updateRoomDream(room.id, patch);
      const effective = resolveDreamConfig(config.dream, updated.dream);
      return {
        ok: true,
        room_id: room.id,
        room_name: room.name,
        effective,
        summary: formatDreamConfigSummary(effective),
        message: `✅ ${room.name} のチームメモリ設定を更新しました`,
      };
    },

    postNotifyFile: async (body) => {
      if (typeof body?.file_path !== "string") {
        throw new Error("file_path must be a string");
      }
      // 成果物は Primary ルームのみへ（Watch は Read Only）。Private ON 中は pending に蓄積
      const primaryId = showState.getPrimaryRoomId();
      if (!primaryId || !storage.getRoomMeta(primaryId)) {
        return { queued: false, queued_rooms: [], sent: false };
      }
      if (showState.isPublic(primaryId)) {
        broadcastFileToRoom(body.file_path, primaryId);
        return { queued: false, queued_rooms: [], sent: true };
      }
      getPendingFiles(primaryId).push(body.file_path);
      return { queued: true, queued_rooms: [primaryId], sent: false };
    },

    postPrivate: async (body: { mode: "on" | "off" | "share" | "drop" }) => {
      const joined = storage.listRooms();
      if (joined.length === 0) {
        throw new Error("ルームに参加していません");
      }
      // idle 削除等で primary が無効化されていても share が空振りしないよう先に同期
      showState.syncValidRooms(joined.map((r) => r.id));
      const primaryId = showState.getPrimaryRoomId();
      const primaryName = primaryId ? (storage.getRoomMeta(primaryId)?.name ?? primaryId) : null;
      const pendingCount = primaryId
        ? getPendingTurns(primaryId).length + getPendingFiles(primaryId).length
        : 0;

      switch (body?.mode) {
        case "on": {
          showState.setPrivate(true);
          logger.info("Private ON（手元モード）");
          return { private: true, primary_room_name: primaryName, pending: pendingCount };
        }
        case "off": {
          // pending があれば share/drop を毎回選択（DEC-003: 自動 flush 禁止）
          if (pendingCount > 0) {
            return {
              private: true,
              needs_choice: true,
              pending: pendingCount,
              primary_room_name: primaryName,
              message: `手元に ${pendingCount} 件あります。share（送る）/ drop（捨てる）を選んでください`,
            };
          }
          showState.setPrivate(false);
          logger.info("Private OFF（公開中）");
          return { private: false, primary_room_name: primaryName, pending: 0 };
        }
        case "share": {
          if (primaryId && storage.getRoomMeta(primaryId)) {
            const turnsToShare = getPendingTurns(primaryId).splice(0);
            if (turnsToShare.length > 0) {
              enqueueSummary(turnsToShare, primaryId);
              await processingTurns;
            }
            getPendingFiles(primaryId).splice(0).forEach((fp) => broadcastFileToRoom(fp, primaryId));
          }
          showState.setPrivate(false);
          logger.info({ shared: pendingCount }, "pending を share して Private OFF");
          return { private: false, primary_room_name: primaryName, shared: pendingCount };
        }
        case "drop": {
          if (primaryId) {
            getPendingTurns(primaryId).splice(0);
            getPendingFiles(primaryId).splice(0);
          }
          showState.setPrivate(false);
          logger.info({ dropped: pendingCount }, "pending を drop して Private OFF");
          return { private: false, primary_room_name: primaryName, dropped: pendingCount };
        }
        default:
          throw new Error("mode must be on, off, share, or drop");
      }
    },

    postRoomSwitch: async (body: { room_id?: string; name?: string }) => {
      const joined = storage.listRooms();
      if (joined.length === 0) {
        throw new Error("ルームに参加していません");
      }
      let roomId = body.room_id;
      if (!roomId && body.name) {
        const byName = joined.find((r) => r.name === body.name);
        if (!byName) throw new Error(`Room "${body.name}" not found`);
        roomId = byName.id;
      }
      if (!roomId) {
        throw new Error("room_id or name is required");
      }
      if (!joined.some((r) => r.id === roomId)) {
        throw new Error("Room not joined");
      }
      showState.switchPrimary(roomId);
      const meta = storage.getRoomMeta(roomId);
      logger.info({ roomId }, "Primary を切替");
      return {
        ok: true,
        room_id: roomId,
        room_name: meta?.name ?? roomId,
        private: showState.isPrivate(),
      };
    },

    getDiscover: (() => {
      let lastQuery = 0;
      return () => {
        const now = Date.now();
        if (now - lastQuery > 2000) {
          lastQuery = now;
          discovery.query();
        }
        return { rooms: discovery.getDiscoveredRooms() };
      };
    })(),

    postRoomCreate: async (body) => {
      const name = body.name?.trim();
      if (!name || name.length > ROOM_NAME_MAX_LENGTH) {
        throw new Error(`Room name is required (max ${ROOM_NAME_MAX_LENGTH} chars)`);
      }
      if (/[,:]/u.test(name)) {
        throw new Error("Room name must not contain ':' or ','");
      }
      const roomId = generateId();
      const pin = generateRoomPin();
      const secret = pinToSecret(pin, name);
      const dream =
        body.dream && typeof body.dream === "object"
          ? sanitizeDreamRoomConfig(body.dream as Record<string, unknown>)
          : undefined;
      storage.createRoom({
        id: roomId,
        name,
        secret,
        pin,
        hosted_by: identity,
        members: [identity],
        created_at: new Date().toISOString(),
        dream: Object.keys(dream ?? {}).length > 0 ? dream : undefined,
      });
      server.registerRoom(roomId, secret);
      discovery.advertiseRoom(roomId, name, 1);
      // /room open は常に Primary。--quiet は入室時から Private ON（DEC-002）
      showState.onRoomJoin(roomId, { asPrimary: true });
      if (body.quiet === true) showState.setPrivate(true);
      const effective = resolveDreamConfig(config.dream, dream);
      return {
        room_id: roomId,
        name,
        pin,
        role: "primary",
        private: showState.isPrivate(),
        dream: effective,
        dream_summary: formatDreamConfigSummary(effective),
      };
    },

    postRoomJoin: async (body) => {
      if (!body?.name || !body?.pin) {
        throw new Error("name and pin are required");
      }
      const secret = pinToSecret(body.pin, body.name);
      const discovered = discovery.getDiscoveredRooms().find((r) => r.name === body.name);
      if (!discovered) {
        throw new Error(`Room "${body.name}" not found on LAN`);
      }
      const roomId = discovered.id;
      storage.createRoom({
        id: roomId,
        name: body.name,
        secret,
        pin: body.pin,
        hosted_by: discovered.hostedBy,
        members: [identity],
        created_at: new Date().toISOString(),
      });
      server.registerRoom(roomId, secret);
      peerConnector.connectToPeer(discovered.host, discovered.port, roomId, secret, discovered.hostedBy);
      // 最初のルームは Primary、2 部屋目以降は default Watch（DEC-001）
      showState.onRoomJoin(roomId);
      if (body.quiet === true) showState.setPrivate(true);
      const role = showState.getRole(roomId) ?? "watch";
      return { ok: true, room_id: roomId, name: body.name, role, private: showState.isPrivate() };
    },

    postNotifyToggle: async (body) => {
      const enabled = typeof body?.enabled === "boolean" ? body.enabled : !notifier.isEnabled();
      notifier.setEnabled(enabled);
      saveNotificationsEnabled(enabled);
      return { ok: true, enabled };
    },

    postShowFile: async (body: { share_type: FileShareType; filename: string; content: string }) => {
      if (!body?.share_type || !["skill", "command", "claude_md"].includes(body.share_type)) {
        throw new Error("share_type must be skill, command, or claude_md");
      }
      if (typeof body.filename !== "string" || !body.filename) {
        throw new Error("filename is required");
      }
      if (typeof body.content !== "string") {
        throw new Error("content is required");
      }
      const rooms = storage.listRooms();
      if (rooms.length === 0) {
        throw new Error("ルームに参加していません");
      }
      for (const room of rooms) {
        const msg: FileShareMessage = {
          v: PROTOCOL_VERSION,
          id: generateId(),
          ts: new Date().toISOString(),
          type: "file_share",
          room_id: room.id,
          sender: identity,
          share_type: body.share_type as "skill" | "command" | "claude_md",
          filename: body.filename,
          content: body.content,
        };
        server.broadcastMessage(room.id, msg);
        peerConnector.broadcastToRoom(room.id, msg, room.secret);
      }
      return { ok: true, filename: body.filename };
    },

    postRoomAccept: async (body: { pending_id: string }) => {
      if (!body?.pending_id) throw new Error("pending_id is required");
      const found = findPending(body.pending_id);
      if (!found) throw new Error("pending_id not found");
      const { roomId, entry } = found;
      mkdirSync(dirname(entry.save_path), { recursive: true });
      writeFileSync(entry.save_path, entry.content, { mode: 0o644 });
      storage.deletePending(roomId, body.pending_id);
      logger.info({ savePath: entry.save_path, type: entry.share_type }, "ファイル共有を承認・保存");
      return { ok: true, save_path: entry.save_path };
    },

    postRoomReject: async (body: { pending_id: string }) => {
      if (!body?.pending_id) throw new Error("pending_id is required");
      const found = findPending(body.pending_id);
      if (!found) throw new Error("pending_id not found");
      storage.deletePending(found.roomId, body.pending_id);
      logger.info({ pendingId: body.pending_id }, "ファイル共有を拒否");
      return { ok: true };
    },

    postRoomAdopt: async (body: { room_id: string }) => {
      if (!body?.room_id) throw new Error("room_id is required");
      const content = storage.readRoomClaudeMd(body.room_id);
      if (!content) throw new Error("Room-scoped CLAUDE.md が存在しません");
      const globalPath = join(claudeHome, "CLAUDE.md");
      mkdirSync(dirname(globalPath), { recursive: true });
      const existing = existsSync(globalPath) ? readFileSync(globalPath, "utf-8") : "";
      const separator = existing ? "\n\n" : "";
      writeFileSync(globalPath, existing + separator + content, { mode: 0o644 });
      logger.info({ globalPath, roomId: body.room_id }, "Room-scoped CLAUDE.md をグローバルに追記");
      return { ok: true, path: globalPath };
    },

    getRoomPending: () => {
      const rooms = storage.listRooms();
      const pending: Array<{ room_id: string; room_name: string; entries: unknown[] }> = [];
      for (const room of rooms) {
        const entries = storage.listPending(room.id);
        if (entries.length > 0) {
          pending.push({ room_id: room.id, room_name: room.name, entries });
        }
      }
      return { pending };
    },

    postMention: async (body) => {
      if (!body?.to || typeof body.to !== "string") {
        throw new Error("to is required");
      }
      if (typeof body.content !== "string" || !body.content) {
        throw new Error("content is required");
      }
      const rooms = storage.listRooms();
      if (rooms.length === 0) {
        throw new Error("ルームに参加していません");
      }
      const ts = new Date().toISOString();
      for (const room of rooms) {
        // context_summary は公開中（Primary かつ Private OFF）のみ同梱（DEC-004）
        const contextSummary = showState.isPublic(room.id)
          ? (storage.readContext(room.id, identity) ?? undefined)
          : undefined;
        const msg: MentionMessage = {
          v: PROTOCOL_VERSION,
          id: generateId(),
          ts,
          type: "mention",
          room_id: room.id,
          sender: identity,
          to: body.to,
          content: body.content,
          ...(contextSummary !== undefined && { context_summary: contextSummary }),
          ...(contextSummary !== undefined && { context_summary_ts: ts }),
        };
        server.broadcastMessage(room.id, msg);
        peerConnector.broadcastToRoom(room.id, msg, room.secret);
        logger.info({ to: body.to, roomId: room.id }, "@メンションを送信");
      }
      return { ok: true, to: body.to };
    },

    getUnread: () => {
      const rooms = storage.listRooms();
      const result: Array<{ room_id: string; room_name: string; mentions: unknown[] }> = [];
      let totalUnread = 0;
      for (const room of rooms) {
        const unread = storage.readMentions(room.id, true);
        totalUnread += unread.length;
        if (unread.length > 0) {
          result.push({ room_id: room.id, room_name: room.name, mentions: unread });
        }
      }
      return { total: totalUnread, rooms: result };
    },

    postUnreadMarkRead: async (body) => {
      if (!Array.isArray(body?.ids)) {
        throw new Error("ids must be an array");
      }
      const ids = body.ids as string[];
      for (const room of storage.listRooms()) {
        storage.markMentionsRead(room.id, ids);
      }
      return { ok: true, count: ids.length };
    },
  };

  const httpApi = new HttpApi(config.network.http_port, httpHandlers);

  // 起動
  server.start();
  discovery.start();
  httpApi.start();
  health.start();

  // Session ディレクトリを監視
  const sessionDir = join(claudeHome, "projects");
  watcher.start(sessionDir);

  // 定期クリーンアップ
  const cleanupInterval = setInterval(() => {
    try {
      storage.cleanup(config.storage);
      fileTransfer.cleanupTimedOut();
    } catch (err) {
      logger.error({ err }, "Failed to run periodic cleanup");
    }
  }, STORAGE_CLEANUP_INTERVAL_MS);

  logger.info(
    { port: config.network.port, http_port: config.network.http_port },
    "cc-room daemon ready",
  );

  // Graceful shutdown
  async function shutdown() {
    logger.info("Shutting down...");
    clearInterval(cleanupInterval);
    dreamMergeScanner.stop();
    dreamWorker.stop();
    roomLifecycle.stop();
    roomLifecycle.leaveAll();
    health.stop();
    watcher.stop();
    httpApi.stop();
    peerConnector.stop();
    discovery.stop();
    server.stop();
    try { unlinkSync(PID_PATH); } catch { /* ignore */ }
    process.exit(0);
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.on("uncaughtException", (err) => {
    logger.fatal({ err }, "Uncaught exception");
    shutdown();
  });
  process.on("unhandledRejection", (reason) => {
    logger.error({ reason }, "Unhandled rejection");
  });
}

const subcommand = process.argv[2];

if (subcommand === "mcp") {
  // MCP サーバーモード: Claude Code から stdio で呼ばれる
  runMcp().catch((err) => {
    logger.fatal({ err }, "Failed to start MCP server");
    process.exit(1);
  });
} else if (subcommand === "hook") {
  // Hook モード: Claude Code の hook から呼ばれる
  const hookName = process.argv[3];
  runHook(hookName).catch((err) => {
    logger.fatal({ err }, "Failed to run hook");
    process.exit(1);
  });
} else {
  // daemon モード（デフォルト）
  main().catch((err) => {
    logger.fatal({ err }, "Failed to start daemon");
    process.exit(1);
  });
}

async function runMcp(): Promise<void> {
  const { startMcpServer } = await import("./mcp-server.js");
  const config = loadConfig();
  const httpPort = config.network.http_port;
  const baseUrl = `http://127.0.0.1:${httpPort}`;

  async function fetchJson(path: string): Promise<unknown> {
    const res = await fetch(`${baseUrl}${path}`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function postJson(path: string, body: unknown): Promise<unknown> {
    const res = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  // /status から roomId→name マップを構築（StorageManager への直接アクセスを回避）
  async function getRoomNames(): Promise<Record<string, string>> {
    const status = await fetchJson("/status") as { rooms: Array<{ id: string; name: string }> };
    return Object.fromEntries(status.rooms.map((r) => [r.id, r.name]));
  }

  await startMcpServer({
    getStatus: async () => {
      const data = await fetchJson("/status") as { identity: string; rooms: Array<{ id: string; name: string; members: string[]; connected: string[] }> };
      if (!data.rooms.length) return "ルームに参加していません。";
      return data.rooms.map((r) =>
        `ルーム: ${r.name} (${r.id})\nメンバー: ${r.members.join(", ")}\n接続中: ${r.connected.join(", ") || "なし"}`
      ).join("\n\n");
    },
    getContext: async () => {
      const [data, roomNames] = await Promise.all([
        fetchJson("/context") as Promise<Record<string, Record<string, string>>>,
        getRoomNames(),
      ]);
      const lines: string[] = [];
      for (const [roomId, contexts] of Object.entries(data)) {
        lines.push(`## ${roomNames[roomId] ?? roomId}`);
        for (const [member, summary] of Object.entries(contexts)) {
          lines.push(`### ${member}\n${summary}`);
        }
      }
      return lines.length ? lines.join("\n\n") : "コンテキストがありません。";
    },
    getMessages: async () => {
      const [data, roomNames] = await Promise.all([
        fetchJson("/messages") as Promise<Record<string, Array<{ ts: string; from: string; content?: string; type: string }>>>,
        getRoomNames(),
      ]);
      const lines: string[] = [];
      for (const [roomId, msgs] of Object.entries(data)) {
        const recent = msgs.slice(-20);
        if (recent.length) {
          lines.push(`## ${roomNames[roomId] ?? roomId}`);
          for (const m of recent) {
            lines.push(`[${m.ts}] ${m.from}: ${m.content ?? `(${m.type})`}`);
          }
        }
      }
      return lines.length ? lines.join("\n") : "メッセージはありません。";
    },
    getFiles: async () => {
      const [data, roomNames] = await Promise.all([
        fetchJson("/files") as Promise<Record<string, Array<{ name: string; size: number }>>>,
        getRoomNames(),
      ]);
      const lines: string[] = [];
      for (const [roomId, files] of Object.entries(data)) {
        if (files.length) {
          lines.push(`## ${roomNames[roomId] ?? roomId}`);
          for (const f of files) {
            lines.push(`- ${f.name} (${f.size} bytes)`);
          }
        }
      }
      return lines.length ? lines.join("\n") : "共有ファイルはありません。";
    },
    getUnread: async () => {
      const data = await fetchJson("/unread") as {
        total: number;
        rooms: Array<{
          room_id: string;
          room_name: string;
          mentions: Array<{ id: string; from: string; to: string; content: string; context_summary?: string; context_summary_ts?: string; ts: string }>;
        }>;
      };
      if (data.total === 0) return "未読の@メンションはありません。";
      const lines: string[] = [`未読 ${data.total} 件:`];
      const allIds: string[] = [];
      for (const room of data.rooms) {
        lines.push(`\n## ${room.room_name}`);
        for (const m of room.mentions) {
          allIds.push(m.id);
          lines.push(`[${m.ts}] @${m.from} → ${m.to}: ${m.content}`);
          if (m.context_summary) {
            lines.push(`  作業状況: ${m.context_summary}`);
          }
        }
      }
      // 取得と同時に既読にする
      if (allIds.length > 0) {
        await postJson("/unread/mark-read", { ids: allIds }).catch(() => {});
      }
      return lines.join("\n");
    },
    invite: async (name: string) => {
      const data = await postJson("/invite", { name }) as { room_id: string; secret: string; message: string };
      return `${data.message}\n\nroom_id: ${data.room_id}\nsecret: ${data.secret}`;
    },
    share: async (message: string) => {
      await postJson("/share", { message });
      return `共有しました: ${message}`;
    },
    memorySearch: async (query: string) => {
      const data = await fetchJson(`/memory/search?q=${encodeURIComponent(query)}`) as {
        results: Array<{ slug: string; description: string; body: string; category: string | null; score: number }>;
      };
      if (!data.results.length) return `「${query}」に一致するチームメモリはありません。`;
      return data.results
        .map(
          (r, i) =>
            `${i + 1}. [${r.slug}] ${r.description}${r.category ? ` (${r.category})` : ""}\n${r.body}`,
        )
        .join("\n\n");
    },
    memoryTrace: async (entryName: string) => {
      const data = await fetchJson(
        `/memory/trace?slug=${encodeURIComponent(entryName)}`,
      ) as { text?: string; found?: boolean };
      return data.text ?? `「${entryName}」の L2 原典（trace）は見つかりません。`;
    },
    dream: async () => {
      const data = await postJson("/dream", {}) as {
        message: string;
        candidates: Array<{ id: string; title: string; body: string; category: string; confidence: number }>;
      };
      if (!data.candidates?.length) return data.message;
      const lines = data.candidates.map(
        (c, i) => `${i}. [${c.category}] ${c.title} (confidence: ${c.confidence})\n   ${c.body.slice(0, 120)}`,
      );
      return `${data.message}\n\n${lines.join("\n\n")}\n\n採用: POST /dream/accept に indices を指定`;
    },
  });
}

async function runHook(hookName: string): Promise<void> {
  const config = loadConfig();
  const httpPort = config.network.http_port;

  if (hookName === "post-tool-use") {
    const { handlePostToolUse } = await import("./hooks/post-tool-use.js");
    await handlePostToolUse(httpPort);
  } else if (hookName === "user-prompt-submit") {
    const { handleUserPromptSubmit } = await import("./hooks/user-prompt-submit.js");
    await handleUserPromptSubmit(httpPort);
  } else if (hookName === "session-stop") {
    const { handleSessionStop } = await import("./hooks/session-stop.js");
    await handleSessionStop(httpPort);
  } else {
    logger.warn({ hookName }, "Unknown hook name");
    process.exit(1);
  }
}
