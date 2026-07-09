import { createServer, IncomingMessage, ServerResponse } from "node:http";
import type { DreamRoomConfig, FileShareType } from "@cc-room/shared";
import { createChildLogger } from "./logger.js";

const log = createChildLogger("http-api");

export interface HttpApiHandlers {
  getHealth: () => object;
  getStatus: () => object;
  getContext: () => object;
  getMessages: () => object;
  getFiles: () => object;
  getDiscover: () => object;
  postInvite: (body: { name: string }) => Promise<object>;
  postJoin: (body: { room_id: string; secret: string }) => Promise<object>;
  postLeave: (body: { room_id: string }) => Promise<object>;
  postShare: (body: { message: string; room_id?: string }) => Promise<object>;
  postMemory: (body: { content: string; session_id?: string }) => Promise<object>;
  getMemoryInject: (sessionId: string) => object;
  getMemoryTrace: (slug: string, roomId?: string) => object;
  getMemorySearch: (query: string) => object;
  postDream: () => Promise<object>;
  postDreamAccept: (body: { ids?: string[]; indices?: number[] }) => Promise<object>;
  postDreamQueue: (body: { session_id: string; cwd?: string; ts?: string }) => Promise<object>;
  getDreamPending: () => object;
  postDreamObjection: (body: {
    room_id?: string;
    merge_id?: string;
    proposal_slug?: string;
    reason?: string;
  }) => Promise<object>;
  postDreamHold: (body: { room_id?: string; proposal_slug?: string }) => Promise<object>;
  postDreamRevert: (body?: { room_id?: string }) => Promise<object>;
  getDreamConfig: (roomId?: string) => object;
  postDreamConfig: (body: Record<string, unknown>) => Promise<object>;
  postNotifyFile: (body: { file_path: string }) => Promise<object>;
  postPrivate: (body: { mode: "on" | "off" | "share" | "drop" }) => Promise<object>;
  postRoomSwitch: (body: { room_id?: string; name?: string }) => Promise<object>;
  postRoomCreate: (body: {
    name: string;
    quiet?: boolean;
    dream?: DreamRoomConfig;
  }) => Promise<object>;
  postRoomJoin: (body: { name: string; pin: string; quiet?: boolean }) => Promise<object>;
  postNotifyToggle: (body: { enabled: boolean }) => Promise<object>;
  postShowFile: (body: { share_type: FileShareType; filename: string; content: string }) => Promise<object>;
  postRoomAccept: (body: { pending_id: string }) => Promise<object>;
  postRoomReject: (body: { pending_id: string }) => Promise<object>;
  postRoomAdopt: (body: { room_id: string }) => Promise<object>;
  getRoomPending: () => object;
  postMention: (body: { to: string; content: string }) => Promise<object>;
  getUnread: () => object;
  postUnreadMarkRead: (body: { ids: string[] }) => Promise<object>;
}

export class HttpApi {
  private server: ReturnType<typeof createServer> | null = null;
  private handlers: HttpApiHandlers;
  private port: number;

  constructor(port: number, handlers: HttpApiHandlers) {
    this.port = port;
    this.handlers = handlers;
  }

