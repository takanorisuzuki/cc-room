import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  encodeProjectDir,
  findSessionJsonlPath,
  parseSessionTurns,
  readSessionTranscriptById,
} from "../../session-reader.js";

describe("session-reader (session_id)", () => {
  let projectsDir: string;

  beforeEach(() => {
    projectsDir = mkdtempSync(join(tmpdir(), "cc-room-projects-"));
  });

  afterEach(() => {
    rmSync(projectsDir, { recursive: true, force: true });
  });

  it("encodeProjectDir", () => {
    expect(encodeProjectDir("/Users/alice/work/app")).toBe("-Users-alice-work-app");
  });

  it("findSessionJsonlPath by cwd + session id", () => {
    const cwd = "/tmp/work";
    const sessionId = "sess-abc";
    const dir = join(projectsDir, encodeProjectDir(cwd));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${sessionId}.jsonl`), '{"type":"user","message":"hello"}\n');
    expect(findSessionJsonlPath(projectsDir, sessionId, cwd)).toBe(
      join(dir, `${sessionId}.jsonl`),
    );
  });

  it("parseSessionTurns assigns 1-based turn numbers", () => {
    const jsonl = [
      '{"type":"user","message":"a"}',
      '{"type":"assistant","message":"b"}',
    ].join("\n");
    const turns = parseSessionTurns(jsonl);
    expect(turns.map((t) => t.turn)).toEqual([1, 2]);
  });

  it("readSessionTranscriptById returns null when missing", () => {
    expect(readSessionTranscriptById(projectsDir, "missing")).toBeNull();
  });
});
