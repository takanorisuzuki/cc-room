import WebSocket from "ws";
import { EventEmitter } from "node:events";
import {
  RECONNECT_BASE_DELAY_MS,
  RECONNECT_MAX_DELAY_MS,
  RECONNECT_MAX_ATTEMPTS,
  RECONNECT_JITTER,
  PING_INTERVAL_MS,
  createAuthResponse,
  createSignedEnvelope,
  verifySignedEnvelope,
  PROTOCOL_VERSION,
} from "@cc-room/shared";
import type { AnyProtocolMessage, SignedEnvelope } from "@cc-room/shared";
import { createChildLogger } from "./logger.js";

const log = createChildLogger("peer-connector");

interface PeerConnection {
  ws: WebSocket;
  host: string;
  port: number;
  roomId: string;
  secret: string;
  peerIdentity: string;
  reconnectAttempts: number;
  pingInterval: ReturnType<typeof setInterval> | null;
  skipReconnect?: boolean;
}

export class PeerConnector extends EventEmitter {
  private connections = new Map<string, PeerConnection>();
  private identity: string;
  private stopped = false;

  constructor(identity: string) {
    super();
    this.identity = identity;
  }

  connectToPeer(host: string, port: number, roomId: string, secret: string, peerIdentity: string): void {
    const key = `${peerIdentity}:${roomId}`;
    if (this.connections.has(key)) return;

    this.initiateConnection(host, port, roomId, secret, peerIdentity, 0);
  }

  private initiateConnection(host: string, port: number, roomId: string, secret: string, peerIdentity: string, attempt: number): void {
    if (this.stopped) return;
    const key = `${peerIdentity}:${roomId}`;

    const url = `ws://${host}:${port}`;

    log.info({ url, roomId, peerIdentity, attempt }, "Connecting to peer");

    const ws = new WebSocket(url);

    const conn: PeerConnection = {
      ws,
      host,
      port,
      roomId,
      secret,
      peerIdentity,
      reconnectAttempts: attempt,
      pingInterval: null,
    };
    this.connections.set(key, conn);

    ws.on("open", () => {
      log.info({ peerIdentity, roomId }, "WebSocket connected, waiting for challenge");
    });

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        this.handleMessage(conn, msg);
      } catch (err) {
        log.error({ err }, "Failed to parse peer message");
      }
    });

    ws.on("close", () => {
      this.cleanupConnection(conn);
      this.connections.delete(key);
      this.emit("peer_disconnect", peerIdentity, roomId);

      if (!this.stopped && !conn.skipReconnect && attempt < RECONNECT_MAX_ATTEMPTS) {
        const delay = this.getReconnectDelay(attempt);
        log.info({ peerIdentity, delay, attempt }, "Scheduling reconnect");
        setTimeout(() => {
          this.initiateConnection(host, port, roomId, secret, peerIdentity, attempt + 1);
        }, delay);
      }
    });

    ws.on("error", (err) => {
      log.error({ err, peerIdentity }, "Peer WebSocket error");
    });
  }

  private handleMessage(conn: PeerConnection, msg: Record<string, unknown>): void {
    if (!msg || typeof msg !== "object") {
      log.warn("Received invalid message format from peer");
      return;
    }

    if (msg.type === "challenge") {
      const nonce = msg.nonce as string;
      const response = createAuthResponse(conn.secret, nonce, this.identity);
      conn.ws.send(JSON.stringify({
        type: "auth",
        identity: this.identity,
        response,
        room_id: conn.roomId,
        supported_versions: [PROTOCOL_VERSION],
      }));
      return;
    }

    if (msg.type === "auth_ok") {
      log.info({ peerIdentity: conn.peerIdentity }, "Authenticated with peer");
      conn.reconnectAttempts = 0;
      conn.pingInterval = setInterval(() => {
        if (conn.ws.readyState === WebSocket.OPEN) {
          conn.ws.send(JSON.stringify({ type: "ping" }));
        }
      }, PING_INTERVAL_MS);
      this.emit("peer_connect", conn.peerIdentity, conn.roomId);
      return;
    }

    if (msg.type === "auth_fail") {
      log.warn({ peerIdentity: conn.peerIdentity, reason: msg.reason }, "Auth failed with peer");
      conn.skipReconnect = true;
      conn.ws.close();
      return;
    }

    if (msg.type === "ping") {
      conn.ws.send(JSON.stringify({ type: "pong" }));
      return;
    }

    if (msg.type === "pong") return;

    if ("payload" in msg && "sig" in msg && "sender" in msg) {
      const envelope = msg as unknown as SignedEnvelope;
      const verified = verifySignedEnvelope(conn.secret, envelope);
      if (verified) {
        this.emit("message", verified as AnyProtocolMessage, envelope.sender);
      } else {
        log.warn({ sender: envelope.sender }, "Invalid signature from peer");
      }
    }
  }

  sendToPeer(peerIdentity: string, roomId: string, message: AnyProtocolMessage, secret: string): boolean {
    const key = `${peerIdentity}:${roomId}`;
    const conn = this.connections.get(key);
    if (!conn || conn.ws.readyState !== WebSocket.OPEN) return false;

    const envelope = createSignedEnvelope(secret, this.identity, message);
    conn.ws.send(JSON.stringify(envelope));
    return true;
  }

  broadcastToRoom(roomId: string, message: AnyProtocolMessage, secret: string): void {
    const envelope = createSignedEnvelope(secret, this.identity, message);
    for (const conn of this.connections.values()) {
      if (conn.roomId !== roomId) continue;
      if (conn.ws.readyState !== WebSocket.OPEN) continue;
      try {
        conn.ws.send(JSON.stringify(envelope));
      } catch (err) {
        log.error({ peerIdentity: conn.peerIdentity, err }, "Failed to send to peer");
      }
    }
  }

  getConnectedPeers(roomId: string): string[] {
    const peers: string[] = [];
    for (const conn of this.connections.values()) {
      if (conn.roomId === roomId && conn.ws.readyState === WebSocket.OPEN) {
        peers.push(conn.peerIdentity);
      }
    }
    return peers;
  }

  isConnectedTo(peerIdentity: string, roomId: string): boolean {
    const key = `${peerIdentity}:${roomId}`;
    const conn = this.connections.get(key);
    return conn?.ws.readyState === WebSocket.OPEN || false;
  }

  /** 退室時: 再接続せずに当該ルームの outbound を切る */
  disconnectRoom(roomId: string): void {
    for (const [key, conn] of [...this.connections.entries()]) {
      if (conn.roomId !== roomId) continue;
      conn.skipReconnect = true;
      this.cleanupConnection(conn);
      if (conn.ws.readyState === WebSocket.OPEN || conn.ws.readyState === WebSocket.CONNECTING) {
        conn.ws.close(1000, "Left room");
      }
      this.connections.delete(key);
    }
  }

  private cleanupConnection(conn: PeerConnection): void {
    if (conn.pingInterval) {
      clearInterval(conn.pingInterval);
      conn.pingInterval = null;
    }
  }

  private getReconnectDelay(attempt: number): number {
    const base = Math.min(RECONNECT_BASE_DELAY_MS * Math.pow(2, attempt), RECONNECT_MAX_DELAY_MS);
    const jitter = base * RECONNECT_JITTER * (Math.random() * 2 - 1);
    return Math.max(0, base + jitter);
  }

  stop(): void {
    this.stopped = true;
    for (const conn of this.connections.values()) {
      this.cleanupConnection(conn);
      conn.ws.close(1001, "Shutting down");
    }
    this.connections.clear();
    log.info("Peer connector stopped");
  }
}
