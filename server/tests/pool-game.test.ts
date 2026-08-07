import { describe, expect, it } from "vitest";

import { GameRuleError } from "../src/domain/errors.js";
import { PoolGame } from "../src/domain/pool-game.js";

function expectRuleError(action: () => unknown, code: GameRuleError["code"]): void {
  let error: unknown;
  try {
    action();
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(GameRuleError);
  expect((error as GameRuleError).code).toBe(code);
}

describe("PoolGame", () => {
  it("opens a fixed Mini 8-Ball table with exact direct pots and safety shots", () => {
    const snapshot = PoolGame.create("pool-1", "black").snapshot();

    expect(snapshot).toMatchObject({
      kind: "pool",
      difficulty: "medium",
      playerColor: "black",
      turn: "black",
      status: "active",
      stateVersion: 0,
      resetEpoch: 0,
      cueBall: { x: 12, y: 25 },
      message: "Black (solids) to shoot.",
    });
    expect(snapshot.balls).toEqual([
      { id: 1, group: "solids", x: 32, y: 9 },
      { id: 2, group: "solids", x: 36, y: 20 },
      { id: 3, group: "solids", x: 34, y: 34 },
      { id: 9, group: "stripes", x: 53, y: 13 },
      { id: 10, group: "stripes", x: 54, y: 29 },
      { id: 11, group: "stripes", x: 72, y: 18 },
      { id: 8, group: "eight", x: 76, y: 35 },
    ]);
    expect(snapshot.legalMoves).toEqual([
      "POT:1:TM", "POT:1:TR",
      "POT:2:TM", "POT:2:BM",
      "POT:3:BM", "POT:3:BR",
      "SAFE:L", "SAFE:C", "SAFE:R", "SAFE:T", "SAFE:B",
    ]);
    expect(snapshot.legalMoves.some((move) => /^POT:(?:8|9|10|11):/.test(move))).toBe(false);
  });

  it("pockets an owned ball, moves the cue ball, records the shot, and keeps the turn", () => {
    const game = PoolGame.create("pool-1", "black", "hard", 3);
    const snapshot = game.play("player", "POT:1:TM", 0);

    expect(snapshot).toMatchObject({
      difficulty: "hard",
      resetEpoch: 3,
      turn: "black",
      stateVersion: 1,
      cueBall: { x: 32, y: 9 },
      lastMove: { actor: "player", color: "black", notation: "POT:1:TM", ply: 1 },
    });
    expect(snapshot.balls.some((ball) => ball.id === 1)).toBe(false);
    expect(snapshot.moveHistory).toEqual([
      { actor: "player", color: "black", notation: "POT:1:TM", ply: 1 },
    ]);
  });

  it("plays a deterministic safety, preserves every object ball, and passes the turn", () => {
    const game = PoolGame.create("pool-1", "black");
    const snapshot = game.play("player", "SAFE:R", 0);

    expect(snapshot).toMatchObject({
      turn: "white",
      stateVersion: 1,
      cueBall: { x: 82, y: 25 },
      lastMove: { actor: "player", color: "black", notation: "SAFE:R", ply: 1 },
      message: "White (stripes) to shoot.",
    });
    expect(snapshot.balls).toHaveLength(7);
    expect(snapshot.legalMoves).toEqual(expect.arrayContaining(["POT:10:BM", "POT:11:TM", "SAFE:L", "SAFE:B"]));
    expect(snapshot.legalMoves.some((move) => /^POT:[1238]:/.test(move))).toBe(false);
  });

  it("enforces version, actor, exact syntax, ownership, geometry, and early 8-ball gating", () => {
    const game = PoolGame.create("pool-1", "black");

    expectRuleError(() => game.play("gpt", "pot:1:TM", 1), "stale_version");
    expectRuleError(() => game.play("gpt", "pot:1:TM", 0), "wrong_actor");
    for (const move of [
      "pot:1:TM", "POT:1:tm", "POT:01:TM", "POT:1:TL", "POT:9:TR", "POT:8:BR",
      "SAFE:X", " SAFE:L", "SAFE:L ", "",
    ]) {
      expectRuleError(() => game.play("player", move, 0), "illegal_move");
    }
    expect(game.snapshot()).toMatchObject({ stateVersion: 0, moveHistory: [] });
  });

  it("unlocks the 8-ball after the group clears and finishes on its legal pot", () => {
    const game = PoolGame.create("pool-runout", "black");
    let snapshot = game.play("player", "POT:1:TM", 0);
    snapshot = game.play("player", "POT:2:BL", snapshot.stateVersion);
    snapshot = game.play("player", "POT:3:BL", snapshot.stateVersion);

    expect(snapshot.turn).toBe("black");
    expect(snapshot.balls.filter((ball) => ball.group === "solids")).toHaveLength(0);
    expect(snapshot.legalMoves).toContain("POT:8:TR");
    expect(snapshot.legalMoves.some((move) => /^POT:(?:9|10|11):/.test(move))).toBe(false);

    const finished = game.play("player", "POT:8:TR", snapshot.stateVersion);
    expect(finished).toMatchObject({
      status: "finished",
      winner: "black",
      turn: "black",
      stateVersion: 4,
      legalMoves: [],
      cueBall: { x: 76, y: 35 },
      lastMove: { actor: "player", color: "black", notation: "POT:8:TR", ply: 4 },
      message: "Black (solids) wins by pocketing the 8-ball.",
    });
    expectRuleError(() => game.play("player", "SAFE:L", 4), "game_finished");
  });

  it("supports a White player while preserving Black-first actor ownership", () => {
    const game = PoolGame.create("pool-white-player", "white");
    expectRuleError(() => game.play("player", "SAFE:R", 0), "wrong_actor");
    const afterGpt = game.play("gpt", "SAFE:R", 0);
    expect(afterGpt.turn).toBe("white");
    const afterPlayer = game.play("player", "POT:10:BM", 1);
    expect(afterPlayer).toMatchObject({ turn: "white", stateVersion: 2 });
  });

  it("deep-clones every mutable snapshot field", () => {
    const game = PoolGame.create("pool-1", "black");
    const snapshot = game.snapshot();
    snapshot.cueBall.x = 99;
    snapshot.balls[0].x = 99;
    snapshot.balls.pop();
    snapshot.legalMoves.pop();

    const fresh = game.snapshot();
    expect(fresh.cueBall).toEqual({ x: 12, y: 25 });
    expect(fresh.balls).toHaveLength(7);
    expect(fresh.balls[0]).toMatchObject({ id: 1, x: 32 });
    expect(fresh.legalMoves).toHaveLength(11);
  });
});
