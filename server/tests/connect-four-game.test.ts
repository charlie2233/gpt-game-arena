import { describe, expect, it } from "vitest";

import { ConnectFourGame } from "../src/domain/connect-four-game.js";
import { GameRuleError } from "../src/domain/errors.js";

function play(game: ConnectFourGame, moves: string[]) {
  let snapshot = game.snapshot();
  for (const move of moves) {
    snapshot = game.play(snapshot.turn === snapshot.playerColor ? "player" : "gpt", move, snapshot.stateVersion);
  }
  return snapshot;
}

function expectRuleError(action: () => unknown, code: GameRuleError["code"]) {
  expect(action).toThrowError(GameRuleError);
  try { action(); } catch (error) { expect((error as GameRuleError).code).toBe(code); }
}

describe("ConnectFourGame", () => {
  it("opens with a 6x7 board, Black, and every column", () => {
    const snapshot = ConnectFourGame.create("cf-1", "black").snapshot();
    expect(snapshot).toMatchObject({ kind: "connect-four", turn: "black", difficulty: "medium", stateVersion: 0 });
    expect(snapshot.board).toHaveLength(6);
    expect(snapshot.board.every((row) => row.length === 7 && row.every((cell) => cell === null))).toBe(true);
    expect(snapshot.legalMoves).toEqual(["A", "B", "C", "D", "E", "F", "G"]);
  });

  it("drops discs with gravity and records a column notation", () => {
    const snapshot = play(ConnectFourGame.create("cf-1", "black"), ["A", "A"]);
    expect(snapshot.board[5][0]).toBe("black");
    expect(snapshot.board[4][0]).toBe("white");
    expect(snapshot.lastMove).toMatchObject({ notation: "A", ply: 2 });
  });

  it("enforces stale version, actor, exact syntax, and full-column legality in order", () => {
    const game = ConnectFourGame.create("cf-1", "black");
    expectRuleError(() => game.play("gpt", "a", 1), "stale_version");
    expectRuleError(() => game.play("gpt", "a", 0), "wrong_actor");
    expectRuleError(() => game.play("player", "a", 0), "illegal_move");
    expectRuleError(() => game.play("player", "H", 0), "illegal_move");
    let snapshot = game.snapshot();
    for (let index = 0; index < 6; index += 1) snapshot = game.play(snapshot.turn === "black" ? "player" : "gpt", "A", snapshot.stateVersion);
    expect(snapshot.legalMoves).not.toContain("A");
    expectRuleError(() => game.play(snapshot.turn === "black" ? "player" : "gpt", "A", snapshot.stateVersion), "illegal_move");
  });

  it.each([
    [["A", "A", "B", "B", "C", "C", "D"], ["A1", "B1", "C1", "D1"]],
    [["A", "B", "A", "B", "A", "B", "A"], ["A4", "A3", "A2", "A1"]],
    [["A", "B", "B", "C", "G", "C", "C", "D", "G", "D", "G", "D", "D"], ["D4", "C3", "B2", "A1"]],
    [["D", "C", "C", "B", "G", "B", "B", "A", "G", "A", "G", "A", "A"], ["A4", "B3", "C2", "D1"]],
  ])("finishes four-in-a-row with a typed winning line", (moves, line) => {
    const game = ConnectFourGame.create("cf-1", "black");
    const finished = play(game, moves);
    expect(finished).toMatchObject({ status: "finished", winner: "black", winningLine: line, legalMoves: [] });
    expectRuleError(() => game.play("gpt", "A", finished.stateVersion), "game_finished");
  });

  it("deep-clones snapshots", () => {
    const game = ConnectFourGame.create("cf-1", "black");
    const snapshot = game.snapshot();
    snapshot.board[5][0] = "white";
    snapshot.legalMoves.pop();
    expect(game.snapshot().board[5][0]).toBeNull();
    expect(game.snapshot().legalMoves).toHaveLength(7);
  });
});
