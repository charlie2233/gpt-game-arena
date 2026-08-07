import { describe, expect, it } from "vitest";

import { BasketballGame } from "../src/domain/basketball-game.js";
import { GameRuleError } from "../src/domain/errors.js";
import type { BasketballGameSnapshot, BasketballMove, GameActor } from "../src/domain/types.js";
import { gameSnapshotSchema } from "../src/snapshot-schema.js";

function outcomeSeed(value: number): string {
  return value.toString(16).padStart(64, "0");
}

function play(game: BasketballGame, actor: GameActor, move: BasketballMove): BasketballGameSnapshot {
  return game.play(actor, move, game.snapshot().stateVersion);
}

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

function playMirroredRounds(game: BasketballGame, moves: readonly BasketballMove[]): BasketballGameSnapshot {
  let snapshot = game.snapshot();
  for (const move of moves) {
    snapshot = play(game, "player", move);
    snapshot = play(game, "gpt", move);
  }
  return snapshot;
}

describe("BasketballGame Court Duel", () => {
  it("starts a five-round shootout with public, energy-aware shot options", () => {
    const game = BasketballGame.create("court-1", "black", "hard", 3, outcomeSeed(0));

    expect(game.snapshot()).toMatchObject({
      gameId: "court-1",
      kind: "basketball",
      difficulty: "hard",
      playerColor: "black",
      turn: "black",
      status: "active",
      resetEpoch: 3,
      stateVersion: 0,
      round: 1,
      phase: "regulation",
      score: { black: 0, white: 0 },
      energy: { black: 4, white: 4 },
      streak: { black: 0, white: 0 },
      attempts: { black: 0, white: 0 },
      legalMoves: ["drive", "pull-up", "three"],
      shotOptions: [
        { move: "drive", points: 2, energyCost: 2, accuracy: 82 },
        { move: "pull-up", points: 2, energyCost: 1, accuracy: 66 },
        { move: "three", points: 3, energyCost: 0, accuracy: 48 },
      ],
      moveHistory: [],
      shotResults: [],
    });
  });

  it("rejects stale, wrong-actor, malformed, and unaffordable moves without mutation", () => {
    const game = BasketballGame.create("court-errors", "black", "medium", 0, outcomeSeed(0));
    const initial = game.snapshot();

    expectRuleError(() => game.play("player", "drive", 1), "stale_version");
    expectRuleError(() => game.play("gpt", "drive", 0), "wrong_actor");
    expectRuleError(() => game.play("player", " Drive ", 0), "illegal_move");
    expect(game.snapshot()).toEqual(initial);

    play(game, "player", "drive");
    play(game, "gpt", "three");
    play(game, "player", "drive");
    play(game, "gpt", "three");
    const depleted = game.snapshot();
    expect(depleted).toMatchObject({ turn: "black", energy: { black: 0 }, legalMoves: ["three"] });
    expectRuleError(() => game.play("player", "pull-up", depleted.stateVersion), "illegal_move");
    expect(game.snapshot()).toEqual(depleted);
  });

  it("derives makes reproducibly from the private seed and reset epoch", () => {
    const seed = outcomeSeed(5);
    const first = BasketballGame.create("basketball-seed", "black", "medium", 0, seed);
    const replay = BasketballGame.create("basketball-seed", "black", "medium", 0, seed);
    const reset = BasketballGame.create("basketball-seed", "black", "medium", 1, seed);

    const firstShot = play(first, "player", "drive");
    const replayedShot = play(replay, "player", "drive");
    const resetShot = play(reset, "player", "drive");

    expect(replayedShot).toEqual(firstShot);
    expect(firstShot.shotResults[0]).toMatchObject({ move: "drive", accuracy: 82, made: true, points: 2 });
    expect(resetShot.shotResults[0]).toMatchObject({ move: "drive", accuracy: 82, made: false, points: 0 });
  });

  it("does not let identical public inputs determine the private outcome", () => {
    const publicInputs = ["same-public-id", "black", "medium", 0] as const;
    const first = BasketballGame.create(...publicInputs, outcomeSeed(0));
    const second = BasketballGame.create(...publicInputs, outcomeSeed(1));

    const firstShot = play(first, "player", "drive");
    const secondShot = play(second, "player", "drive");

    expect(firstShot.shotResults[0].made).toBe(true);
    expect(secondShot.shotResults[0].made).toBe(false);
    for (const snapshot of [firstShot, secondShot]) {
      expect(snapshot).not.toHaveProperty("basketballOutcomeSeed");
      expect(snapshot).not.toHaveProperty("outcomeSeed");
      expect(JSON.stringify(snapshot)).not.toContain(outcomeSeed(0));
      expect(JSON.stringify(snapshot)).not.toContain(outcomeSeed(1));
    }
  });

  it("rejects semantically inconsistent authoritative snapshots", () => {
    const game = BasketballGame.create("court-contract", "black", "medium", 0, outcomeSeed(9));
    const opening = game.snapshot();
    const moved = play(game, "player", "drive");
    const shot = moved.shotResults[0]!;

    expect(gameSnapshotSchema.safeParse(opening).success).toBe(true);
    expect(gameSnapshotSchema.safeParse(moved).success).toBe(true);
    for (const invalid of [
      { ...opening, legalMoves: ["drive"] },
      { ...opening, round: 2 },
      { ...opening, phase: "overtime" },
      { ...opening, shotOptions: [...opening.shotOptions, opening.shotOptions[0]] },
      { ...moved, score: { ...moved.score, black: moved.score.black + 1 } },
      { ...moved, attempts: { black: 0, white: 0 } },
      { ...moved, turn: "black" },
      { ...moved, stateVersion: 2 },
      { ...moved, moveHistory: [{ ...moved.moveHistory[0]!, notation: "three" }] },
      { ...moved, shotResults: [{ ...shot, made: false, points: 2 }] },
      { ...moved, shotResults: [{ ...shot, accuracy: shot.accuracy === 92 ? 91 : shot.accuracy + 1 }] },
    ]) expect(gameSnapshotSchema.safeParse(invalid).success).toBe(false);
  });

  it("applies hot-streak and adaptive-repeat accuracy without exposing the future roll", () => {
    const game = BasketballGame.create("basketball-seed", "black", "medium", 0, outcomeSeed(0));

    play(game, "player", "drive");
    play(game, "gpt", "three");
    const repeated = play(game, "player", "drive");

    expect(repeated.shotResults).toEqual([
      expect.objectContaining({ ply: 1, color: "black", move: "drive", accuracy: 82, made: true, points: 2 }),
      expect.objectContaining({ ply: 2, color: "white", move: "three", accuracy: 48, made: true, points: 3 }),
      expect.objectContaining({ ply: 3, color: "black", move: "drive", accuracy: 75, made: true, points: 2 }),
    ]);
    expect(repeated).toMatchObject({
      score: { black: 4, white: 3 },
      energy: { black: 0, white: 4 },
      streak: { black: 2, white: 1 },
      attempts: { black: 2, white: 1 },
    });
    expect(repeated.shotOptions.every((option) => !Object.prototype.hasOwnProperty.call(option, "roll"))).toBe(true);
  });

  it("waits for the matching fifth shot before deciding regulation", () => {
    const game = BasketballGame.create("winner-1", "black", "medium", 0, outcomeSeed(7));
    for (let round = 1; round <= 4; round += 1) {
      play(game, "player", "three");
      play(game, "gpt", "three");
    }
    const blackFifth = play(game, "player", "three");
    expect(blackFifth).toMatchObject({ status: "active", turn: "white", attempts: { black: 5, white: 4 }, round: 5 });

    const finished = play(game, "gpt", "three");
    expect(finished).toMatchObject({
      status: "finished",
      winner: "black",
      phase: "regulation",
      round: 5,
      attempts: { black: 5, white: 5 },
      score: { black: 9, white: 3 },
      legalMoves: [],
      shotOptions: [],
      stateVersion: 10,
    });
    expect(gameSnapshotSchema.safeParse(finished).success).toBe(true);
    expect(() => game.play("player", "three", 10)).toThrowError(GameRuleError);
  });

  it("enters overtime on a tied fifth round and refreshes one energy per side", () => {
    const game = BasketballGame.create("ot-energy-6", "black", "medium", 0, outcomeSeed(3));
    const regulationMoves = ["drive", "drive", "three", "three", "three"] as const;
    const overtime = playMirroredRounds(game, regulationMoves);

    expect(overtime).toMatchObject({
      status: "active",
      phase: "overtime",
      round: 6,
      turn: "black",
      score: { black: 10, white: 10 },
      energy: { black: 1, white: 1 },
      legalMoves: ["pull-up", "three"],
      attempts: { black: 5, white: 5 },
    });
  });

  it("caps sudden death at three pairs and declares a draw only after both replies", () => {
    const game = BasketballGame.create("draw-68", "black", "medium", 0, outcomeSeed(33));
    playMirroredRounds(game, ["three", "three", "three", "three", "three"]);
    expect(game.snapshot()).toMatchObject({ status: "active", phase: "overtime", round: 6 });

    for (let round = 6; round <= 7; round += 1) {
      const blackShot = play(game, "player", "three");
      expect(blackShot).toMatchObject({ status: "active", turn: "white", round });
      const whiteShot = play(game, "gpt", "three");
      expect(whiteShot).toMatchObject({ status: "active", turn: "black", round: round + 1 });
    }
    const blackEighth = play(game, "player", "three");
    expect(blackEighth).toMatchObject({ status: "active", turn: "white", round: 8 });
    const draw = play(game, "gpt", "three");
    expect(draw).toMatchObject({
      status: "finished",
      winner: "draw",
      phase: "overtime",
      round: 8,
      score: { black: 3, white: 3 },
      attempts: { black: 8, white: 8 },
      legalMoves: [],
      stateVersion: 16,
    });
    expect(gameSnapshotSchema.safeParse(draw).success).toBe(true);
    expect(draw.score.black).toBe(draw.shotResults.filter((shot) => shot.color === "black").reduce((sum, shot) => sum + shot.points, 0));
    expect(draw.score.white).toBe(draw.shotResults.filter((shot) => shot.color === "white").reduce((sum, shot) => sum + shot.points, 0));
  });
});
