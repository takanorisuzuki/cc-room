import { describe, it, expect } from "vitest";
import { resolveCcRoomDir } from "../paths.js";

describe("resolveCcRoomDir", () => {
  it("uses CC_ROOM_HOME when set", () => {
    expect(resolveCcRoomDir({ CC_ROOM_HOME: "/tmp/cc-a" } as NodeJS.ProcessEnv)).toBe("/tmp/cc-a");
  });

  it("falls back to ~/.cc-room", () => {
    const dir = resolveCcRoomDir({} as NodeJS.ProcessEnv);
    expect(dir.endsWith(".cc-room")).toBe(true);
  });
});
