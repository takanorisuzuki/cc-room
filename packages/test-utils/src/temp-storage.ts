import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

export function createTempStorage(): string {
  return mkdtempSync(join(tmpdir(), "cc-room-test-"));
}

export function cleanupTempStorage(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}
