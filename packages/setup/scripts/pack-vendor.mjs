#!/usr/bin/env node
/**
 * setup-cc-room 配布用に daemon（単一バンドル）と slash commands を vendor/ へ同梱する。
 */
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SETUP_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = join(SETUP_ROOT, "..", "..");
const DAEMON_PKG = join(REPO_ROOT, "packages", "daemon");
const COMMANDS_SRC = join(REPO_ROOT, "packages", "commands", "room");
const VENDOR = join(SETUP_ROOT, "vendor");

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", shell: false });
  if (r.status !== 0) {
    throw new Error(`Command failed (${r.status}): ${cmd} ${args.join(" ")}`);
  }
}

function normalizeShebang(filePath) {
  const text = readFileSync(filePath, "utf-8");
  const lines = text.split(/(?<=\n)/);
  const body = [];
  let sawShebang = false;
  for (const line of lines) {
    if (line.startsWith("#!")) {
      if (!sawShebang) {
        body.push("#!/usr/bin/env node\n");
        sawShebang = true;
      }
      continue;
    }
    body.push(line);
  }
  if (!sawShebang) body.unshift("#!/usr/bin/env node\n");
  writeFileSync(filePath, body.join(""));
  chmodSync(filePath, 0o755);
}

function main() {
  console.log("pack-vendor: building daemon bundle...");
  run("pnpm", ["exec", "tsup", "--config", "tsup.bundle.config.ts"], DAEMON_PKG);

  const bundleSrc = join(DAEMON_PKG, "dist-bundle", "index.js");
  if (!existsSync(bundleSrc)) {
    throw new Error(`Bundle not found: ${bundleSrc}`);
  }

  rmSync(VENDOR, { recursive: true, force: true });
  const daemonDestDir = join(VENDOR, "daemon", "dist");
  mkdirSync(daemonDestDir, { recursive: true });
  const daemonDest = join(daemonDestDir, "index.js");
  copyFileSync(bundleSrc, daemonDest);
  normalizeShebang(daemonDest);
  console.log(`  daemon -> ${daemonDest}`);

  const cmdDestDir = join(VENDOR, "commands", "room");
  mkdirSync(cmdDestDir, { recursive: true });
  for (const name of ["room.md", "private.md", "show.md"]) {
    const src = join(COMMANDS_SRC, name);
    if (!existsSync(src)) throw new Error(`Command missing: ${src}`);
    copyFileSync(src, join(cmdDestDir, name));
  }
  console.log(`  commands -> ${cmdDestDir}`);
  console.log("pack-vendor: done");
}

main();
