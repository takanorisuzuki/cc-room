import { describe, it, expect } from "vitest";
import { escapeXml } from "../register-service.js";

describe("escapeXml", () => {
  it("escapes XML special characters for plist strings", () => {
    expect(escapeXml(`/Users/a/R&D/.cc-room`)).toBe(`/Users/a/R&amp;D/.cc-room`);
    expect(escapeXml(`a<b>c"d`)).toBe(`a&lt;b&gt;c&quot;d`);
  });
});
