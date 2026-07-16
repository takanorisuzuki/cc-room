import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveDaemonSource } from "../daemon-resolver.js";

describe("resolveDaemonSource", () => {
  let sandbox: string;
  let setupRoot: string;

  beforeEach(() => {
    sandbox = join(tmpdir(), `cc-room-setup-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    setupRoot = join(sandbox, "setup");
    mkdirSync(setupRoot, { recursive: true });
  });

  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  it("prefers vendor/daemon/dist/index.js", () => {
    const vendor = join(setupRoot, "vendor", "daemon", "dist");
    mkdirSync(vendor, { recursive: true });
    writeFileSync(join(vendor, "index.js"), "#!/usr/bin/env node\n");

    const bundle = join(sandbox, "daemon", "dist-bundle");
    mkdirSync(bundle, { recursive: true });
    writeFileSync(join(bundle, "index.js"), "#!/usr/bin/env node\n");

    expect(resolveDaemonSource(setupRoot)).toBe(join(vendor, "index.js"));
  });

  it("falls back to sibling daemon dist-bundle", () => {
    const bundle = join(sandbox, "daemon", "dist-bundle");
    mkdirSync(bundle, { recursive: true });
    const path = join(bundle, "index.js");
    writeFileSync(path, "#!/usr/bin/env node\n");

    expect(resolveDaemonSource(setupRoot)).toBe(path);
  });

  it("returns null when nothing exists", () => {
    expect(resolveDaemonSource(setupRoot)).toBeNull();
  });
});
