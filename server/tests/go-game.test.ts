import { describe, expect, it } from "vitest";

import { GameRuleError } from "../src/domain/errors.js";
import { GoGame } from "../src/domain/go-game.js";
import type { GameActor } from "../src/domain/types.js";

function playSequence(game: GoGame, moves: string[]): void {
  for (const [index, move] of moves.entries()) {
    const actor: GameActor = index % 2 === 0 ? "player" : "gpt";
    game.play(actor, move, index);
  }
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

describe("GoGame", () => {
  it("starts a 9x9 game with black to play and all points plus pass legal", () => {
    const snapshot = GoGame.create("go-1", "black").snapshot();

    expect(snapshot.kind).toBe("go");
    expect(snapshot.boardSize).toBe(9);
    expect(snapshot.board).toEqual(Array.from({ length: 9 }, () => Array(9).fill(null)));
    expect(snapshot.turn).toBe("black");
    expect(snapshot.stateVersion).toBe(0);
    expect(snapshot.legalMoves).toHaveLength(82);
    expect(snapshot.legalMoves.at(-1)).toBe("pass");
    expect(snapshot.legalMoves.slice(0, -1)).toEqual([...snapshot.legalMoves.slice(0, -1)].sort());
  });

  it.each([
    { boardSize: 13 as const, edge: "N13", legalMoveCount: 170 },
    { boardSize: 19 as const, edge: "T19", legalMoveCount: 362 },
  ])("starts a $boardSize x $boardSize game with every intersection legal", ({ boardSize, edge, legalMoveCount }) => {
    const game = GoGame.create(`go-${boardSize}`, "black", boardSize);
    const snapshot = game.snapshot();

    expect(snapshot.boardSize).toBe(boardSize);
    expect(snapshot.board).toHaveLength(boardSize);
    expect(snapshot.board.every((row) => row.length === boardSize && row.every((point) => point === null))).toBe(true);
    expect(snapshot.legalMoves).toHaveLength(legalMoveCount);
    expect(snapshot.legalMoves).toContain("A1");
    expect(snapshot.legalMoves).toContain(edge);
    expect(snapshot.legalMoves).not.toContain(`I${boardSize}`);

    const afterEdge = game.play("player", edge, 0);
    expect(afterEdge.board[0][boardSize - 1]).toBe("black");
    expect(afterEdge.lastMove?.notation).toBe(edge);
  });

  it.each([
    { boardSize: 13 as const, moves: ["N14", "T13", "I13", "A0", "A01"] },
    { boardSize: 19 as const, moves: ["T20", "U19", "I19", "A0", "A01"] },
  ])("rejects malformed and out-of-range moves on a $boardSize x $boardSize board", ({ boardSize, moves }) => {
    const game = GoGame.create(`go-${boardSize}`, "black", boardSize);
    const before = game.snapshot();

    for (const move of moves) {
      expectRuleError(() => game.play("player", move, 0), "illegal_move");
      expect(game.snapshot()).toEqual(before);
    }
  });

  it("applies area scoring across all 19x19 intersections", () => {
    const game = GoGame.create("go-19", "black", 19);
    game.play("player", "T19", 0);
    game.play("gpt", "pass", 1);
    const finished = game.play("player", "pass", 2);

    expect(finished.status).toBe("finished");
    expect(finished.score).toEqual({ black: 361, white: 6.5, komi: 6.5 });
    expect(finished.winner).toBe("black");
  });

  it("captures surrounded opponent groups", () => {
    const game = GoGame.create("go-1", "black");
    playSequence(game, ["B2", "A2", "J9", "B1", "J8", "B3", "J7", "C2"]);

    const snapshot = game.snapshot();
    expect(snapshot.board[7][1]).toBeNull();
    expect(snapshot.captures.white).toBe(1);
  });

  it("rejects suicide without mutating state", () => {
    const game = GoGame.create("go-1", "black");
    playSequence(game, ["J9", "A2", "J8", "B1", "J7", "B3", "J6", "C2"]);
    const before = game.snapshot();

    expectRuleError(() => game.play("player", "B2", 8), "illegal_move");
    expect(game.snapshot()).toEqual(before);
  });

  it("rejects immediate positional superko without mutating state", () => {
    const game = GoGame.create("go-1", "black");
    playSequence(game, ["C4", "D4", "D5", "C3", "E4", "E3", "J9", "D2", "D3"]);
    const before = game.snapshot();

    expectRuleError(() => game.play("gpt", "D4", 9), "illegal_move");
    expect(game.snapshot()).toEqual(before);
    expect(game.snapshot().stateVersion).toBe(9);
  });

  it("rejects occupied, malformed, stale, and wrong-actor moves without mutation", () => {
    const game = GoGame.create("go-1", "black");
    game.play("player", "A1", 0);
    const before = game.snapshot();

    expectRuleError(() => game.play("gpt", "A1", 1), "illegal_move");
    expect(game.snapshot()).toEqual(before);
    expectRuleError(() => game.play("gpt", "I1", 1), "illegal_move");
    expect(game.snapshot()).toEqual(before);
    expectRuleError(() => game.play("gpt", "A2", 0), "stale_version");
    expect(game.snapshot()).toEqual(before);
    expectRuleError(() => game.play("player", "A2", 1), "wrong_actor");
    expect(game.snapshot()).toEqual(before);
  });

  it("finishes after two consecutive passes, scores area, and cannot be played further", () => {
    const game = GoGame.create("go-1", "black");
    game.play("player", "pass", 0);
    const finished = game.play("gpt", "pass", 1);

    expect(finished.status).toBe("finished");
    expect(finished.score?.komi).toBe(6.5);
    expect(finished.winner).toMatch(/^(black|white)$/);
    expect(finished.legalMoves).toEqual([]);
    const before = game.snapshot();
    expectRuleError(() => game.play("player", "A1", 2), "game_finished");
    expect(game.snapshot()).toEqual(before);
  });

  it("scores a real finished position with corner territory and neutral shared space", () => {
    const game = GoGame.create("go-1", "black");
    playSequence(game, ["A2", "J9", "B1", "J8", "pass", "pass"]);

    const finished = game.snapshot();
    expect(finished.status).toBe("finished");
    expect(finished.board[8][0]).toBeNull();
    expect(finished.score).toEqual({ black: 3, white: 8.5, komi: 6.5 });
    expect(finished.winner).toBe("white");
  });

  it("resets the consecutive pass counter after a stone move", () => {
    const game = GoGame.create("go-1", "black");
    game.play("player", "pass", 0);
    const afterStone = game.play("gpt", "A1", 1);

    expect(afterStone.consecutivePasses).toBe(0);
    expect(afterStone.status).toBe("active");
  });

  it("assigns the opening black move to GPT when the player chose white", () => {
    const game = GoGame.create("go-1", "white");

    game.play("gpt", "A1", 0);
    const afterPlayer = game.play("player", "B1", 1);

    expect(afterPlayer.turn).toBe("black");
    expect(afterPlayer.stateVersion).toBe(2);
  });

  it("returns snapshots that cannot mutate live game state", () => {
    const game = GoGame.create("go-1", "black");
    const snapshot = game.snapshot();
    snapshot.board[8][0] = "black";
    snapshot.captures.black = 99;
    snapshot.legalMoves.pop();

    const current = game.snapshot();
    expect(current.board[8][0]).toBeNull();
    expect(current.captures.black).toBe(0);
    expect(current.legalMoves).toHaveLength(82);
  });
});
