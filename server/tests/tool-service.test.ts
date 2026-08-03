import { describe, expect, expectTypeOf, it } from "vitest";

import { GameRuleError } from "../src/domain/errors.js";
import { GameStore } from "../src/game-store.js";
import { ToolService } from "../src/tool-service.js";
import type { GameDifficulty, GameKind, GoBoardSize, StoneColor } from "../src/domain/types.js";

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

describe("ToolService", () => {
  it("creates chess and Go games with distinct generated IDs", () => {
    const service = new ToolService(new GameStore());
    const chess = service.createGame({ game: "chess", playerColor: "white" });
    const go = service.createGame({ game: "go", playerColor: "black" });

    expect(chess.gameId).not.toBe(go.gameId);
    expect(chess.gameId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(go.gameId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(chess.kind).toBe("chess");
    expect(go.kind).toBe("go");
    expect(chess.difficulty).toBe("medium");
    expect(go.difficulty).toBe("medium");
  });

  it.each(["easy", "medium", "hard"] as const)("stores %s difficulty for chess and Go", (difficulty) => {
    const service = new ToolService(new GameStore());
    const chess = service.createGame({ game: "chess", playerColor: "white", difficulty });
    const go = service.createGame({ game: "go", playerColor: "black", boardSize: 13, difficulty });

    expect(chess.difficulty).toBe(difficulty);
    expect(go.difficulty).toBe(difficulty);
    expect(service.getGameState({ gameId: chess.gameId }).difficulty).toBe(difficulty);
    expect(service.getGameState({ gameId: go.gameId }).difficulty).toBe(difficulty);
  });

  it("defaults Go to 9x9 and creates each supported board size", () => {
    const service = new ToolService(new GameStore());
    const defaultGo = service.createGame({ game: "go", playerColor: "black" });
    const mediumGo = service.createGame({ game: "go", playerColor: "black", boardSize: 13 });
    const fullGo = service.createGame({ game: "go", playerColor: "white", boardSize: 19 });

    expect(defaultGo).toMatchObject({ kind: "go", boardSize: 9 });
    expect(mediumGo).toMatchObject({ kind: "go", boardSize: 13 });
    expect(fullGo).toMatchObject({ kind: "go", boardSize: 19 });
  });

  it("returns the authoritative current state and forwards move version checks", () => {
    const service = new ToolService(new GameStore());
    const created = service.createGame({ game: "chess", playerColor: "white" });

    const afterMove = service.playGameMove({
      gameId: created.gameId,
      actor: "player",
      move: "e2e4",
      expectedVersion: 0,
    });
    expect(service.getGameState({ gameId: created.gameId })).toEqual(afterMove);
    expectRuleError(() => service.playGameMove({
      gameId: created.gameId,
      actor: "gpt",
      move: "e7e5",
      expectedVersion: 0,
    }), "stale_version");
  });

  it("resets the same authoritative ID with its original kind, player color, board size, and difficulty", () => {
    const service = new ToolService(new GameStore());
    const created = service.createGame({ game: "go", playerColor: "black", boardSize: 19, difficulty: "hard" });
    service.playGameMove({ gameId: created.gameId, actor: "player", move: "A1", expectedVersion: 0 });

    const reset = service.resetGame({ gameId: created.gameId });
    expect(reset.gameId).toBe(created.gameId);
    expect(reset.kind).toBe("go");
    if (reset.kind !== "go") throw new Error("Expected a Go snapshot.");
    expect(reset.playerColor).toBe("black");
    expect(reset.difficulty).toBe("hard");
    expect(reset.boardSize).toBe(19);
    expect(reset.board).toHaveLength(19);
    expect(reset.legalMoves).toHaveLength(362);
    expect(reset.stateVersion).toBe(0);
    expect(reset.moveHistory).toEqual([]);
    expect(service.getGameState({ gameId: created.gameId })).toEqual(reset);
  });

  it("creates and resets Tic-Tac-Toe without losing difficulty", () => {
    const service = new ToolService(new GameStore());
    const created = service.createGame({ game: "tic-tac-toe", playerColor: "black", difficulty: "hard" });
    const moved = service.playGameMove({ gameId: created.gameId, actor: "player", move: "B2", expectedVersion: 0 });
    expect(moved).toMatchObject({ kind: "tic-tac-toe", stateVersion: 1 });

    const reset = service.resetGame({ gameId: created.gameId });
    expect(reset).toMatchObject({ gameId: created.gameId, kind: "tic-tac-toe", playerColor: "black", difficulty: "hard", stateVersion: 0 });
    expect(reset.legalMoves).toHaveLength(9);
  });

  it("creates, plays, and resets Connect Four without losing difficulty", () => {
    const service = new ToolService(new GameStore());
    const created = service.createGame({ game: "connect-four", playerColor: "black", difficulty: "hard" });
    const moved = service.playGameMove({ gameId: created.gameId, actor: "player", move: "A", expectedVersion: 0 });
    expect(moved).toMatchObject({ kind: "connect-four", stateVersion: 1, difficulty: "hard" });

    const reset = service.resetGame({ gameId: created.gameId });
    expect(reset).toMatchObject({ gameId: created.gameId, kind: "connect-four", playerColor: "black", difficulty: "hard", stateVersion: 0 });
    expect(reset.legalMoves).toEqual(["A", "B", "C", "D", "E", "F", "G"]);
  });

  it("creates, plays, and resets Reversi without losing difficulty", () => {
    const service = new ToolService(new GameStore());
    const created = service.createGame({ game: "reversi", playerColor: "black", difficulty: "hard" });
    const moved = service.playGameMove({ gameId: created.gameId, actor: "player", move: "C4", expectedVersion: 0 });
    expect(moved).toMatchObject({ kind: "reversi", stateVersion: 1, difficulty: "hard", score: { black: 4, white: 1 } });
    const reset = service.resetGame({ gameId: created.gameId });
    expect(reset).toMatchObject({ gameId: created.gameId, kind: "reversi", playerColor: "black", difficulty: "hard", stateVersion: 0 });
    if (reset.kind !== "reversi") throw new Error("Expected a Reversi snapshot.");
    expect(reset.legalMoves).toEqual(["C4", "D3", "E6", "F5"]);
  });

  it("returns not_found for unknown IDs", () => {
    const service = new ToolService(new GameStore());

    expectRuleError(() => service.getGameState({ gameId: "missing" }), "not_found");
    expectRuleError(() => service.playGameMove({
      gameId: "missing", actor: "player", move: "A1", expectedVersion: 0,
    }), "not_found");
    expectRuleError(() => service.resetGame({ gameId: "missing" }), "not_found");
  });

  it("exposes game kind and stone color as narrow TypeScript inputs", () => {
    expectTypeOf<GameKind>().toEqualTypeOf<"chess" | "go" | "tic-tac-toe" | "connect-four" | "reversi">();
    expectTypeOf<GameDifficulty>().toEqualTypeOf<"easy" | "medium" | "hard">();
    expectTypeOf<StoneColor>().toEqualTypeOf<"white" | "black">();
    expectTypeOf<GoBoardSize>().toEqualTypeOf<9 | 13 | 19>();
  });
});
