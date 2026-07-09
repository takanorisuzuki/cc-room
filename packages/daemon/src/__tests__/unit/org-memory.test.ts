import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildOrgL0Injection,
  listOrgMemoryEntries,
  readOrgLastInjectSession,
  resolveOrgMemoryDir,
  writeOrgLastInjectSession,
} from "../../org-memory.js";

describe("org-memory", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "cc-room-org-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("resolveOrgMemoryDir returns null when missing", () => {
    expect(resolveOrgMemoryDir(join(tmp, "missing"))).toBeNull();
  });

  it("listOrgMemoryEntries and buildOrgL0Injection", () => {
    writeFileSync(
      join(tmp, "security-policy.md"),
      '---\nname: security-policy\ndescription: "本番は MFA 必須"\n---\n\nMFA 必須',
    );
    const entries = listOrgMemoryEntries(tmp);
    expect(entries).toHaveLength(1);
    expect(entries[0].description).toBe("本番は MFA 必須");

    const block = buildOrgL0Injection(entries);
    expect(block).toContain("<cc-room-org-memory>");
    expect(block).toContain("security-policy");
    expect(block).toContain("組織メモリ");
  });

  it("tracks last inject session per org dir", () => {
    mkdirSync(tmp, { recursive: true });
    expect(readOrgLastInjectSession(tmp)).toBeNull();
    writeOrgLastInjectSession(tmp, "sess-org-1");
    expect(readOrgLastInjectSession(tmp)).toBe("sess-org-1");
    expect(existsSync(join(tmp, ".last-inject"))).toBe(true);
    expect(readFileSync(join(tmp, ".last-inject"), "utf-8")).toBe("sess-org-1");
  });
});
