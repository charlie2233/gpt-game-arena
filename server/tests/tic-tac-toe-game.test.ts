import { describe, expect, it } from "vitest";

import { GameRuleError } from "../src/domain/errors.js";
import { TicTacToeGame } from "../src/domain/tic-tac-toe-game.js";
import type { GameActor } from "../src/domain/types.js";

function playSequence(game: TicTacToeGame, moves: string[]): ReturnType<TicTacToeGame["snapshot"]> {
  let snapshot = game.snapshot();
  for (const [index, move] of moves.entries()) {
    const actor: GameActor = index % 2 === 0 ? "player" : "gpt";
    snapshot = game.play(actor, move, index);
  }
  return snapshot;
}

function expectRuleError(action: () => unknown, code: GameRuleError["code"]): void {
  expect(action).toThrow(GameRuleError);
  try { action(); } catch (error) { expect((error as GameRuleError).code).toBe(code); }
}

describe("TicTacToeGame", () => {
  it("starts as a fixed 3x3 black-first board with sorted legal moves", () => {
    const snapshot = TicTacToeGame.create("ttt-1", "black").snapshot();
    expect(snapshot).toMatchObject({ kind: "tic-tac-toe", difficulty: "medium", turn: "black", stateVersion: 0 });
    expect(snapshot.board).toEqual(Array.from({ length: 3 }, () => Array(3).fill(null)));
    expect(snapshot.legalMoves).toEqual(["A1", "A2", "A3", "B1", "B2", "B3", "C1", "C2", "C3"]);
  });

  it.each([
    { moves: ["A3", "A2", "B3", "B2", "C3"] },
    { moves: ["A3", "B3", "A2", "B2", "A1"] },
    { moves: ["A3", "B3", "B2", "C3", "C1"] },
  ])("finishes row, column, and diagonal wins", ({ moves }) => {
    const finished = playSequence(TicTacToeGame.create("ttt-1", "black"), moves);
    expect(finished).toMatchObject({ status: "finished", winner: "black", stateVersion: 5 });
    expect(finished.winningLine).toHaveLength(3);
    expect(finished.legalMoves).toEqual([]);
  });

  it("finishes a full board draw", () => {
    const finished = playSequence(TicTacToeGame.create("ttt-1", "black"), ["A3", "B3", "C3", "C2", "A2", "A1", "B1", "C1", "B2"]);
    expect(finished).toMatchObject({ status: "finished", winner: "draw", stateVersion: 9 });
  });

  it("prioritizes stale versions and keeps snapshots cloned on errors", () => {
    const game = TicTacToeGame.create("ttt-1", "black");
    game.play("player", "A1", 0);
    const before = game.snapshot();
    expectRuleError(() => game.play("player", "A1", 0), "stale_version");
    expectRuleError(() => game.play("player", "A1", 1), "wrong_actor");
    expectRuleError(() => game.play("gpt", "D1", 1), "illegal_move");
    expect(game.snapshot()).toEqual(before);
    const clone = game.snapshot();
    clone.board[0][0] = "white";
    clone.moveHistory.push({ actor: "gpt", color: "white", notation: "C3", ply: 99 });
    expect(game.snapshot()).toEqual(before);
  });

  it("rejects malformed, lowercase, and occupied-square moves when the actor owns the turn", () => {
    const game = TicTacToeGame.create("ttt-1", "black");
    expectRuleError(() => game.play("player", "a1", 0), "illegal_move");
    expectRuleError(() => game.play("player", "A4", 0), "illegal_move");
    expectRuleError(() => game.play("player", "A01", 0), "illegal_move");
    game.play("player", "A1", 0);
    game.play("gpt", "B1", 1);
    expectRuleError(() => game.play("player", "A1", 2), "illegal_move");
  });

  it("rejects moves after a completed game", () => {
    const game = TicTacToeGame.create("ttt-1", "black");
    playSequence(game, ["A3", "A2", "B3", "B2", "C3"]);
    expectRuleError(() => game.play("gpt", "C2", 5), "game_finished");
  });
});
