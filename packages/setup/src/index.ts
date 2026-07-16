#!/usr/bin/env node

import { validateAll, printResults } from "./validators.js";
import { install } from "./installer.js";
import { uninstall } from "./uninstaller.js";
import { getLocale, resolveLocale, setLocale, t } from "./i18n.js";

const VERSION = "0.2.2";

function stripLangArgs(argv: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--lang" || a === "--locale") {
      i++; // skip value
      continue;
    }
    if (a.startsWith("--lang=") || a.startsWith("--locale=")) continue;
    out.push(a);
  }
  return out;
}

function printHelp(): void {
  console.log(t("cli.help", { version: VERSION }));
}

async function runInstall(): Promise<void> {
  console.log(`\n  🏠 setup-cc-room v${VERSION}\n`);

  console.log(t("cli.running_preflight"));
  const { passed, results } = validateAll();
  printResults(results);

  if (!passed) {
    console.log(t("cli.preflight_failed"));
    process.exit(1);
  }

  console.log(t("cli.preflight_ok"));

  await install(getLocale());

  console.log(`
${t("cli.install_done")}
${t("cli.install_guide")}
`);
}

async function runUninstall(): Promise<void> {
  console.log(`\n  🏠 setup-cc-room v${VERSION} — uninstall\n`);
  await uninstall();
  console.log(`
${t("cli.uninstall_done")}

${t("cli.restart_claude")}
`);
}

async function main(): Promise<void> {
  setLocale(resolveLocale(process.argv, process.env));
  const args = stripLangArgs(process.argv.slice(2));
  const arg = args[0];

  if (arg === "--help" || arg === "-h" || arg === "help") {
    printHelp();
    return;
  }
  if (arg === "uninstall" || arg === "--uninstall") {
    await runUninstall();
    return;
  }
  if (arg && arg !== "install") {
    console.error(t("cli.unknown_arg", { arg }));
    printHelp();
    process.exit(1);
  }
  await runInstall();
}

main().catch((err) => {
  console.error(t("cli.error"), err instanceof Error ? err.message : err);
  process.exit(1);
});
