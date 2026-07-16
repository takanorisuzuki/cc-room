import { join } from "node:path";
import { homedir } from "node:os";

/** daemon と同じく CC_ROOM_HOME を尊重する */
export function resolveCcRoomDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.CC_ROOM_HOME || join(homedir(), ".cc-room");
}
