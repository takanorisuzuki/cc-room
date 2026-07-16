import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveCommandSources } from "../installer.js";

describe("resolveCommandSources", () => {
  let root: string;

  beforeEach(() => {
    root = join(tmpdir(), `cc-room-cmd-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("prefers vendor commands for the requested locale", () => {
    const ja = join(root, "vendor", "commands", "room", "ja");
    const en = join(root, "vendor", "commands", "room", "en");
    mkdirSync(ja, { recursive: true });
    mkdirSync(en, { recursive: true });
    writeFileSync(join(ja, "room.md"), "ja");
    writeFileSync(join(en, "room.md"), "en");

    expect(resolveCommandSources(root, "ja")).toBe(ja);
    expect(resolveCommandSources(root, "en")).toBe(en);
  });
});
