import { describe, expect, it } from "vitest";

import { ReversiGame } from "../src/domain/reversi-game.js";
import { GameRuleError } from "../src/domain/errors.js";

function actor(snapshot: ReturnType<ReversiGame["snapshot"]>) { return snapshot.turn === snapshot.playerColor ? "player" : "gpt" as const; }
function expectRuleError(action: () => unknown, code: GameRuleError["code"]) {
  let error: unknown;
  try { action(); } catch (caught) { error = caught; }
  expect(error).toBeInstanceOf(GameRuleError);
  expect((error as GameRuleError).code).toBe(code);
}
function playMoves(game: ReversiGame, moves: string[]) {
  let snapshot = game.snapshot();
  for (const move of moves) snapshot = game.play(actor(snapshot), move, snapshot.stateVersion);
  return snapshot;
}

describe("ReversiGame", () => {
  it("has the standard oriented opening and exact Black legal moves", () => {
    const snapshot = ReversiGame.create("r-1", "black").snapshot();
    expect(snapshot).toMatchObject({ kind: "reversi", turn: "black", difficulty: "medium", score: { black: 2, white: 2 }, stateVersion: 0 });
    expect(snapshot.board[3].slice(3, 5)).toEqual(["black", "white"]); // D5, E5
    expect(snapshot.board[4].slice(3, 5)).toEqual(["white", "black"]); // D4, E4
    expect(snapshot.legalMoves).toEqual(["C4", "D3", "E6", "F5"]);
  });

  it("flips bracketed discs, records one move, and protects snapshot copies", () => {
    const game = ReversiGame.create("r-1", "black");
    const after = game.play("player", "C4", 0);
    expect(after.board[4][2]).toBe("black");
    expect(after.board[4][3]).toBe("black");
    expect(after.score).toEqual({ black: 4, white: 1 });
    expect(after.moveHistory).toEqual([{ actor: "player", color: "black", notation: "C4", ply: 1 }]);
    after.board[4][2] = "white"; after.score.black = 99; after.moveHistory[0].notation = "A1";
    expect(game.snapshot().board[4][2]).toBe("black");
    expect(game.snapshot().score.black).toBe(4);
    expect(game.snapshot().moveHistory[0].notation).toBe("C4");
  });

  it("flips every bracketed line simultaneously", () => {
    const game = ReversiGame.create("r-multiline", "black");
    const before = playMoves(game, "C4 C3 C2 B2 A2".split(" "));
    expect(before.turn).toBe("white");
    const after = game.play("gpt", "C5", before.stateVersion);
    // C5 brackets Black at C4 vertically and D5 horizontally.
    expect(after.board[3][2]).toBe("white");
    expect(after.board[4][2]).toBe("white");
    expect(after.board[3][3]).toBe("white");
    expect(after.score).toEqual({ black: 4, white: 6 });
  });

  it("automatically skips an opponent with no legal move without recording a pass", () => {
    const game = ReversiGame.create("r-skip", "black");
    const before = playMoves(game, "C4 C3 C2 B2 E6 C1 A1".split(" "));
    expect(before.turn).toBe("white");
    const after = game.play("gpt", "A3", before.stateVersion);
    expect(after).toMatchObject({ turn: "white", stateVersion: before.stateVersion + 1, message: "Black has no legal move; White moves again." });
    expect(after.moveHistory).toHaveLength(before.moveHistory.length + 1);
    expect(after.lastMove).toMatchObject({ notation: "A3", ply: before.moveHistory.length + 1 });
    expect(after.legalMoves).toEqual(["C5", "F6"]);
  });

  it("checks stale version before all other errors and rejects invalid placements", () => {
    const game = ReversiGame.create("r-1", "black");
    expectRuleError(() => game.play("gpt", "c4", 1), "stale_version");
    expectRuleError(() => game.play("gpt", "C4", 0), "wrong_actor");
    for (const move of ["c4", "I4", "A0", "A9", "A", "C44", "D5", "A1"]) expectRuleError(() => game.play("player", move, 0), "illegal_move");
  });

  it("plays a complete legal game, then rejects finished games", () => {
    const game = ReversiGame.create("r-finish", "black");
    let snapshot = game.snapshot();
    while (snapshot.status === "active") snapshot = game.play(actor(snapshot), snapshot.legalMoves[0], snapshot.stateVersion);
    expect(snapshot.legalMoves).toEqual([]);
    expect(snapshot.score.black + snapshot.score.white).toBeGreaterThan(0);
    expect(["black", "white", "draw"]).toContain(snapshot.winner);
    expectRuleError(() => game.play(actor(snapshot), "A1", snapshot.stateVersion), "game_finished");
  });

  it("finishes a legal full-board draw with no legal moves", () => {
    const game = ReversiGame.create("r-draw", "black");
    const finished = playMoves(game, "F5 F4 G3 C6 C4 F3 E3 B3 D6 G4 H5 F2 E2 D7 G1 F1 C5 H3 H2 B4 E1 D1 A4 G2 B2 H1 C7 B8 E6 G5 D8 B5 C8 A2 F6 F7 A8 D2 B6 B7 C3 C2 A5 E7 G7 A6 E8 H7 G8 F8 G6 A3 C1 H6 H8 B1 A7 D3 H4 A1".split(" "));
    expect(finished).toMatchObject({ status: "finished", winner: "draw", legalMoves: [], score: { black: 32, white: 32 }, message: "The game is a draw." });
    expect(finished.score.black + finished.score.white).toBe(64);
    expect(finished.moveHistory).toHaveLength(60);
  });
});