  start(): void {
    this.server = createServer((req, res) => {
      this.handleRequest(req, res);
    });

    this.server.listen(this.port, "127.0.0.1", () => {
      log.info({ port: this.port }, "HTTP API listening (localhost only)");
    });
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url || "/";
    const method = req.method || "GET";

    try {
      if (method === "GET") {
        const result = this.handleGet(url);
        if (result) {
          this.json(res, 200, result);
          return;
        }
      }

      if (method === "POST") {
        const body = await this.readBody(req);
        const result = await this.handlePost(url, body);
        if (result) {
          this.json(res, 200, result);
          return;
        }
      }

      this.json(res, 404, { error: "Not found" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal error";
      log.error({ err, url, method }, "Request failed");
      this.json(res, 500, { error: message });
    }
  }

  private handleGet(url: string): object | null {
    switch (url) {
      case "/health":
        return this.handlers.getHealth();
      case "/status":
        return this.handlers.getStatus();
      case "/context":
        return this.handlers.getContext();
      case "/messages":
        return this.handlers.getMessages();
      case "/files":
        return this.handlers.getFiles();
      case "/room/discover":
        return this.handlers.getDiscover();
      case "/room/pending":
        return this.handlers.getRoomPending();
      case "/unread":
        return this.handlers.getUnread();
      default: {
        try {
          const parsedUrl = new URL(url, "http://127.0.0.1");
          if (parsedUrl.pathname === "/memory/inject") {
            const sessionId = parsedUrl.searchParams.get("session_id");
            if (sessionId) {
              return this.handlers.getMemoryInject(sessionId);
            }
          }
          if (parsedUrl.pathname === "/memory/search") {
            const query = parsedUrl.searchParams.get("q") ?? "";
            return this.handlers.getMemorySearch(query);
          }
          if (parsedUrl.pathname === "/memory/trace") {
            const slug = parsedUrl.searchParams.get("slug") ?? "";
            const roomId = parsedUrl.searchParams.get("room_id") || undefined;
            return this.handlers.getMemoryTrace(slug, roomId);
          }
          if (parsedUrl.pathname === "/dream/pending") {
            return this.handlers.getDreamPending();
          }
          if (parsedUrl.pathname === "/dream/config") {
            const roomId = parsedUrl.searchParams.get("room_id") ?? undefined;
            return this.handlers.getDreamConfig(roomId || undefined);
          }
        } catch {
          // invalid URL — fall through to 404
        }
        return null;
      }
    }
  }

  private async handlePost(url: string, body: unknown): Promise<object | null> {
    const data = body as Record<string, unknown>;
    switch (url) {
      case "/invite":
        return this.handlers.postInvite(data as { name: string });
      case "/join":
        return this.handlers.postJoin(data as { room_id: string; secret: string });
      case "/leave":
        return this.handlers.postLeave(data as { room_id: string });
      case "/share":
        return this.handlers.postShare(data as { message: string; room_id?: string });
      case "/memory":
        return this.handlers.postMemory(data as { content: string; session_id?: string });
      case "/dream":
        return this.handlers.postDream();
      case "/dream/accept":
        return this.handlers.postDreamAccept(data as { ids?: string[]; indices?: number[] });
      case "/dream/queue":
        return this.handlers.postDreamQueue(
          data as { session_id: string; cwd?: string; ts?: string },
        );
      case "/dream/objection":
        return this.handlers.postDreamObjection(
          data as {
            room_id?: string;
            merge_id?: string;
            proposal_slug?: string;
            reason?: string;
          },
        );
      case "/dream/hold":
        return this.handlers.postDreamHold(
          data as { room_id?: string; proposal_slug?: string },
        );
      case "/dream/revert":
        return this.handlers.postDreamRevert(data as { room_id?: string });
      case "/dream/config":
        return this.handlers.postDreamConfig(data as Record<string, unknown>);
      case "/notify-file":
        return this.handlers.postNotifyFile(data as { file_path: string });
      case "/private":
        return this.handlers.postPrivate(data as { mode: "on" | "off" | "share" | "drop" });
      case "/room/switch":
        return this.handlers.postRoomSwitch(data as { room_id?: string; name?: string });
      case "/room/focus":
        // 互換: 旧 /room/focus は /room/switch と同義（DEC-005）
        return this.handlers.postRoomSwitch(data as { room_id?: string; name?: string });
      case "/room/create":
        return this.handlers.postRoomCreate(data as { name: string; quiet?: boolean });
      case "/room/join":
        return this.handlers.postRoomJoin(data as { name: string; pin: string; quiet?: boolean });
      case "/notify/toggle":
        return this.handlers.postNotifyToggle(data as { enabled: boolean });
      case "/show/file":
        return this.handlers.postShowFile(data as { share_type: FileShareType; filename: string; content: string });
      case "/room/accept":
        return this.handlers.postRoomAccept(data as { pending_id: string });
      case "/room/reject":
        return this.handlers.postRoomReject(data as { pending_id: string });
      case "/room/adopt":
        return this.handlers.postRoomAdopt(data as { room_id: string });
      case "/mention":
        return this.handlers.postMention(data as { to: string; content: string });
      case "/unread/mark-read":
        return this.handlers.postUnreadMarkRead(data as { ids: string[] });
      default:
        return null;
    }
  }

  private async readBody(req: IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let data = "";
      let size = 0;
      const MAX_SIZE = 1024 * 1024; // 1MB
      let aborted = false;

      req.on("data", (chunk) => {
        if (aborted) return;
        size += chunk.length;
        if (size > MAX_SIZE) {
          aborted = true;
          req.destroy();
          reject(new Error("Body too large"));
        } else {
          data += chunk;
        }
      });
      req.on("end", () => {
        if (aborted) return;
        try {
          resolve(data ? JSON.parse(data) : {});
        } catch {
          reject(new Error("Invalid JSON body"));
        }
      });
      req.on("error", (err) => {
        if (aborted) return;
        reject(err);
      });
    });
  }

  private json(res: ServerResponse, status: number, data: object): void {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  }

  stop(): void {
    this.server?.close();
    this.server = null;
    log.info("HTTP API stopped");
  }
}
