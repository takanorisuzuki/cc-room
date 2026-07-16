import { describe, it, expect } from "vitest";
import { escapeXml, sanitizeSystemdEnvValue } from "../register-service.js";

describe("escapeXml", () => {
  it("escapes XML special characters for plist strings", () => {
    expect(escapeXml(`/Users/a/R&D/.cc-room`)).toBe(`/Users/a/R&amp;D/.cc-room`);
    expect(escapeXml(`a<b>c"d`)).toBe(`a&lt;b&gt;c&quot;d`);
  });
});

describe("sanitizeSystemdEnvValue", () => {
  it("allows normal paths including spaces", () => {
    expect(sanitizeSystemdEnvValue("/home/user/my room/.cc-room")).toBe(
      "/home/user/my room/.cc-room",
    );
  });

  it("rejects newlines, CR, NUL, and double quotes", () => {
    expect(sanitizeSystemdEnvValue("/tmp/a\nExecStart=/bin/evil")).toBeNull();
    expect(sanitizeSystemdEnvValue("/tmp/a\r\nb")).toBeNull();
    expect(sanitizeSystemdEnvValue('/tmp/a"b')).toBeNull();
    expect(sanitizeSystemdEnvValue("/tmp/a\0b")).toBeNull();
  });

  it("rejects empty string", () => {
    expect(sanitizeSystemdEnvValue("")).toBeNull();
  });
});
