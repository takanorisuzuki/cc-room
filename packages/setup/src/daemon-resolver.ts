import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * setup パッケージ基準で cc-room-daemon 本体のパスを探す。
 * 優先: vendor 同梱（npm / pack:vendor）→ ローカル dist-bundle
 */
export function resolveDaemonSource(setupPackageRoot: string): string | null {
  const candidates = [
    join(setupPackageRoot, "vendor", "daemon", "dist", "index.js"),
    join(setupPackageRoot, "..", "daemon", "dist-bundle", "index.js"),
    // モノレポ開発時のフォールバック（チャンク分割あり・単体コピーでは動かないことがある）
    join(setupPackageRoot, "..", "daemon", "dist", "index.js"),
    join(setupPackageRoot, "..", "..", "node_modules", "@cc-room", "daemon", "dist", "index.js"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

export const DAEMON_MISSING_HINT =
  "cc-room-daemon が見つかりません。リポジトリでは `pnpm --filter setup-cc-room run pack:vendor` を実行するか、npm の setup-cc-room パッケージを使ってください。";
