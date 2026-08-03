import { describe, expect, it } from "vitest";

import { ChessGame } from "../src/domain/chess-game.js";
import { GameRuleError } from "../src/domain/errors.js";

describe("ChessGame", () => {
  it("starts with twenty legal white moves and version zero", () => {
    const game = ChessGame.create("game-1", "white");
    const snapshot = game.snapshot();

    expect(snapshot.turn).toBe("white");
    expect(snapshot.legalMoves).toHaveLength(20);
    expect(snapshot.stateVersion).toBe(0);
  });

  it("applies UCI moves only for the actor whose color owns the turn", () => {
    const game = ChessGame.create("game-1", "white");

    const afterPlayer = game.play("player", "e2e4", 0);
    const afterGpt = game.play("gpt", "e7e5", 1);

    expect(afterPlayer.turn).toBe("black");
    expect(afterGpt.turn).toBe("white");
    expect(afterGpt.stateVersion).toBe(2);
    expect(afterGpt.moveHistory.map((move) => move.notation)).toEqual(["e2e4", "e7e5"]);
  });

  it("rejects a stale version without mutating the board", () => {
    const game = ChessGame.create("game-1", "white");
    const before = game.snapshot();

    expect(() => game.play("player", "e2e4", 1)).toThrow(GameRuleError);
    expect(game.snapshot()).toEqual(before);
  });

  it("rejects an actor who does not own the current color", () => {
    const game = ChessGame.create("game-1", "white");

    expect(() => game.play("gpt", "e2e4", 0)).toThrow(GameRuleError);
    expect(game.snapshot().stateVersion).toBe(0);
  });

  it("rejects an illegal move without mutation", () => {
    const game = ChessGame.create("game-1", "white");
    const before = game.snapshot();

    expect(() => game.play("player", "e2e5", 0)).toThrow(GameRuleError);
    expect(game.snapshot()).toEqual(before);
  });

  it("reports checkmate and winner black after Fool's Mate", () => {
    const game = ChessGame.create("game-1", "white");

    game.play("player", "f2f3", 0);
    game.play("gpt", "e7e5", 1);
    game.play("player", "g2g4", 2);
    const finished = game.play("gpt", "d8h4", 3);

    expect(finished.status).toBe("finished");
    expect(finished.winner).toBe("black");
  });
});
