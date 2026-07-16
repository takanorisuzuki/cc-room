import { describe, it, expect } from "vitest";
import { stripCcRoomFromSettings } from "../settings-merger.js";

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
            hooks: [{ type: "command", command: "cc-room-daemon hook post-tool-use" }],
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
