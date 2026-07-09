import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { generateId } from "@cc-room/shared";
import type {
  DreamPendingProposal,
  MergeHistoryEntry,
  PendingMergeRecord,
  PendingMergesFile,
} from "@cc-room/shared";
import { createChildLogger } from "./logger.js";
import {
  buildEntryMarkdown,
  buildMemoryIndex,
  indexDescription,
  isValidRoomMemorySlug,
} from "./room-memory.js";
import type { RoomMemoryEntryInfo } from "./room-memory.js";
import { objectionDeadlineIso } from "./dream-proposals.js";

const log = createChildLogger("dream-pending-merges");

export interface ParsedProposal {
  slug: string;
  description: string;
  category: string;
  status: string;
  proposedBy: string;
  proposedAt: string;
  objectionDeadline: string;
  silentMergeEligible: boolean;
  sourceSessions: string[];
  body: string;
  filename: string;
  action: "create" | "update";
}

export interface DreamPendingMergeDeps {
  roomMemoryDir: (roomId: string) => string;
  proposalsDir: (roomId: string) => string;
  listRoomMemoryEntries: (roomId: string) => RoomMemoryEntryInfo[];
}

export interface RegisterPendingMergeInput {
  roomId: string;
  proposalSlug: string;
  proposalFile: string;
  targetSlug: string;
  action: "create" | "update";
  proposedBy: string;
  objectionDeadline: string;
  silentMergeEligible: boolean;
}

export interface MergeExecutionResult {
  mergeId: string;
  slug: string;
  description: string;
}

export function pendingMergesPath(roomMemoryDir: string): string {
  return join(roomMemoryDir, "pending-merges.json");
}

export function mergeHistoryPath(roomMemoryDir: string): string {
  return join(roomMemoryDir, "merge-history.jsonl");
}

export function readPendingMergesFile(roomMemoryDir: string): PendingMergesFile {
  const path = pendingMergesPath(roomMemoryDir);
  if (!existsSync(path)) return { merges: [] };
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as PendingMergesFile;
  } catch {
    return { merges: [] };
  }
}

export function writePendingMergesFile(roomMemoryDir: string, data: PendingMergesFile): void {
  mkdirSync(roomMemoryDir, { recursive: true });
  writeFileSync(pendingMergesPath(roomMemoryDir), JSON.stringify(data, null, 2), {
    mode: 0o600,
  });
}

export function appendMergeHistory(roomMemoryDir: string, entry: MergeHistoryEntry): void {
  mkdirSync(roomMemoryDir, { recursive: true });
  appendFileSync(mergeHistoryPath(roomMemoryDir), JSON.stringify(entry) + "\n", { encoding: "utf-8", mode: 0o600 });
}

export function readMergeHistory(roomMemoryDir: string): MergeHistoryEntry[] {
  const path = mergeHistoryPath(roomMemoryDir);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as MergeHistoryEntry);
}

