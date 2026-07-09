import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, accessSync, constants } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

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
    message: `Node.js ${process.versions.node} (20+ が必要)`,
    hint: "Node.js 20 以上にアップグレードしてください: https://nodejs.org/",
  };
}

function checkClaudeCodeInstalled(): ValidationResult {
  try {
    execFileSync("claude", ["--version"], { encoding: "utf-8", stdio: "pipe" });
    return { ok: true, message: "Claude Code がインストール済み" };
  } catch {
    return {
      ok: false,
      message: "Claude Code が見つかりません",
      hint: "Claude Code をインストールしてください: https://claude.ai/code",
    };
  }
}

function checkClaudeDir(): ValidationResult {
  const claudeDir = join(homedir(), ".claude");
  if (existsSync(claudeDir)) {
    return { ok: true, message: "~/.claude/ ディレクトリが存在" };
  }
  return {
    ok: false,
    message: "~/.claude/ が見つかりません",
    hint: "Claude Code を一度起動してセッションを作成してください",
  };
}

function checkSettingsWritable(): ValidationResult {
  const settingsPath = join(homedir(), ".claude", "settings.json");
  const settingsDir = join(homedir(), ".claude");

  if (existsSync(settingsPath)) {
    try {
      accessSync(settingsPath, constants.W_OK);
      return { ok: true, message: "settings.json に書き込み可能" };
    } catch {
      return {
        ok: false,
        message: "settings.json に書き込み権限がありません",
        hint: `chmod 644 ${settingsPath} を実行してください`,
      };
    }
  }

  try {
    accessSync(settingsDir, constants.W_OK);
    return { ok: true, message: "settings.json を作成可能" };
  } catch {
    return {
      ok: false,
      message: "~/.claude/ に書き込み権限がありません",
      hint: `chmod 755 ${settingsDir} を実行してください`,
    };
  }
}

function checkHooksNotDisabled(): ValidationResult {
  const settingsPath = join(homedir(), ".claude", "settings.json");
  if (!existsSync(settingsPath)) {
    return { ok: true, message: "Hooks: 制限なし（settings.json 未作成）" };
  }

  try {
    const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    if (settings.hooks === false || settings.disableHooks === true) {
      return {
        ok: false,
        message: "Hooks が無効化されています",
        hint:
          "cc-room はファイル共有に PostToolUse hook を使用します。settings.json から hooks の無効化設定を削除してください",
      };
    }
    return { ok: true, message: "Hooks: 有効" };
  } catch {
    return { ok: true, message: "Hooks: 制限なし" };
  }
}

function checkMcpNotBlocked(): ValidationResult {
  const settingsPath = join(homedir(), ".claude", "settings.json");
  if (!existsSync(settingsPath)) {
    return { ok: true, message: "MCP Server: 登録可能" };
  }

  try {
    const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    if (settings.mcpServers === false || settings.disableMcp === true) {
      return {
        ok: false,
        message: "MCP Server の登録が無効化されています",
        hint:
          "cc-room は MCP Server 経由で Claude Code と連携します。settings.json から MCP の無効化設定を削除してください",
      };
    }
    return { ok: true, message: "MCP Server: 登録可能" };
  } catch {
    return { ok: true, message: "MCP Server: 登録可能" };
  }
}

function checkSessionDir(): ValidationResult {
  const projectsDir = join(homedir(), ".claude", "projects");
  if (existsSync(projectsDir)) {
    return { ok: true, message: "セッションディレクトリが存在" };
  }
  return {
    ok: true,
    message: "セッションディレクトリ未作成（初回セッション後に生成される）",
  };
}

function checkGitUser(): ValidationResult {
  try {
    const name = execFileSync("git", ["config", "user.name"], {
      encoding: "utf-8",
      stdio: "pipe",
    }).trim();
    if (name) {
      return { ok: true, message: `Git ユーザー: ${name}` };
    }
    return {
      ok: false,
      message: "git user.name が未設定",
      hint: 'git config --global user.name "Your Name" で設定してください（cc-room の identity に使用）',
    };
  } catch {
    return {
      ok: false,
      message: "git が見つかりません",
      hint: "git をインストールしてください",
    };
  }
}
