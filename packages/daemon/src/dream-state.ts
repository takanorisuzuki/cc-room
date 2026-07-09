import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import type { MemberDreamState } from "@cc-room/shared";

const EMPTY: MemberDreamState = {
  session_stops_since_last_mine: 0,
  last_mine_at: null,
  mines_today: 0,
  mines_today_date: null,
};

export function memberDreamStatePath(
  roomsDir: string,
  roomId: string,
  identity: string,
): string {
  return join(roomsDir, roomId, "members", identity, ".dream-state.json");
}

export function readMemberDreamState(path: string): MemberDreamState {
  if (!existsSync(path)) return { ...EMPTY };
  try {
    return { ...EMPTY, ...JSON.parse(readFileSync(path, "utf-8")) as MemberDreamState };
  } catch {
    return { ...EMPTY };
  }
}

export function writeMemberDreamState(path: string, state: MemberDreamState): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2), { mode: 0o600 });
}

export function todayDateString(): string {
  const d = new Date();
  const YYYY = d.getFullYear();
  const MM = String(d.getMonth() + 1).padStart(2, "0");
  const DD = String(d.getDate()).padStart(2, "0");
  return `${YYYY}-${MM}-${DD}`;
}

export function incrementStopCount(state: MemberDreamState): MemberDreamState {
  return {
    ...state,
    session_stops_since_last_mine: state.session_stops_since_last_mine + 1,
  };
}

export function resetStopCountAfterMine(state: MemberDreamState): MemberDreamState {
  const today = todayDateString();
  const minesToday =
    state.mines_today_date === today ? state.mines_today + 1 : 1;
  return {
    session_stops_since_last_mine: 0,
    last_mine_at: new Date().toISOString(),
    mines_today: minesToday,
    mines_today_date: today,
  };
}