/** metadata: ブロック内のインデント付きフィールドを読む（行頭フィールドとの誤マッチ防止） */
function matchMetadataField(fm: string, key: string): string | undefined {
  const quoted = fm.match(new RegExp(`^\\s+${key}:\\s*"((?:[^"\\\\]|\\\\.)*)"`, "m"))?.[1];
  if (quoted !== undefined) return quoted.replace(/\\"/g, '"');
  // YAML のインラインコメント（空白 + #）を除外。値中の # （例: alice#1）は残す
  return fm
    .match(new RegExp(`^\\s+${key}:\\s*(.+?)(?:\\s#.*)?$`, "m"))?.[1]
    ?.trim();
}

export function parseProposalMarkdown(filename: string, raw: string): ParsedProposal | null {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return null;
  const fm = match[1];
  const body = match[2].trim();
  const name = fm.match(/^name:\s*(.+)$/m)?.[1]?.trim();
  if (!name || !isValidRoomMemorySlug(name)) return null;
  const descQuoted = fm.match(/^description:\s*"((?:[^"\\]|\\.)*)"/m)?.[1];
  const descPlain = fm.match(/^description:\s*(.+)$/m)?.[1]?.trim();
  const description = descQuoted
    ? descQuoted.replace(/\\"/g, '"')
    : descPlain ?? indexDescription(body);
  const category = fm.match(/^category:\s*(\w+)/m)?.[1] ?? "discovery";
  const status = fm.match(/^status:\s*(\w+)/m)?.[1] ?? "proposed";
  const proposedBy = matchMetadataField(fm, "proposed_by") ?? "";
  const proposedAt = matchMetadataField(fm, "proposed_at") ?? "";
  const objectionDeadline = matchMetadataField(fm, "objection_deadline") ?? "";
  const silentMergeEligible = matchMetadataField(fm, "silent_merge_eligible") === "true";
  const action = matchMetadataField(fm, "action") === "update" ? "update" : "create";
  const sessionsRaw = fm.match(/source_sessions:\s*(\[[^\]]*\])/m)?.[1];
  let sourceSessions: string[] = [];
  if (sessionsRaw) {
    try {
      sourceSessions = JSON.parse(sessionsRaw) as string[];
    } catch {
      sourceSessions = [];
    }
  }
  return {
    slug: name,
    description,
    category,
    status,
    proposedBy,
    proposedAt,
    objectionDeadline,
    silentMergeEligible,
    sourceSessions,
    body,
    filename,
    action,
  };
}

export function listProposalFiles(proposalsDir: string): ParsedProposal[] {
  if (!existsSync(proposalsDir)) return [];
  const results: ParsedProposal[] = [];
  for (const name of readdirSync(proposalsDir)) {
    if (!name.endsWith(".md")) continue;
    try {
      const raw = readFileSync(join(proposalsDir, name), "utf-8");
      const parsed = parseProposalMarkdown(name, raw);
      if (parsed) results.push(parsed);
    } catch {
      // skip
    }
  }
  return results;
}

export function findProposalBySlug(proposalsDir: string, slug: string): ParsedProposal | null {
  return listProposalFiles(proposalsDir).find((p) => p.slug === slug) ?? null;
}

export function updateProposalStatus(
  proposalsDir: string,
  slug: string,
  status: string,
): boolean {
  const proposal = findProposalBySlug(proposalsDir, slug);
  if (!proposal) return false;
  const path = join(proposalsDir, proposal.filename);
  const raw = readFileSync(path, "utf-8");
  const updated = raw.replace(/^status:\s*\w+/m, `status: ${status}`);
  writeFileSync(path, updated, { mode: 0o644 });
  return true;
}

export class DreamPendingMergeService {
  constructor(private readonly deps: DreamPendingMergeDeps) {}

  registerPendingMerge(input: RegisterPendingMergeInput): PendingMergeRecord {
    const roomMemoryDir = this.deps.roomMemoryDir(input.roomId);
    const file = readPendingMergesFile(roomMemoryDir);
    const existing = file.merges.find(
      (m) => m.proposal_slug === input.proposalSlug && m.status === "proposed",
    );
    if (existing) return existing;

    const record: PendingMergeRecord = {
      id: generateId(),
      room_id: input.roomId,
      proposal_slug: input.proposalSlug,
      proposal_file: input.proposalFile,
      target_slug: input.targetSlug,
      action: input.action,
      status: "proposed",
      proposed_at: new Date().toISOString(),
      objection_deadline: input.objectionDeadline,
      proposed_by: input.proposedBy,
      objections: [],
      merged_at: null,
      silent_merge_eligible: input.silentMergeEligible,
    };
    file.merges.push(record);
    writePendingMergesFile(roomMemoryDir, file);
    return record;
  }

