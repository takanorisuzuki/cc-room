import { createChildLogger } from "../logger.js";

const log = createChildLogger("hook:post-tool-use");

interface HookInput {
  tool_name?: string;
  tool_input?: { file_path?: string; command?: string };
  tool_output?: string;
}

export async function handlePostToolUse(
  daemonHttpPort: number,
): Promise<void> {
  let input = "";

  // stdin からイベントデータを読み取る
  for await (const chunk of process.stdin) {
    input += chunk;
  }

  let hookData: HookInput;
  try {
    hookData = JSON.parse(input) as HookInput;
  } catch {
    log.error("Failed to parse hook input");
    return;
  }

  const toolName = hookData.tool_name;
  if (toolName !== "Write" && toolName !== "Edit") {
    return;
  }

  const filePath = hookData.tool_input?.file_path;
  if (!filePath) {
    return;
  }

  log.info({ toolName, filePath }, "File change detected, notifying daemon");

  try {
    const response = await fetch(`http://127.0.0.1:${daemonHttpPort}/notify-file`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_path: filePath }),
    });

    if (!response.ok) {
      log.error({ status: response.status }, "Daemon notification failed");
    }
  } catch (err) {
    log.error({ err }, "Failed to contact daemon");
  }
}
