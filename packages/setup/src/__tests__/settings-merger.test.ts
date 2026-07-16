import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  stripCcRoomFromSettings,
  buildCcRoomHooks,
  buildCcRoomMcp,
  resolveDaemonCommand,
} from "../settings-merger.js";

describe("stripCcRoomFromSettings", () => {
  it("removes cc-room hooks and keeps other hooks", () => {
    const settings = {
      hooks: {
        UserPromptSubmit: [
          { hooks: [{ type: "command", command: "other-tool" }] },
          { hooks: [{ type: "command", command: "cc-room-daemon hook user-prompt-submit" }] },
        ],
        PostToolUse: [
          {
            matcher: "Write|Edit",
            hooks: [
              {
                type: "command",
                command: "/Users/me/.cc-room/bin/cc-room-daemon hook post-tool-use",
              },
            ],
          },
        ],
        Stop: [{ hooks: [{ type: "command", command: "cc-room-daemon hook session-stop" }] }],
      },
      mcpServers: {
        "cc-room": { type: "stdio", command: "cc-room-daemon", args: ["mcp"] },
        other: { type: "stdio", command: "other" },
      },
    };

    const next = stripCcRoomFromSettings(settings);

    expect(next.hooks).toEqual({
      UserPromptSubmit: [{ hooks: [{ type: "command", command: "other-tool" }] }],
      PostToolUse: [],
      Stop: [],
    });
    expect(next.mcpServers).toEqual({
      other: { type: "stdio", command: "other" },
    });
  });

  it("is a no-op when cc-room is absent", () => {
    const settings = { hooks: {}, mcpServers: { foo: {} } };
    expect(stripCcRoomFromSettings(settings)).toEqual(settings);
  });
});

describe("buildCcRoomHooks / buildCcRoomMcp", () => {
  it("uses absolute daemon path", () => {
    const bin = "/Users/me/.cc-room/bin/cc-room-daemon";
    const hooks = buildCcRoomHooks(bin);
    expect(hooks.UserPromptSubmit[0].hooks[0].command).toBe(`${bin} hook user-prompt-submit`);
    expect(buildCcRoomMcp(bin)["cc-room"].command).toBe(bin);
  });
});

describe("resolveDaemonCommand", () => {
  it("prefers CC_ROOM_HOME/bin/cc-room-daemon absolute path", () => {
    const home = mkdtempSync(join(tmpdir(), "cc-room-settings-"));
    try {
      const binDir = join(home, "bin");
      mkdirSync(binDir, { recursive: true });
      const bin = join(binDir, "cc-room-daemon");
      writeFileSync(bin, "#!/bin/sh\n");
      expect(resolveDaemonCommand({ CC_ROOM_HOME: home } as NodeJS.ProcessEnv)).toBe(bin);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