  listPendingProposalsForUser(
    roomId: string,
    roomName: string,
    identity: string,
  ): DreamPendingProposal[] {
    const merges = readPendingMergesFile(this.deps.roomMemoryDir(roomId)).merges;
    const hasProposed = merges.some((m) => m.status === "proposed" && m.proposed_by === identity);
    if (!hasProposed) return [];
    const proposalsDir = this.deps.proposalsDir(roomId);
    return listProposalFiles(proposalsDir)
      .filter((p) => p.status === "proposed" && p.proposedBy === identity)
      .map((p) => {
        const merge = merges.find(
          (m) => m.proposal_slug === p.slug && m.status === "proposed",
        );
        return {
          slug: p.slug,
          description: p.description,
          category: p.category,
          room_id: roomId,
          room_name: roomName,
          status: p.status,
          proposed_by: p.proposedBy,
          proposed_at: p.proposedAt,
          objection_deadline: p.objectionDeadline,
          merge_id: merge?.id,
        };
      });
  }

  recordObjection(params: {
    roomId: string;
    identity: string;
    mergeId?: string;
    proposalSlug?: string;
    reason?: string;
  }): { ok: boolean; message: string } {
    const roomMemoryDir = this.deps.roomMemoryDir(params.roomId);
    const file = readPendingMergesFile(roomMemoryDir);
    const merge = file.merges.find((m) => {
      if (m.status !== "proposed") return false;
      if (params.mergeId) return m.id === params.mergeId;
      if (params.proposalSlug) return m.proposal_slug === params.proposalSlug;
      return false;
    });
    if (!merge) {
      return { ok: false, message: "対象の提案が見つかりません" };
    }
    if (merge.proposed_by !== params.identity) {
      return { ok: false, message: "自分の提案にのみ異議を申し立てできます" };
    }
    merge.status = "objected";
    merge.objections.push({
      by: params.identity,
      reason: params.reason,
      at: new Date().toISOString(),
    });
    writePendingMergesFile(roomMemoryDir, file);
    updateProposalStatus(this.deps.proposalsDir(params.roomId), merge.proposal_slug, "objected");
    return {
      ok: true,
      message: `⏸ 提案「${merge.proposal_slug}」を保留しました。`,
    };
  }

  extendHold(params: {
    roomId: string;
    identity: string;
    proposalSlug: string;
    extensionHours: number;
  }): { ok: boolean; message: string } {
    const proposal = findProposalBySlug(this.deps.proposalsDir(params.roomId), params.proposalSlug);
    if (!proposal) return { ok: false, message: "提案が見つかりません" };
    if (proposal.proposedBy !== params.identity) {
      return { ok: false, message: "自分の提案のみ期限延長できます" };
    }
    const roomMemoryDir = this.deps.roomMemoryDir(params.roomId);
    const file = readPendingMergesFile(roomMemoryDir);
    const merge = file.merges.find(
      (m) => m.proposal_slug === params.proposalSlug && m.status === "proposed",
    );
    if (!merge) return { ok: false, message: "保留中のマージレコードが見つかりません" };
    const newDeadline = objectionDeadlineIso(params.extensionHours);
    merge.objection_deadline = newDeadline;
    writePendingMergesFile(roomMemoryDir, file);
    const path = join(this.deps.proposalsDir(params.roomId), proposal.filename);
    const raw = readFileSync(path, "utf-8");
    writeFileSync(
      path,
      raw.replace(/^  objection_deadline: .+$/m, `  objection_deadline: ${newDeadline}`),
      { mode: 0o644 },
    );
    return {
      ok: true,
      message: `期限を ${params.extensionHours} 時間延長しました`,
    };
  }

