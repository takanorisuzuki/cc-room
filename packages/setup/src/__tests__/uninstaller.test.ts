import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { removeCcRoomData, removeCommandFiles } from "../uninstaller.js";

describe("uninstall helpers", () => {
  let root: string;

  beforeEach(() => {
    root = join(tmpdir(), `cc-room-uninst-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("removeCommandFiles deletes room/private/show only", () => {
    const commandsDir = join(root, "commands");
    mkdirSync(commandsDir, { recursive: true });
    writeFileSync(join(commandsDir, "room.md"), "x");
    writeFileSync(join(commandsDir, "private.md"), "x");
    writeFileSync(join(commandsDir, "show.md"), "x");
    writeFileSync(join(commandsDir, "keep.md"), "x");

    removeCommandFiles(commandsDir);

    expect(existsSync(join(commandsDir, "room.md"))).toBe(false);
    expect(existsSync(join(commandsDir, "private.md"))).toBe(false);
    expect(existsSync(join(commandsDir, "show.md"))).toBe(false);
    expect(readFileSync(join(commandsDir, "keep.md"), "utf-8")).toBe("x");
  });

  it("removeCcRoomData deletes the data directory", () => {
    const ccRoomDir = join(root, ".cc-room");
    mkdirSync(join(ccRoomDir, "bin"), { recursive: true });
    writeFileSync(join(ccRoomDir, "bin", "cc-room-daemon"), "x");

    removeCcRoomData(ccRoomDir);

    expect(existsSync(ccRoomDir)).toBe(false);
  });
});
