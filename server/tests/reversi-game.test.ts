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
});
