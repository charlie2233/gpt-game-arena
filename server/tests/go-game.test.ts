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
    expect(snapshot.difficulty).toBe("medium");
    expect(snapshot.boardSize).toBe(9);
    expect(snapshot.board).toEqual(Array.from({ length: 9 }, () => Array(9).fill(null)));
    expect(snapshot.turn).toBe("black");
    expect(snapshot.stateVersion).toBe(0);
    expect(snapshot.legalMoves).toHaveLength(82);
    expect(snapshot.legalMoves.at(-1)).toBe("pass");
    expect(snapshot.legalMoves.slice(0, -1)).toEqual([...snapshot.legalMoves.slice(0, -1)].sort());
  });

  it.each(["easy", "medium", "hard"] as const)("keeps %s difficulty in every snapshot", (difficulty) => {
    const game = GoGame.create("go-1", "black", 9, difficulty);

    expect(game.snapshot().difficulty).toBe(difficulty);
    expect(game.play("player", "A1", 0).difficulty).toBe(difficulty);
  });

  it("starts an imported position behind a review gate and advances one authoritative version when confirmed", () => {
    const game = GoGame.create("go-photo", "white", 9, "hard", 0, {
      source: "imported",
      blackStones: ["J9", "D4"],
      whiteStones: ["E4", "E5"],
      turn: "white",
      captures: { black: 2, white: 3 },
    });

    const snapshot = game.snapshot();
    expect(snapshot).toMatchObject({
      gameId: "go-photo",
      playerColor: "white",
      turn: "white",
      difficulty: "hard",
      stateVersion: 0,
      resetEpoch: 0,
      importReview: "pending",
      moveHistory: [],
      captures: { black: 2, white: 3 },
      legalMoves: [],
      message: "Imported position awaiting confirmation.",
      initialPosition: {
        source: "imported",
        blackStones: ["D4", "J9"],
        whiteStones: ["E4", "E5"],
        turn: "white",
        captures: { black: 2, white: 3 },
      },
    });
    expect(snapshot.board[0][8]).toBe("black");
    expect(snapshot.board[5][3]).toBe("black");
    expect(snapshot.board[5][4]).toBe("white");
    expect(snapshot.board[4][4]).toBe("white");
    expect(snapshot).not.toHaveProperty("lastMove");

    expectRuleError(() => game.play("player", "A1", 0), "import_review_required");
    expect(game.snapshot()).toEqual(snapshot);

    const confirmed = game.confirmImportedPosition(0);
    expect(confirmed).toMatchObject({
      stateVersion: 1,
      importReview: "confirmed",
      message: "Imported position confirmed. White to move.",
    });
    expect(confirmed.legalMoves).not.toContain("D4");
    expect(confirmed.legalMoves).not.toContain("E4");
    expectRuleError(() => game.confirmImportedPosition(0), "stale_version");
    expectRuleError(() => game.confirmImportedPosition(1), "import_review_unavailable");

    const played = game.play("player", "A1", 1);
    expect(played).toMatchObject({ stateVersion: 2, importReview: "confirmed", turn: "black", lastMove: { actor: "player", color: "white", notation: "A1" } });
    expect(played.board[8][0]).toBe("white");
    expect(played.initialPosition).toEqual(snapshot.initialPosition);
  });

  it("does not allow ordinary Go games to be import-confirmed", () => {
    const game = GoGame.create("go-new", "black");

    expectRuleError(() => game.confirmImportedPosition(0), "import_review_unavailable");
    expect(game.snapshot()).not.toHaveProperty("importReview");
  });

  it.each([
    { label: "duplicate stones", blackStones: ["D4", "D4"], whiteStones: [] },
    { label: "overlapping colors", blackStones: ["D4"], whiteStones: ["D4"] },
    { label: "out-of-range coordinates", blackStones: ["T19"], whiteStones: [] },
    { label: "groups with no liberties", blackStones: ["A1"], whiteStones: ["A2", "B1"] },
  ])("rejects imported $label without producing a game", ({ blackStones, whiteStones }) => {
    expectRuleError(() => GoGame.create("bad-photo", "black", 9, "medium", 0, {
      source: "imported",
      blackStones,
      whiteStones,
      turn: "black",
      captures: { black: 0, white: 0 },
    }), "invalid_position");
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
    const game = GoGame.create("go-1", "black", 9, "medium", 0, {
      source: "imported",
      blackStones: ["D4"],
      whiteStones: ["E4"],
      turn: "black",
      captures: { black: 0, white: 0 },
    });
    game.confirmImportedPosition(0);
    const snapshot = game.snapshot();
    snapshot.board[8][0] = "black";
    snapshot.captures.black = 99;
    snapshot.legalMoves.pop();
    snapshot.initialPosition?.blackStones.push("A1");
    if (snapshot.initialPosition) snapshot.initialPosition.captures.black = 99;

    const current = game.snapshot();
    expect(current.board[8][0]).toBeNull();
    expect(current.captures.black).toBe(0);
    expect(current.importReview).toBe("confirmed");
    expect(current.initialPosition).toMatchObject({ blackStones: ["D4"], captures: { black: 0 } });
    expect(current.legalMoves).toHaveLength(80);
  });
});
