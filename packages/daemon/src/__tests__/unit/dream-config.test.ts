import { describe, it, expect } from "vitest";
import { resolveDreamConfig, DEFAULT_DREAM_CONFIG, parseDreamRoomPatch, sanitizeDreamRoomConfig, formatDreamConfigSummary } from "../../dream-config.js";

describe("resolveDreamConfig", () => {
  it("defaults when global and room are empty", () => {
    expect(resolveDreamConfig(undefined, undefined)).toEqual(DEFAULT_DREAM_CONFIG);
  });

  it("room overrides global", () => {
    const cfg = resolveDreamConfig(
      { mine_trigger: "threshold", session_threshold: 20 },
      { mine_trigger: "every_stop", session_threshold: 5 },
    );
    expect(cfg.mine_trigger).toBe("every_stop");
    expect(cfg.session_threshold).toBe(5);
  });

  it("parseDreamRoomPatch validates mine_trigger", () => {
    expect(parseDreamRoomPatch({ mine_trigger: "every_stop" }).mine_trigger).toBe("every_stop");
    expect(() => parseDreamRoomPatch({ mine_trigger: "invalid" })).toThrow();
    expect(() => parseDreamRoomPatch({})).toThrow();
  });

  it("sanitizeDreamRoomConfig accepts silent=on/off style via boolean fields", () => {
    const patch = sanitizeDreamRoomConfig({ silent_merge: "off", session_threshold: 10 });
    expect(patch.silent_merge).toBe(false);
    expect(patch.session_threshold).toBe(10);
  });

  it("sanitizeDreamRoomConfig rejects non-numeric session_threshold and objection_window_hours", () => {
    expect(() => sanitizeDreamRoomConfig({ session_threshold: true })).toThrow(
      "session_threshold must be a positive integer",
    );
    expect(() => sanitizeDreamRoomConfig({ session_threshold: "10abc" })).toThrow(
      "session_threshold must be a positive integer",
    );
    expect(() => sanitizeDreamRoomConfig({ objection_window_hours: true })).toThrow(
      "objection_window_hours must be a positive integer",
    );
    expect(() => sanitizeDreamRoomConfig({ objection_window_hours: null })).toThrow(
      "objection_window_hours must be a positive integer",
    );
  });

  it("formatDreamConfigSummary renders human-readable lines", () => {
    const text = formatDreamConfigSummary(DEFAULT_DREAM_CONFIG);
    expect(text).toContain("mine_trigger:");
    expect(text).toContain("silent_merge:");
  });
});
