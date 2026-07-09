import mdns from "multicast-dns";
import { EventEmitter } from "node:events";
import { networkInterfaces } from "node:os";
import { PROTOCOL_VERSION, MDNS_SERVICE_NAME } from "@cc-room/shared";
import { createChildLogger } from "./logger.js";
import type { Config } from "./config.js";

const log = createChildLogger("discovery");

function getLocalIp(): string {
  for (const ifaces of Object.values(networkInterfaces())) {
    for (const iface of ifaces ?? []) {
      if (iface.family === "IPv4" && !iface.internal) return iface.address;
    }
  }
  return "127.0.0.1";
}

export interface PeerInfo {
  name: string;
  host: string;
  port: number;
  version: number;
}

export interface DiscoveredRoom {
  id: string;
  name: string;
  hostedBy: string;
  host: string;
  port: number;
  memberCount: number;
}

export class Discovery extends EventEmitter {
  private static readonly DISCOVERED_ROOM_TTL_MS = 60_000;
  private mdns: ReturnType<typeof mdns>;
  private advertiseInterval: ReturnType<typeof setInterval> | null = null;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private identity: string;
  private port: number;
  private serviceName: string;
  private advertisedRooms = new Map<string, { name: string; memberCount: number }>();
  private discoveredRooms = new Map<string, DiscoveredRoom & { lastSeen: number }>();

  constructor(config: Config) {
    super();
    this.identity = config.identity.name;
    this.port = config.network.port;
    this.serviceName = config.network.mdns_service || MDNS_SERVICE_NAME;
    this.mdns = mdns();
  }

  start(): void {
    this.mdns.on("response", (response: unknown) => {
      this.handleResponse(response as { answers: Array<Record<string, unknown>> });
    });

    this.mdns.on("query", (query: unknown) => {
      const q = query as { questions?: Array<{ name: string }> };
      if (!q || !Array.isArray(q.questions)) return;
      const isForUs = q.questions.some(
        (question) => question.name === this.serviceName,
      );
      if (isForUs) {
        this.announce();
      }
    });

    this.advertise();
    this.cleanupInterval = setInterval(() => this.pruneStaleRooms(), 30_000);
    log.info({ identity: this.identity, port: this.port }, "mDNS discovery started");
  }

  private advertise(): void {
    this.announce();
    this.advertiseInterval = setInterval(() => this.announce(), 10_000);
  }

  private pruneStaleRooms(): void {
    const cutoff = Date.now() - Discovery.DISCOVERED_ROOM_TTL_MS;
    for (const [key, room] of this.discoveredRooms) {
      if (room.lastSeen < cutoff) {
        this.discoveredRooms.delete(key);
        log.debug({ roomId: room.id, hostedBy: room.hostedBy }, "Stale discovered room removed");
      }
    }
  }

  private announce(): void {
    const roomsList = Array.from(this.advertisedRooms.entries())
      .map(([id, r]) => `${id}:${encodeURIComponent(r.name)}:${r.memberCount}`)
      .join(",");

    this.mdns.respond({
      answers: [
        {
          type: "SRV",
          name: `${this.identity}.${this.serviceName}`,
          data: {
            port: this.port,
            target: getLocalIp(),
            weight: 0,
            priority: 0,
          },
        },
        {
          type: "TXT",
          name: `${this.identity}.${this.serviceName}`,
          data: [
            `identity=${this.identity}`,
            `version=${PROTOCOL_VERSION}`,
            ...(roomsList ? [`rooms=${roomsList}`] : []),
          ],
        },
      ],
    });
  }

  advertiseRoom(roomId: string, name: string, memberCount: number): void {
    this.advertisedRooms.set(roomId, { name, memberCount });
    this.announce();
    log.info({ roomId, name }, "Room advertised on mDNS");
  }

  removeRoomAdvertisement(roomId: string): void {
    this.advertisedRooms.delete(roomId);
    this.announce();
    log.info({ roomId }, "Room removed from mDNS");
  }

  getDiscoveredRooms(): DiscoveredRoom[] {
    return Array.from(this.discoveredRooms.values()).map(({ lastSeen: _ls, ...room }) => room);
  }

  query(): void {
    this.mdns.query({
      questions: [{ type: "SRV", name: this.serviceName }],
    });
  }

  private handleResponse(response: { answers: Array<Record<string, unknown>> }): void {
    if (!response || !Array.isArray(response.answers)) return;
    const srvRecords = response.answers.filter(
      (a) => a.type === "SRV" && typeof a.name === "string" && a.name.endsWith(this.serviceName),
    );

    for (const srv of srvRecords) {
      const data = srv.data as { port: number; target: string };
      const txtRecord = response.answers.find(
        (a) => a.type === "TXT" && a.name === srv.name,
      );

      let peerIdentity = "";
      let version = PROTOCOL_VERSION;

      let roomsStr = "";

      if (txtRecord) {
        const txtData = txtRecord.data as Array<Buffer | string>;
        for (const entry of txtData) {
          const str = typeof entry === "string" ? entry : (entry as Buffer).toString();
          if (str.startsWith("identity=")) peerIdentity = str.slice(9);
          if (str.startsWith("version=")) version = parseInt(str.slice(8), 10);
          if (str.startsWith("rooms=")) roomsStr = str.slice(6);
        }
      }

      if (peerIdentity === this.identity) continue;
      if (!peerIdentity) continue;

      if (roomsStr) {
        for (const part of roomsStr.split(",")) {
          const [id, encodedName, countStr] = part.split(":");
          const name = encodedName ? decodeURIComponent(encodedName) : "";
          if (id && name) {
            const room: DiscoveredRoom = {
              id,
              name,
              hostedBy: peerIdentity,
              host: data.target,
              port: data.port,
              memberCount: parseInt(countStr || "1", 10),
            };
            this.discoveredRooms.set(`${peerIdentity}:${name}`, { ...room, lastSeen: Date.now() });
            this.emit("room", room);
          }
        }
      }

      const peer: PeerInfo = {
        name: peerIdentity,
        host: data.target,
        port: data.port,
        version,
      };

      log.debug({ peer }, "Peer discovered");
      this.emit("peer", peer);
    }
  }

  stop(): void {
    if (this.advertiseInterval) {
      clearInterval(this.advertiseInterval);
      this.advertiseInterval = null;
    }
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.mdns.destroy();
    log.info("mDNS discovery stopped");
  }
}
