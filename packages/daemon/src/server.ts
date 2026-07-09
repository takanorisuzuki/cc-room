import { WebSocketServer, WebSocket } from "ws";
import { EventEmitter } from "node:events";
import {
  AUTH_TIMEOUT_MS,
  PING_INTERVAL_MS,
  createSignedEnvelope,
  verifySignedEnvelope,
} from "@cc-room/shared";
import type { SignedEnvelope, AnyProtocolMessage } from "@cc-room/shared";
import { createChallenge, verifyAuth } from "./auth.js";
import { createChildLogger } from "./logger.js";
import type { Config } from "./config.js";

const log = createChildLogger("server");

interface AuthenticatedClient {
  ws: WebSocket;
  identity: string;
  roomId: string;
  authenticatedAt: number;
}

export class RoomServer extends EventEmitter {
  private wss: WebSocketServer | null = null;
  private clients = new Map<string, AuthenticatedClient>();
  private roomSecrets = new Map<string, string>();
  private config: Config;
  private pingInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config: Config) {
    super();
    this.config = config;
  }

  registerRoom(roomId: string, secret: string): void {
    this.roomSecrets.set(roomId, secret);
  }

  unregisterRoom(roomId: string): void {
    this.roomSecrets.delete(roomId);
    for (const [, client] of this.clients) {
      if (client.roomId === roomId) {
        client.ws.close(1001, "Room closed");
      }
    }
  }

  start(): void {
    this.wss = new WebSocketServer({ port: this.config.network.port });

    this.wss.on("connection", (ws) => {
      this.handleNewConnection(ws);
    });

    this.wss.on("listening", () => {
      log.info({ port: this.config.network.port }, "WebSocket server listening");
    });

    this.startPingBroadcast();
  }

  private handleNewConnection(ws: WebSocket): void {
    const { nonce, message } = createChallenge();
    ws.send(JSON.stringify(message));

    const authTimeout = setTimeout(() => {
      log.warn("Auth timeout, closing connection");
      ws.close(4001, "Auth timeout");
    }, AUTH_TIMEOUT_MS);

    let authenticated = false;

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());

        if (!authenticated) {
          if (msg.type === "auth") {
            clearTimeout(authTimeout);
            this.handleAuth(ws, nonce, msg);
            authenticated = true;
          }
          return;
        }

        if (msg.type === "ping") {
          ws.send(JSON.stringify({ type: "pong" }));
          return;
        }

        if (msg.type === "pong") {
          return;
        }

        if ("payload" in msg && "sig" in msg && "sender" in msg) {
          const client = this.findClientByWs(ws);
          if (!client) return;

          const secret = this.roomSecrets.get(client.roomId);
          if (!secret) return;

          const verified = verifySignedEnvelope(secret, msg as SignedEnvelope);
          if (!verified) {
            log.warn({ sender: msg.sender }, "Invalid signature from client");
            return;
          }

          this.emit("message", verified as AnyProtocolMessage, client.identity);
          this.broadcast(client.roomId, msg as SignedEnvelope, client.identity);
        }
      } catch (err) {
        log.error({ err }, "Failed to process message");
      }
    });

    ws.on("close", () => {
      clearTimeout(authTimeout);
      const client = this.findClientByWs(ws);
      if (client) {
        log.info({ identity: client.identity }, "Client disconnected");
        this.clients.delete(client.identity);
        this.emit("peer_disconnect", client.identity, client.roomId);
      }
    });

    ws.on("error", (err) => {
      log.error({ err }, "Client WebSocket error");
    });
  }

  private handleAuth(ws: WebSocket, nonce: string, authMsg: { identity: string; response: string; room_id: string; supported_versions?: number[] }): void {
    const roomId = authMsg.room_id;
    const secret = this.roomSecrets.get(roomId);

    if (!secret) {
      ws.send(JSON.stringify({
        type: "auth_fail",
        reason: "Room not found",
      }));
      ws.close(4003, "Room not found");
      return;
    }

    if (this.clients.has(authMsg.identity)) {
      ws.send(JSON.stringify({
        type: "auth_fail",
        reason: "Identity already connected",
      }));
      ws.close(4004, "Duplicate identity");
      return;
    }

    const result = verifyAuth(secret, nonce, authMsg as never);

    if (!result.success) {
      ws.send(JSON.stringify({
        type: "auth_fail",
        reason: result.reason,
      }));
      ws.close(4001, "Auth failed");
      return;
    }

    const client: AuthenticatedClient = {
      ws,
      identity: authMsg.identity,
      roomId,
      authenticatedAt: Date.now(),
    };
    this.clients.set(authMsg.identity, client);

    const members = Array.from(this.clients.values())
      .filter((c) => c.roomId === roomId)
      .map((c) => c.identity);

    ws.send(JSON.stringify({
      type: "auth_ok",
      members,
    }));

    log.info({ identity: authMsg.identity, roomId }, "Client authenticated");
    this.emit("peer_connect", authMsg.identity, roomId);
  }

  sendTo(identity: string, message: AnyProtocolMessage): boolean {
    const client = this.clients.get(identity);
    if (!client) return false;

    const secret = this.roomSecrets.get(client.roomId);
    if (!secret) return false;

    const envelope = createSignedEnvelope(
      secret,
      this.config.identity.name,
      message,
    );
    client.ws.send(JSON.stringify(envelope));
    return true;
  }

  broadcast(roomId: string, envelope: SignedEnvelope, excludeIdentity?: string): void {
    for (const client of this.clients.values()) {
      if (client.roomId !== roomId) continue;
      if (client.identity === excludeIdentity) continue;
      if (client.ws.readyState !== WebSocket.OPEN) continue;
      try {
        client.ws.send(JSON.stringify(envelope));
      } catch (err) {
        log.error({ identity: client.identity, err }, "Failed to send broadcast message");
      }
    }
  }

  broadcastMessage(roomId: string, message: AnyProtocolMessage, excludeIdentity?: string): void {
    const secret = this.roomSecrets.get(roomId);
    if (!secret) return;

    const envelope = createSignedEnvelope(
      secret,
      this.config.identity.name,
      message,
    );
    this.broadcast(roomId, envelope, excludeIdentity);
  }

  isListening(): boolean {
    return this.wss !== null;
  }

  getConnectedPeers(roomId: string): string[] {
    return Array.from(this.clients.values())
      .filter((c) => c.roomId === roomId)
      .map((c) => c.identity);
  }

  private findClientByWs(ws: WebSocket): AuthenticatedClient | undefined {
    for (const client of this.clients.values()) {
      if (client.ws === ws) return client;
    }
    return undefined;
  }

  private startPingBroadcast(): void {
    this.pingInterval = setInterval(() => {
      for (const client of this.clients.values()) {
        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.send(JSON.stringify({ type: "ping" }));
        }
      }
    }, PING_INTERVAL_MS);
  }

  stop(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    for (const client of this.clients.values()) {
      client.ws.close(1001, "Server shutting down");
    }
    this.clients.clear();
    this.wss?.close();
    this.wss = null;
    log.info("WebSocket server stopped");
  }
}
