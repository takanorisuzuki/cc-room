import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  incrementStopCount,
  memberDreamStatePath,
  readMemberDreamState,
  resetStopCountAfterMine,
  todayDateString,
  writeMemberDreamState,
} from "../../dream-state.js";

describe("dream-state", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "cc-room-dream-state-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("memberDreamStatePath がメンバー別パスを組み立てる", () => {
    const p = memberDreamStatePath(tmp, "room-1", "alice");
    expect(p).toBe(join(tmp, "room-1", "members", "alice", ".dream-state.json"));
  });

  it("ファイルなしでは初期状態を返す", () => {
    const state = readMemberDreamState(join(tmp, "nonexistent.json"));
    expect(state.session_stops_since_last_mine).toBe(0);
    expect(state.last_mine_at).toBeNull();
    expect(state.mines_today).toBe(0);
  });

  it("壊れた JSON でも初期状態にフォールバックする", () => {
    const path = join(tmp, "broken.json");
    writeFileSync(path, "{not json");
    const state = readMemberDreamState(path);
    expect(state.session_stops_since_last_mine).toBe(0);
  });

  it("write → read で往復する（親ディレクトリも自動作成）", () => {
    const path = memberDreamStatePath(tmp, "room-1", "alice");
    writeMemberDreamState(path, {
      session_stops_since_last_mine: 5,
      last_mine_at: "2026-07-01T00:00:00.000Z",
      mines_today: 2,
      mines_today_date: "2026-07-01",
    });
    const state = readMemberDreamState(path);
    expect(state.session_stops_since_last_mine).toBe(5);
    expect(state.mines_today).toBe(2);
  });

  it("incrementStopCount がカウンタだけを進める", () => {
    const next = incrementStopCount({
      session_stops_since_last_mine: 3,
      last_mine_at: null,
      mines_today: 0,
      mines_today_date: null,
    });
    expect(next.session_stops_since_last_mine).toBe(4);
    expect(next.last_mine_at).toBeNull();
  });

  it("resetStopCountAfterMine がカウンタを 0 に戻し当日 Mine 数を加算する", () => {
    const today = todayDateString();
    const next = resetStopCountAfterMine({
      session_stops_since_last_mine: 20,
      last_mine_at: null,
      mines_today: 2,
      mines_today_date: today,
    });
    expect(next.session_stops_since_last_mine).toBe(0);
    expect(next.mines_today).toBe(3);
    expect(next.mines_today_date).toBe(today);
    expect(next.last_mine_at).not.toBeNull();
  });

  it("resetStopCountAfterMine は日付が変わると Mine 数を 1 から数え直す", () => {
    const next = resetStopCountAfterMine({
      session_stops_since_last_mine: 20,
      last_mine_at: null,
      mines_today: 9,
      mines_today_date: "2000-01-01",
    });
    expect(next.mines_today).toBe(1);
    expect(next.mines_today_date).toBe(todayDateString());
  });
});