  mergeProposalToRoomMemory(
    roomId: string,
    merge: PendingMergeRecord,
    addedBy: string,
  ): MergeExecutionResult | null {
    const proposalsDir = this.deps.proposalsDir(roomId);
    const proposal =
      findProposalBySlug(proposalsDir, merge.proposal_slug) ??
      (() => {
        try {
          const raw = readFileSync(join(proposalsDir, merge.proposal_file), "utf-8");
          return parseProposalMarkdown(merge.proposal_file, raw);
        } catch {
          return null;
        }
      })();
    if (!proposal || proposal.status === "objected") return null;

    const roomMemoryDir = this.deps.roomMemoryDir(roomId);
    const targetPath = join(roomMemoryDir, `${merge.target_slug}.md`);
    const snapshots: Record<string, string | null> = {};
    snapshots[merge.target_slug] = existsSync(targetPath)
      ? readFileSync(targetPath, "utf-8")
      : null;

    const sessionId = proposal.sourceSessions[0];
    const md = buildEntryMarkdown({
      slug: merge.target_slug,
      description: proposal.description,
      content: proposal.body,
      addedBy,
      sessionId,
      category: proposal.category,
    });
    mkdirSync(roomMemoryDir, { recursive: true });
    writeFileSync(targetPath, md, { mode: 0o644 });
    const entries = this.deps.listRoomMemoryEntries(roomId);
    writeFileSync(join(roomMemoryDir, "MEMORY.md"), buildMemoryIndex(entries), {
      mode: 0o644,
    });

    updateProposalStatus(proposalsDir, merge.proposal_slug, "merged");
    const file = readPendingMergesFile(roomMemoryDir);
    const target = file.merges.find((m) => m.id === merge.id);
    if (target) {
      target.status = "merged";
      target.merged_at = new Date().toISOString();
      writePendingMergesFile(roomMemoryDir, file);
    }

    appendMergeHistory(roomMemoryDir, {
      ts: new Date().toISOString(),
      merge_id: merge.id,
      room_id: roomId,
      action: "merge",
      slugs: [merge.target_slug],
      snapshots,
    });

    log.info({ roomId, slug: merge.target_slug, mergeId: merge.id }, "Proposal merged to room-memory");
    return {
      mergeId: merge.id,
      slug: merge.target_slug,
      description: proposal.description,
    };
  }

  scanDueMerges(roomId: string, now = Date.now()): MergeExecutionResult[] {
    const roomMemoryDir = this.deps.roomMemoryDir(roomId);
    const file = readPendingMergesFile(roomMemoryDir);
    const results: MergeExecutionResult[] = [];
    for (const merge of file.merges) {
      if (merge.status !== "proposed") continue;
      if (!merge.silent_merge_eligible) continue;
      if (new Date(merge.objection_deadline).getTime() > now) continue;
      const result = this.mergeProposalToRoomMemory(roomId, merge, merge.proposed_by);
      if (result) results.push(result);
    }
    return results;
  }

  revertLastMerge(roomId: string): { ok: boolean; message: string; slugs?: string[] } {
    const roomMemoryDir = this.deps.roomMemoryDir(roomId);
    const history = readMergeHistory(roomMemoryDir);
    const lastMerge = [...history].reverse().find((e) => e.action === "merge");
    if (!lastMerge) {
      return { ok: false, message: "取り消すマージ履歴がありません" };
    }

    for (const slug of lastMerge.slugs) {
      if (!isValidRoomMemorySlug(slug)) continue;
      const path = join(roomMemoryDir, `${slug}.md`);
      const prev = lastMerge.snapshots?.[slug];
      if (prev === null || prev === undefined) {
        if (existsSync(path)) unlinkSync(path);
      } else {
        writeFileSync(path, prev, { mode: 0o644 });
      }
    }
    const entries = this.deps.listRoomMemoryEntries(roomId);
    writeFileSync(join(roomMemoryDir, "MEMORY.md"), buildMemoryIndex(entries), {
      mode: 0o644,
    });

    const pending = readPendingMergesFile(roomMemoryDir);
    const rec = pending.merges.find((m) => m.id === lastMerge.merge_id);
    if (rec) {
      rec.status = "reverted";
      updateProposalStatus(this.deps.proposalsDir(roomId), rec.proposal_slug, "reverted");
    }
    writePendingMergesFile(roomMemoryDir, pending);

    appendMergeHistory(roomMemoryDir, {
      ts: new Date().toISOString(),
      merge_id: lastMerge.merge_id,
      room_id: roomId,
      action: "revert",
      slugs: lastMerge.slugs,
    });

    return {
      ok: true,
      message: `↩ 直近のチームメモリ更新（${lastMerge.slugs.length} 件）を取り消しました。`,
      slugs: lastMerge.slugs,
    };
  }
}
