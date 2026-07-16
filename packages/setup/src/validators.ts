import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, accessSync, constants } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { t } from "./i18n.js";

interface ValidationResult {
  ok: boolean;
  message: string;
  hint?: string;
}

export function validateAll(): { passed: boolean; results: ValidationResult[] } {
  const checks = [
    checkNodeVersion(),
    checkClaudeCodeInstalled(),
    checkClaudeDir(),
    checkSettingsWritable(),
    checkHooksNotDisabled(),
    checkMcpNotBlocked(),
    checkSessionDir(),
    checkGitUser(),
  ];

  const passed = checks.every((r) => r.ok);
  return { passed, results: checks };
}

export function printResults(results: ValidationResult[]): void {
  console.log("\n  Preflight checks:\n");
  for (const r of results) {
    const icon = r.ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
    console.log(`  ${icon} ${r.message}`);
    if (!r.ok && r.hint) {
      console.log(`    \x1b[33m→ ${r.hint}\x1b[0m`);
    }
  }
  console.log("");
}

function checkNodeVersion(): ValidationResult {
  const major = parseInt(process.versions.node.split(".")[0], 10);
  if (major >= 20) {
    return { ok: true, message: `Node.js ${process.versions.node}` };
  }
  return {
    ok: false,
    message: t("val.node_bad", { version: process.versions.node }),
    hint: t("val.node_hint"),
  };
}

function checkClaudeCodeInstalled(): ValidationResult {
  try {
    execFileSync("claude", ["--version"], { encoding: "utf-8", stdio: "pipe" });
    return { ok: true, message: t("val.claude_ok") };
  } catch {
    return {
      ok: false,
      message: t("val.claude_missing"),
      hint: t("val.claude_hint"),
    };
  }
}

function checkClaudeDir(): ValidationResult {
  const claudeDir = join(homedir(), ".claude");
  if (existsSync(claudeDir)) {
    return { ok: true, message: t("val.claude_dir_ok") };
  }
  return {
    ok: false,
    message: t("val.claude_dir_missing"),
    hint: t("val.claude_dir_hint"),
  };
}

function checkSettingsWritable(): ValidationResult {
  const settingsPath = join(homedir(), ".claude", "settings.json");
  const settingsDir = join(homedir(), ".claude");

  if (existsSync(settingsPath)) {
    try {
      accessSync(settingsPath, constants.W_OK);
      return { ok: true, message: t("val.settings_writable") };
    } catch {
      return {
        ok: false,
        message: t("val.settings_not_writable"),
        hint: t("val.settings_chmod", { path: settingsPath }),
      };
    }
  }

  try {
    accessSync(settingsDir, constants.W_OK);
    return { ok: true, message: t("val.settings_creatable") };
  } catch {
    return {
      ok: false,
      message: t("val.claude_dir_not_writable"),
      hint: t("val.claude_dir_chmod", { path: settingsDir }),
    };
  }
}

function checkHooksNotDisabled(): ValidationResult {
  const settingsPath = join(homedir(), ".claude", "settings.json");
  if (!existsSync(settingsPath)) {
    return { ok: true, message: t("val.hooks_unset") };
  }

  try {
    const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    if (settings.hooks === false || settings.disableHooks === true) {
      return {
        ok: false,
        message: t("val.hooks_disabled"),
        hint: t("val.hooks_disabled_hint"),
      };
    }
    return { ok: true, message: t("val.hooks_ok") };
  } catch {
    return { ok: true, message: t("val.hooks_unrestricted") };
  }
}

function checkMcpNotBlocked(): ValidationResult {
  const settingsPath = join(homedir(), ".claude", "settings.json");
  if (!existsSync(settingsPath)) {
    return { ok: true, message: t("val.mcp_ok") };
  }

  try {
    const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    if (settings.mcpServers === false || settings.disableMcp === true) {
      return {
        ok: false,
        message: t("val.mcp_disabled"),
        hint: t("val.mcp_disabled_hint"),
      };
    }
    return { ok: true, message: t("val.mcp_ok") };
  } catch {
    return { ok: true, message: t("val.mcp_ok") };
  }
}

function checkSessionDir(): ValidationResult {
  const projectsDir = join(homedir(), ".claude", "projects");
  if (existsSync(projectsDir)) {
    return { ok: true, message: t("val.session_ok") };
  }
  return {
    ok: true,
    message: t("val.session_pending"),
  };
}

function checkGitUser(): ValidationResult {
  try {
    const name = execFileSync("git", ["config", "user.name"], {
      encoding: "utf-8",
      stdio: "pipe",
    }).trim();
    if (name) {
      return { ok: true, message: t("val.git_ok", { name }) };
    }
    return {
      ok: false,
      message: t("val.git_no_name"),
      hint: t("val.git_no_name_hint"),
    };
  } catch {
    return {
      ok: false,
      message: t("val.git_missing"),
      hint: t("val.git_hint"),
    };
  }
}
