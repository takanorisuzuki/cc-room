import { WebSocket } from "ws";
import { EventEmitter } from "node:events";
import {
  RECONNECT_BASE_DELAY_MS,
  RECONNECT_MAX_DELAY_MS,
  RECONNECT_MAX_ATTEMPTS,
  RECONNECT_JITTER,
  PING_INTERVAL_MS,
  PING_MISS_THRESHOLD,
  createSignedEnvelope,
  verifySignedEnvelope,
} from "@cc-room/shared";
import type { SignedEnvelope, PeerState, AnyProtocolMessage } from "@cc-room/shared";
import { buildAuthMessage } from "./auth.js";
import { createChildLogger } from "./logger.js";

const log = createChildLogger("connection");

export interface PeerConnectionOptions {
  host: string;
  port: number;
  identity: string;
  roomId: string;
  roomSecret: string;
  localIdentity: string;
}

export class PeerConnection extends EventEmitter {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private missedPongs = 0;
  private outboundQueue: SignedEnvelope[] = [];
  private _state: PeerState = "offline";
  private closed = false;
  private pendingNonce: string | null = null;

  readonly peerIdentity: string;
  private readonly host: string;
  private readonly port: number;
  private readonly roomId: string;
  private readonly roomSecret: string;
  private readonly localIdentity: string;

  constructor(opts: PeerConnectionOptions) {
    super();
    this.peerIdentity = opts.identity;
    this.host = opts.host;
    this.port = opts.port;
    this.roomId = opts.roomId;
    this.roomSecret = opts.roomSecret;
    this.localIdentity = opts.localIdentity;
  }

  get state(): PeerState {
    return this._state;
  }

  async connect(): Promise<void> {
    if (this.closed) return;

    const url = `ws://${this.host}:${this.port}`;
    log.info({ peer: this.peerIdentity, url }, "Connecting to peer");

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);

      const timeout = setTimeout(() => {
        this.ws?.terminate();
        reject(new Error("Connection timeout"));
      }, 10_000);

      this.ws.on("open", () => {
        clearTimeout(timeout);
        log.info({ peer: this.peerIdentity }, "WebSocket connected, awaiting challenge");
      });

      this.ws.on("message", (data) => {
        try {
          const parsed = JSON.parse(data.toString());
          this.handleRawMessage(parsed, resolve);
        } catch (err) {
          log.error({ err }, "Failed to parse message");
        }
      });

      this.ws.on("close", (code, reason) => {
        clearTimeout(timeout);
        log.warn(
          { peer: this.peerIdentity, code, reason: reason.toString() },
          "Connection closed",
        );
        this.handleDisconnect();
      });

      this.ws.on("error", (err) => {
        clearTimeout(timeout);
        log.error({ peer: this.peerIdentity, err }, "Connection error");
        reject(err);
      });
    });
  }

  private handleRawMessage(msg: unknown, onAuthOk?: (value: void) => void): void {
    if (typeof msg !== "object" || msg === null) return;

    const raw = msg as Record<string, unknown>;

    if (raw.type === "challenge") {
      this.pendingNonce = raw.nonce as string;
      const authMsg = buildAuthMessage(
        this.roomSecret,
        this.pendingNonce,
        this.localIdentity,
        this.roomId,
      );
      this.ws?.send(JSON.stringify(authMsg));
      return;
    }

    if (raw.type === "auth_ok") {
      this.setState("online");
      this.startPingPong();
      this.flushQueue();
      onAuthOk?.();
      return;
    }

    if (raw.type === "auth_fail") {
      log.error({ reason: raw.reason }, "Auth rejected by peer");
      this.ws?.close();
      return;
    }

    if (raw.type === "ping") {
      this.ws?.send(JSON.stringify({ type: "pong" }));
      return;
    }

    if (raw.type === "pong") {
      this.missedPongs = 0;
      return;
    }

    if ("payload" in raw && "sig" in raw && "sender" in raw) {
      const envelope = raw as unknown as SignedEnvelope;
      const verified = verifySignedEnvelope(this.roomSecret, envelope);
      if (!verified) {
        log.warn({ sender: envelope.sender }, "Invalid signature, dropping message");
        return;
      }
      this.emit("message", verified as AnyProtocolMessage);
    }
  }

  send(message: AnyProtocolMessage): void {
    const envelope = createSignedEnvelope(
      this.roomSecret,
      this.localIdentity,
      message,
    );

    if (this._state !== "online" || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.outboundQueue.push(envelope);
      return;
    }

    this.ws.send(JSON.stringify(envelope));
  }

  private flushQueue(): void {
    while (this.outboundQueue.length > 0) {
      const envelope = this.outboundQueue.shift()!;
      this.ws?.send(JSON.stringify(envelope));
    }
  }

  private startPingPong(): void {
    this.pingInterval = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      this.missedPongs++;
      if (this.missedPongs >= PING_MISS_THRESHOLD) {
        log.warn({ peer: this.peerIdentity }, "Ping timeout, disconnecting");
        this.ws.terminate();
        return;
      }
      this.ws.send(JSON.stringify({ type: "ping" }));
    }, PING_INTERVAL_MS);
  }

  private handleDisconnect(): void {
    this.stopPingPong();
    if (this.closed) return;
    this.setState("disconnected");
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= RECONNECT_MAX_ATTEMPTS) {
      log.warn(
        { peer: this.peerIdentity, attempts: this.reconnectAttempts },
        "Max reconnect attempts reached, marking offline",
      );
      this.setState("offline");
      this.emit("offline");
      return;
    }

    const delay = this.getBackoffDelay();
    log.info(
      { peer: this.peerIdentity, attempt: this.reconnectAttempts + 1, delay },
      "Scheduling reconnect",
    );

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectAttempts++;
      try {
        await this.connect();
        this.reconnectAttempts = 0;
      } catch (err) {
        log.error({ peer: this.peerIdentity, err }, "Reconnect failed");
      }
    }, delay);
  }

  private getBackoffDelay(): number {
    const base = RECONNECT_BASE_DELAY_MS;
    const delay = Math.min(
      base * Math.pow(2, this.reconnectAttempts),
      RECONNECT_MAX_DELAY_MS,
    );
    const jitter = 1 - RECONNECT_JITTER + Math.random() * RECONNECT_JITTER * 2;
    return Math.floor(delay * jitter);
  }

  private setState(state: PeerState): void {
    if (this._state === state) return;
    this._state = state;
    this.emit("state", state);
  }

  private stopPingPong(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    this.missedPongs = 0;
  }

  close(): void {
    this.closed = true;
    this.stopPingPong();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setState("offline");
  }
}
