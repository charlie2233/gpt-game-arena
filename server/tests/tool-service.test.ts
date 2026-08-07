import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, expectTypeOf, it } from "vitest";

import { GameRuleError } from "../src/domain/errors.js";
import { executeTool, toolInputSchemas, toToolFailure } from "../src/tool-contracts.js";
import { GameStore } from "../src/game-store.js";
import { ToolService } from "../src/tool-service.js";
import type { GameDifficulty, GameKind, GoBoardSize, StoneColor } from "../src/domain/types.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function temporaryStorePath(): string {
  const directory = mkdtempSync(join(tmpdir(), "gpt-game-arena-store-"));
  temporaryDirectories.push(directory);
  return join(directory, "game-sessions.json");
}

function persistedBasketballSeed(persistencePath: string, gameId: string): string {
  const document = JSON.parse(readFileSync(persistencePath, "utf8")) as {
    sessions?: Array<{ gameId?: unknown; kind?: unknown; basketballOutcomeSeed?: unknown }>;
  };
  const record = document.sessions?.find((session) => session.gameId === gameId && session.kind === "basketball");
  if (typeof record?.basketballOutcomeSeed !== "string") {
    throw new Error("Expected a persisted Court Duel outcome seed.");
  }
  return record.basketballOutcomeSeed;
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

describe("ToolService", () => {
  it("reports a full save store without leaking internal error details", () => {
    const failure = toToolFailure(new GameRuleError("store_full", "SECRET_STORE_DETAIL"));
    expect(failure).toEqual({
      isError: true,
      content: [{
        type: "text",
        text: "store_full: The game save limit has been reached. Existing saved games were preserved.",
      }],
    });
    expect(JSON.stringify(failure)).not.toContain("SECRET_STORE_DETAIL");
  });

  it("reports an incompatible legacy save without leaking its internal record", () => {
    const failure = toToolFailure(new GameRuleError("save_incompatible", "SECRET_LEGACY_RECORD"));
    expect(failure).toEqual({
      isError: true,
      content: [{
        type: "text",
        text: "save_incompatible: This legacy Court Duel save is preserved but cannot be resumed because its private shot-outcome data is missing.",
      }],
    });
    expect(JSON.stringify(failure)).not.toContain("SECRET_LEGACY_RECORD");
  });

  it("preserves whitespace-padded moves for domain rejection instead of normalizing them", () => {
    const service = new ToolService(new GameStore());
    const created = service.createGame({ game: "tic-tac-toe", playerColor: "black" });
    expect(toolInputSchemas.play_game_move.parse({ gameId: created.gameId, actor: "player", move: " A1 ", expectedVersion: 0 }).move).toBe(" A1 ");
    expectRuleError(() => executeTool(service, "play_game_move", { gameId: created.gameId, actor: "player", move: " A1 ", expectedVersion: 0 }), "illegal_move");
    expect(service.getGameState({ gameId: created.gameId })).toMatchObject({ stateVersion: 0, moveHistory: [] });
    const played = executeTool(service, "play_game_move", { gameId: created.gameId, actor: "player", move: "A1", expectedVersion: 0, expectedResetEpoch: 0 });
    expect(played.structuredContent).toMatchObject({ stateVersion: 1, moveHistory: [{ notation: "A1" }] });
    expect(played.content[0].text).toMatch(/^MOVE_CONFIRMED /);
  });

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
    expect(chess.resetEpoch).toBe(0);
    expect(go.resetEpoch).toBe(0);
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

  it("imports a photo-derived Go position, confirms it exactly, and preserves the seed through the first cloned move and reset", () => {
    const service = new ToolService(new GameStore());
    const imported = executeTool(service, "import_go_position", {
      boardSize: 13,
      playerColor: "white",
      turn: "white",
      blackStones: ["D10", "K4"],
      whiteStones: ["K10", "D4"],
      difficulty: "hard",
    });

    expect(imported.content[0].text).toMatch(/^IMPORT_CONFIRMED /);
    expect(imported.structuredContent).toMatchObject({
      kind: "go",
      boardSize: 13,
      playerColor: "white",
      turn: "white",
      difficulty: "hard",
      stateVersion: 0,
      resetEpoch: 0,
      importReview: "pending",
      legalMoves: [],
      moveHistory: [],
      captures: { black: 0, white: 0 },
      initialPosition: {
        source: "imported",
        blackStones: ["D10", "K4"],
        whiteStones: ["D4", "K10"],
        turn: "white",
      },
    });
    const receipt = JSON.parse(imported.content[0].text.slice("IMPORT_CONFIRMED ".length));
    expect(receipt).toMatchObject({
      gameId: imported.structuredContent.gameId,
      boardSize: 13,
      playerColor: "white",
      gptColor: "black",
      turn: "white",
      blackStones: 2,
      whiteStones: 2,
      resetEpoch: 0,
      stateVersion: 0,
    });

    expectRuleError(() => service.playGameMove({
      gameId: imported.structuredContent.gameId,
      actor: "player",
      move: "E5",
      expectedVersion: 0,
      expectedResetEpoch: 0,
    }), "import_review_required");
    expect(service.getGameState({ gameId: imported.structuredContent.gameId })).toEqual(imported.structuredContent);
    expectRuleError(() => service.confirmImportedGoPosition({
      gameId: imported.structuredContent.gameId,
      expectedVersion: 1,
      expectedResetEpoch: 0,
    }), "stale_version");
    expectRuleError(() => service.confirmImportedGoPosition({
      gameId: imported.structuredContent.gameId,
      expectedVersion: 0,
      expectedResetEpoch: 1,
    }), "stale_version");

    const confirmed = executeTool(service, "confirm_imported_go_position", {
      gameId: imported.structuredContent.gameId,
      expectedVersion: 0,
      expectedResetEpoch: 0,
    });
    expect(confirmed.structuredContent).toMatchObject({ stateVersion: 1, importReview: "confirmed" });
    expect(confirmed.content).toEqual([{ type: "text", text: `IMPORT_REVIEW_CONFIRMED ${JSON.stringify({
      gameId: imported.structuredContent.gameId,
      resetEpoch: 0,
      previousVersion: 0,
      stateVersion: 1,
      importReview: "confirmed",
    })}` }]);
    expectRuleError(() => service.confirmImportedGoPosition({
      gameId: imported.structuredContent.gameId,
      expectedVersion: 1,
      expectedResetEpoch: 0,
    }), "import_review_unavailable");

    const moved = service.playGameMove({
      gameId: imported.structuredContent.gameId,
      actor: "player",
      move: "E5",
      expectedVersion: 1,
      expectedResetEpoch: 0,
    });
    if (moved.kind !== "go") throw new Error("Expected a Go snapshot.");
    expect(moved.board[13 - 5][4]).toBe("white");
    expect(moved.board[13 - 10][3]).toBe("black");
    expect(moved).toMatchObject({ stateVersion: 2, importReview: "confirmed" });
    expect(moved.initialPosition).toEqual(imported.structuredContent.initialPosition);

    const reset = service.resetGame({ gameId: moved.gameId });
    expect(reset).toMatchObject({
      gameId: moved.gameId,
      stateVersion: 0,
      resetEpoch: 1,
      importReview: "pending",
      legalMoves: [],
      moveHistory: [],
      initialPosition: imported.structuredContent.initialPosition,
    });
    if (reset.kind !== "go") throw new Error("Expected a Go snapshot.");
    expect(reset.board[13 - 5][4]).toBeNull();
    expect(reset.board[13 - 10][3]).toBe("black");
    expect(reset.board[13 - 4][10 - 1]).toBe("black");
    expectRuleError(() => service.playGameMove({
      gameId: reset.gameId,
      actor: "player",
      move: "E5",
      expectedVersion: 0,
      expectedResetEpoch: 1,
    }), "import_review_required");
    const reconfirmed = service.confirmImportedGoPosition({
      gameId: reset.gameId,
      expectedVersion: 0,
      expectedResetEpoch: 1,
    });
    expect(reconfirmed).toMatchObject({ resetEpoch: 1, stateVersion: 1, importReview: "confirmed" });
  });

  it("rejects import confirmation for ordinary games and validates the exact confirmation input", () => {
    expect(toolInputSchemas.confirm_imported_go_position.safeParse({
      gameId: "game-1", expectedVersion: 0, expectedResetEpoch: 0,
    }).success).toBe(true);
    expect(toolInputSchemas.confirm_imported_go_position.safeParse({
      gameId: "game-1", expectedVersion: 0,
    }).success).toBe(false);
    expect(toolInputSchemas.confirm_imported_go_position.safeParse({
      gameId: "game-1", expectedVersion: 0, expectedResetEpoch: 0, confirmed: true,
    }).success).toBe(false);

    const service = new ToolService(new GameStore());
    const ordinary = service.createGame({ game: "go", playerColor: "black" });
    expectRuleError(() => service.confirmImportedGoPosition({
      gameId: ordinary.gameId,
      expectedVersion: 0,
      expectedResetEpoch: 0,
    }), "import_review_unavailable");
    expect(service.getGameState({ gameId: ordinary.gameId })).toEqual(ordinary);
  });

  it("rejects malformed and unplayable imported positions before storage", () => {
    expect(toolInputSchemas.import_go_position.safeParse({
      boardSize: 9,
      playerColor: "black",
      turn: "black",
      blackStones: ["D4", "D4"],
      whiteStones: [],
    }).success).toBe(false);
    expect(toolInputSchemas.import_go_position.safeParse({
      boardSize: 9,
      playerColor: "black",
      turn: "black",
      blackStones: ["D4"],
      whiteStones: ["D4"],
    }).success).toBe(false);
    expect(toolInputSchemas.import_go_position.safeParse({
      boardSize: 9,
      playerColor: "black",
      turn: "black",
      blackStones: ["I4"],
      whiteStones: [],
    }).success).toBe(false);

    const service = new ToolService(new GameStore());
    expectRuleError(() => service.importGoPosition({
      boardSize: 9,
      playerColor: "black",
      turn: "black",
      blackStones: ["A1"],
      whiteStones: ["A2", "B1"],
      captures: { black: 0, white: 0 },
    }), "invalid_position");
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

  it("ends an active game authoritatively even while GPT owns the turn", () => {
    const service = new ToolService(new GameStore());
    const created = service.createGame({ game: "chess", playerColor: "white", difficulty: "hard" });
    const moved = service.playGameMove({
      gameId: created.gameId,
      actor: "player",
      move: "e2e4",
      expectedVersion: 0,
      expectedResetEpoch: 0,
    });
    expect(moved.turn).toBe("black");
    const ended = service.endGame({
      gameId: created.gameId,
      confirmed: true,
      expectedVersion: 1,
      expectedResetEpoch: 0,
    });

    if (ended.kind !== "chess" || moved.kind !== "chess") throw new Error("Expected Chess snapshots.");
    expect(ended).toMatchObject({
      gameId: created.gameId,
      status: "finished",
      finishReason: "ended",
      stateVersion: 2,
      resetEpoch: 0,
      legalMoves: [],
      message: "Game ended.",
    });
    expect(ended).not.toHaveProperty("winner");
    expect(ended.board).toEqual(moved.board);
    expect(ended.moveHistory).toEqual(moved.moveHistory);
    expect(ended.lastMove).toEqual(moved.lastMove);
    expect(ended.turn).toBe(moved.turn);
    expect(service.getGameState({ gameId: created.gameId })).toEqual(ended);
  });

  it("rejects stale, repeated, and post-end mutations without changing the game, then resets cleanly", () => {
    const service = new ToolService(new GameStore());
    const created = service.createGame({ game: "go", playerColor: "black", boardSize: 13 });

    expectRuleError(() => service.endGame({
      gameId: created.gameId,
      confirmed: true,
      expectedVersion: 1,
      expectedResetEpoch: 0,
    }), "stale_version");
    expectRuleError(() => service.endGame({
      gameId: created.gameId,
      confirmed: true,
      expectedVersion: 0,
      expectedResetEpoch: 1,
    }), "stale_version");
    expect(service.getGameState({ gameId: created.gameId })).toEqual(created);

    const ended = service.endGame({
      gameId: created.gameId,
      confirmed: true,
      expectedVersion: 0,
      expectedResetEpoch: 0,
    });
    expectRuleError(() => service.endGame({
      gameId: created.gameId,
      confirmed: true,
      expectedVersion: ended.stateVersion,
      expectedResetEpoch: 0,
    }), "game_finished");
    expectRuleError(() => service.playGameMove({
      gameId: created.gameId,
      actor: "player",
      move: "D4",
      expectedVersion: ended.stateVersion,
      expectedResetEpoch: 0,
    }), "game_finished");
    expect(service.getGameState({ gameId: created.gameId })).toEqual(ended);

    const reset = service.resetGame({ gameId: created.gameId });
    expect(reset).toMatchObject({
      gameId: created.gameId,
      kind: "go",
      boardSize: 13,
      status: "active",
      stateVersion: 0,
      resetEpoch: 1,
      moveHistory: [],
    });
    expect(reset).not.toHaveProperty("finishReason");
  });

  it("rejects a delayed pre-reset move even when stateVersion returns to zero", () => {
    const service = new ToolService(new GameStore());
    const created = service.createGame({ game: "tic-tac-toe", playerColor: "white" });
    expect(created).toMatchObject({ resetEpoch: 0, stateVersion: 0, turn: "black" });
    const reset = service.resetGame({ gameId: created.gameId });
    expect(reset).toMatchObject({ resetEpoch: 1, stateVersion: 0, moveHistory: [] });
    expectRuleError(() => service.playGameMove({
      gameId: created.gameId,
      actor: "gpt",
      move: "A1",
      expectedVersion: 0,
      expectedResetEpoch: 0,
    }), "stale_version");
    expectRuleError(() => service.playGameMove({
      gameId: created.gameId,
      actor: "gpt",
      move: "A1",
      expectedVersion: 0,
    }), "stale_version");
    expect(service.getGameState({ gameId: created.gameId })).toMatchObject({ resetEpoch: 1, stateVersion: 0, moveHistory: [] });
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

  it("increments the reset epoch while preserving the game identity and configuration", () => {
    const service = new ToolService(new GameStore());
    const created = service.createGame({
      game: "go",
      playerColor: "white",
      boardSize: 13,
      difficulty: "easy",
    });

    expect(created.resetEpoch).toBe(0);
    const firstReset = service.resetGame({ gameId: created.gameId });
    expect(firstReset).toMatchObject({
      gameId: created.gameId,
      kind: "go",
      playerColor: "white",
      difficulty: "easy",
      boardSize: 13,
      stateVersion: 0,
      resetEpoch: 1,
    });

    const moved = service.playGameMove({
      gameId: created.gameId,
      actor: "gpt",
      move: "D4",
      expectedVersion: 0,
      expectedResetEpoch: 1,
    });
    expect(moved.resetEpoch).toBe(1);

    const secondReset = service.resetGame({ gameId: created.gameId });
    expect(secondReset).toMatchObject({
      gameId: created.gameId,
      kind: "go",
      playerColor: "white",
      difficulty: "easy",
      boardSize: 13,
      stateVersion: 0,
      resetEpoch: 2,
    });
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

  it("creates, plays, and resets Mini 8-Ball without losing difficulty", () => {
    const service = new ToolService(new GameStore());
    const created = service.createGame({ game: "pool", playerColor: "black", difficulty: "hard" });
    const moved = service.playGameMove({ gameId: created.gameId, actor: "player", move: "POT:1:TM", expectedVersion: 0, expectedResetEpoch: 0 });
    expect(moved).toMatchObject({ kind: "pool", stateVersion: 1, difficulty: "hard", turn: "black", cueBall: { x: 32, y: 9 } });
    const reset = service.resetGame({ gameId: created.gameId });
    expect(reset).toMatchObject({ gameId: created.gameId, kind: "pool", playerColor: "black", difficulty: "hard", stateVersion: 0, resetEpoch: 1, cueBall: { x: 12, y: 25 } });
  });

  it("creates, plays, and resets Court Duel without losing difficulty", () => {
    const service = new ToolService(new GameStore());
    const created = service.createGame({ game: "basketball", playerColor: "black", difficulty: "hard" });
    const moved = service.playGameMove({ gameId: created.gameId, actor: "player", move: "drive", expectedVersion: 0, expectedResetEpoch: 0 });
    expect(moved).toMatchObject({ kind: "basketball", stateVersion: 1, difficulty: "hard", turn: "white", attempts: { black: 1, white: 0 }, energy: { black: 2, white: 4 } });
    const reset = service.resetGame({ gameId: created.gameId });
    expect(reset).toMatchObject({ gameId: created.gameId, kind: "basketball", playerColor: "black", difficulty: "hard", stateVersion: 0, resetEpoch: 1, score: { black: 0, white: 0 }, energy: { black: 4, white: 4 } });
  });

  it("returns not_found for unknown IDs", () => {
    const service = new ToolService(new GameStore());

    expectRuleError(() => service.getGameState({ gameId: "missing" }), "not_found");
    expectRuleError(() => service.playGameMove({
      gameId: "missing", actor: "player", move: "A1", expectedVersion: 0,
    }), "not_found");
    expectRuleError(() => service.endGame({
      gameId: "missing", confirmed: true, expectedVersion: 0, expectedResetEpoch: 0,
    }), "not_found");
    expectRuleError(() => service.resetGame({ gameId: "missing" }), "not_found");
  });

  it("replays moves, manual ends, and resets for all seven game kinds after process restarts", () => {
    const persistencePath = temporaryStorePath();
    const service = new ToolService(new GameStore({ persistencePath }));
    const cases = [
      { game: "chess", playerColor: "white", move: "e2e4" },
      { game: "go", playerColor: "black", boardSize: 13, move: "D4" },
      { game: "tic-tac-toe", playerColor: "black", move: "A1" },
      { game: "connect-four", playerColor: "black", move: "D" },
      { game: "reversi", playerColor: "black", move: "C4" },
      { game: "pool", playerColor: "black", move: "POT:1:TM" },
      { game: "basketball", playerColor: "black", move: "drive" },
    ] as const;

    const expected = cases.map((testCase) => {
      const created = service.createGame({
        game: testCase.game,
        playerColor: testCase.playerColor,
        ...(testCase.game === "go" ? { boardSize: testCase.boardSize } : {}),
        difficulty: "hard",
      });
      return service.playGameMove({
        gameId: created.gameId,
        actor: "player",
        move: testCase.move,
        expectedVersion: 0,
      });
    });

    const restartedAfterMoves = new ToolService(new GameStore({ persistencePath }));
    for (const snapshot of expected) {
      expect(restartedAfterMoves.getGameState({ gameId: snapshot.gameId })).toEqual(snapshot);
    }

    const ended = expected.map((snapshot) => restartedAfterMoves.endGame({
      gameId: snapshot.gameId,
      confirmed: true,
      expectedVersion: snapshot.stateVersion,
      expectedResetEpoch: snapshot.resetEpoch ?? 0,
    }));
    const restartedAfterEnds = new ToolService(new GameStore({ persistencePath }));
    for (const snapshot of ended) {
      expect(restartedAfterEnds.getGameState({ gameId: snapshot.gameId })).toEqual(snapshot);
      expect(snapshot).toMatchObject({ status: "finished", finishReason: "ended" });
    }

    const reset = ended.map((snapshot) => restartedAfterEnds.resetGame({ gameId: snapshot.gameId }));
    const restartedAfterResets = new ToolService(new GameStore({ persistencePath }));
    for (const snapshot of reset) {
      expect(restartedAfterResets.getGameState({ gameId: snapshot.gameId })).toEqual(snapshot);
      expect(snapshot).toMatchObject({ status: "active", stateVersion: 0, resetEpoch: 1, moveHistory: [] });
    }
  }, 20_000);

  it("keeps the Court Duel seed private while preserving its sequence through clone, end, reset, and restart", () => {
    const primaryPath = temporaryStorePath();
    const replayPath = temporaryStorePath();
    const primary = new ToolService(new GameStore({ persistencePath: primaryPath }));
    const createdOutput = executeTool(primary, "create_game", {
      game: "basketball",
      playerColor: "black",
      difficulty: "hard",
    });
    const created = createdOutput.structuredContent;
    const seed = persistedBasketballSeed(primaryPath, created.gameId);

    expect(seed).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(createdOutput)).not.toContain(seed);
    expect(JSON.stringify(createdOutput)).not.toMatch(/basketballOutcomeSeed|outcomeSeed/);

    const firstOutput = executeTool(primary, "play_game_move", {
      gameId: created.gameId,
      actor: "player",
      move: "drive",
      expectedVersion: 0,
      expectedResetEpoch: 0,
    });
    expect(persistedBasketballSeed(primaryPath, created.gameId)).toBe(seed);
    expect(JSON.stringify(firstOutput)).not.toContain(seed);
    writeFileSync(replayPath, readFileSync(primaryPath, "utf8"), "utf8");

    const replay = new ToolService(new GameStore({ persistencePath: replayPath }));
    const primaryReply = primary.playGameMove({
      gameId: created.gameId,
      actor: "gpt",
      move: "three",
      expectedVersion: 1,
      expectedResetEpoch: 0,
    });
    const replayReply = replay.playGameMove({
      gameId: created.gameId,
      actor: "gpt",
      move: "three",
      expectedVersion: 1,
      expectedResetEpoch: 0,
    });
    expect(replayReply).toEqual(primaryReply);
    expect(persistedBasketballSeed(primaryPath, created.gameId)).toBe(seed);
    expect(persistedBasketballSeed(replayPath, created.gameId)).toBe(seed);

    const primaryEnded = primary.endGame({
      gameId: created.gameId,
      confirmed: true,
      expectedVersion: 2,
      expectedResetEpoch: 0,
    });
    const replayEnded = replay.endGame({
      gameId: created.gameId,
      confirmed: true,
      expectedVersion: 2,
      expectedResetEpoch: 0,
    });
    expect(replayEnded).toEqual(primaryEnded);
    expect(persistedBasketballSeed(primaryPath, created.gameId)).toBe(seed);

    const primaryReset = primary.resetGame({ gameId: created.gameId });
    const replayReset = replay.resetGame({ gameId: created.gameId });
    expect(replayReset).toEqual(primaryReset);
    expect(primaryReset).toMatchObject({ resetEpoch: 1, stateVersion: 0, shotResults: [] });
    expect(persistedBasketballSeed(primaryPath, created.gameId)).toBe(seed);
    expect(persistedBasketballSeed(replayPath, created.gameId)).toBe(seed);

    const primaryAfterReset = primary.playGameMove({
      gameId: created.gameId,
      actor: "player",
      move: "drive",
      expectedVersion: 0,
      expectedResetEpoch: 1,
    });
    const replayAfterReset = replay.playGameMove({
      gameId: created.gameId,
      actor: "player",
      move: "drive",
      expectedVersion: 0,
      expectedResetEpoch: 1,
    });
    expect(replayAfterReset).toEqual(primaryAfterReset);
    expect(JSON.stringify(primaryAfterReset)).not.toContain(seed);
  });

  it("persists pending/confirmed imported review state, later moves, and a reset back to pending", () => {
    const persistencePath = temporaryStorePath();
    const service = new ToolService(new GameStore({ persistencePath }));
    const imported = service.importGoPosition({
      boardSize: 19,
      playerColor: "black",
      turn: "black",
      blackStones: ["D16", "Q4"],
      whiteStones: ["Q16", "D4"],
      captures: { black: 1, white: 2 },
      difficulty: "medium",
    });
    const pendingRestart = new ToolService(new GameStore({ persistencePath }));
    expect(pendingRestart.getGameState({ gameId: imported.gameId })).toEqual(imported);
    expectRuleError(() => pendingRestart.playGameMove({
      gameId: imported.gameId,
      actor: "player",
      move: "K10",
      expectedVersion: 0,
      expectedResetEpoch: 0,
    }), "import_review_required");

    const confirmed = pendingRestart.confirmImportedGoPosition({
      gameId: imported.gameId,
      expectedVersion: 0,
      expectedResetEpoch: 0,
    });
    expect(confirmed).toMatchObject({ importReview: "confirmed", stateVersion: 1 });

    const confirmedRestart = new ToolService(new GameStore({ persistencePath }));
    expect(confirmedRestart.getGameState({ gameId: imported.gameId })).toEqual(confirmed);
    const moved = confirmedRestart.playGameMove({
      gameId: imported.gameId,
      actor: "player",
      move: "K10",
      expectedVersion: 1,
      expectedResetEpoch: 0,
    });

    const restarted = new ToolService(new GameStore({ persistencePath }));
    expect(restarted.getGameState({ gameId: imported.gameId })).toEqual(moved);

    const reset = restarted.resetGame({ gameId: imported.gameId });
    expect(reset).toMatchObject({ importReview: "pending", stateVersion: 0, resetEpoch: 1, moveHistory: [] });
    const resetRestart = new ToolService(new GameStore({ persistencePath }));
    expect(resetRestart.getGameState({ gameId: imported.gameId })).toEqual(reset);
    expectRuleError(() => resetRestart.playGameMove({
      gameId: imported.gameId,
      actor: "player",
      move: "K10",
      expectedVersion: 0,
      expectedResetEpoch: 1,
    }), "import_review_required");
  });

  it("persists a read-based TTL refresh across a process restart", () => {
    const persistencePath = temporaryStorePath();
    let time = 0;
    const service = new ToolService(new GameStore({ persistencePath, ttlMs: 1_000, now: () => time }));
    const created = service.createGame({ game: "chess", playerColor: "white" });

    time = 900;
    expect(service.getGameState({ gameId: created.gameId })).toEqual(created);
    time = 1_500;

    const restarted = new ToolService(new GameStore({ persistencePath, ttlMs: 1_000, now: () => time }));
    expect(restarted.getGameState({ gameId: created.gameId })).toEqual(created);
  });

  it("ignores expired move histories before replaying active sessions", () => {
    const persistencePath = temporaryStorePath();
    writeFileSync(persistencePath, JSON.stringify({
      formatVersion: 1,
      sessions: [{
        gameId: "expired-broken-game",
        kind: "chess",
        playerColor: "white",
        difficulty: "medium",
        events: [{ type: "move", actor: "player", move: "a1a8" }],
        lastAccessedAt: 0,
      }],
    }), "utf8");

    const restarted = new ToolService(new GameStore({ persistencePath, ttlMs: 1_000, now: () => 5_000 }));
    expectRuleError(() => restarted.getGameState({ gameId: "expired-broken-game" }), "not_found");
  });

  it("does not persist a failed stale move", () => {
    const persistencePath = temporaryStorePath();
    const service = new ToolService(new GameStore({ persistencePath, now: () => 123_456 }));
    const created = service.createGame({ game: "chess", playerColor: "white" });
    const moved = service.playGameMove({ gameId: created.gameId, actor: "player", move: "e2e4", expectedVersion: 0 });
    const beforeFailure = readFileSync(persistencePath, "utf8");

    expectRuleError(() => service.playGameMove({
      gameId: created.gameId,
      actor: "gpt",
      move: "e7e5",
      expectedVersion: 0,
    }), "stale_version");

    expect(readFileSync(persistencePath, "utf8")).toBe(beforeFailure);
    const restarted = new ToolService(new GameStore({ persistencePath, now: () => 123_456 }));
    expect(restarted.getGameState({ gameId: created.gameId })).toEqual(moved);
  });

  it("persists reset as an empty replay epoch", () => {
    const persistencePath = temporaryStorePath();
    const service = new ToolService(new GameStore({ persistencePath }));
    const created = service.createGame({
      game: "go",
      playerColor: "black",
      boardSize: 19,
      difficulty: "hard",
    });
    service.playGameMove({ gameId: created.gameId, actor: "player", move: "D4", expectedVersion: 0 });
    const reset = service.resetGame({ gameId: created.gameId });

    const restarted = new ToolService(new GameStore({ persistencePath }));
    expect(restarted.getGameState({ gameId: created.gameId })).toEqual(reset);
    expect(reset).toMatchObject({
      stateVersion: 0,
      resetEpoch: 1,
      moveHistory: [],
      boardSize: 19,
      difficulty: "hard",
    });

    const movedAfterRestart = restarted.playGameMove({
      gameId: created.gameId,
      actor: "player",
      move: "D4",
      expectedVersion: 0,
      expectedResetEpoch: 1,
    });
    expect(movedAfterRestart.resetEpoch).toBe(1);
  });

  it("persists a terminal end event and restores the exact finished snapshot", () => {
    const persistencePath = temporaryStorePath();
    const service = new ToolService(new GameStore({ persistencePath, now: () => 321 }));
    const created = service.createGame({ game: "connect-four", playerColor: "black", difficulty: "easy" });
    const moved = service.playGameMove({
      gameId: created.gameId,
      actor: "player",
      move: "D",
      expectedVersion: 0,
      expectedResetEpoch: 0,
    });
    const ended = service.endGame({
      gameId: created.gameId,
      confirmed: true,
      expectedVersion: moved.stateVersion,
      expectedResetEpoch: 0,
    });

    const document = JSON.parse(readFileSync(persistencePath, "utf8")) as {
      formatVersion: number;
      sessions: Array<{ events: unknown[] }>;
    };
    expect(document.formatVersion).toBe(2);
    expect(document.sessions[0].events).toEqual([
      { type: "move", actor: "player", move: "D" },
      { type: "end" },
    ]);

    const restarted = new ToolService(new GameStore({ persistencePath, now: () => 321 }));
    expect(restarted.getGameState({ gameId: created.gameId })).toEqual(ended);
    expectRuleError(() => restarted.playGameMove({
      gameId: created.gameId,
      actor: "gpt",
      move: "D",
      expectedVersion: ended.stateVersion,
      expectedResetEpoch: 0,
    }), "game_finished");
  });

  it("loads legacy persisted sessions without a reset epoch as epoch zero", () => {
    const persistencePath = temporaryStorePath();
    writeFileSync(persistencePath, JSON.stringify({
      formatVersion: 1,
      sessions: [{
        gameId: "legacy-game",
        kind: "chess",
        playerColor: "white",
        difficulty: "medium",
        events: [],
        lastAccessedAt: 100,
      }],
    }), "utf8");

    const service = new ToolService(new GameStore({ persistencePath, now: () => 100 }));
    expect(service.getGameState({ gameId: "legacy-game" }).resetEpoch).toBe(0);

    const persisted = JSON.parse(readFileSync(persistencePath, "utf8")) as {
      sessions: Array<{ resetEpoch?: number }>;
    };
    expect(persisted.sessions[0].resetEpoch).toBe(0);
    expect(service.resetGame({ gameId: "legacy-game" }).resetEpoch).toBe(1);
  });

  it("migrates empty legacy Court Duel saves and preserves played seedless saves as explicitly unavailable", () => {
    const persistencePath = temporaryStorePath();
    const legacyContent = JSON.stringify({
      formatVersion: 1,
      sessions: [
        {
          gameId: "legacy-empty-court-duel",
          kind: "basketball",
          playerColor: "black",
          difficulty: "hard",
          resetEpoch: 0,
          events: [],
          lastAccessedAt: 100,
        },
        {
          gameId: "legacy-played-court-duel",
          kind: "basketball",
          playerColor: "black",
          difficulty: "medium",
          resetEpoch: 0,
          events: [
            { type: "move", actor: "player", move: "drive" },
            { type: "move", actor: "gpt", move: "three" },
            { type: "end" },
          ],
          lastAccessedAt: 100,
        },
        {
          gameId: "legacy-ended-empty-court-duel",
          kind: "basketball",
          playerColor: "black",
          difficulty: "medium",
          resetEpoch: 0,
          events: [{ type: "end" }],
          lastAccessedAt: 100,
        },
        {
          gameId: "legacy-seeded-court-duel",
          kind: "basketball",
          playerColor: "black",
          difficulty: "easy",
          resetEpoch: 0,
          basketballOutcomeSeed: "0".repeat(64),
          events: [
            { type: "move", actor: "player", move: "three" },
            { type: "move", actor: "gpt", move: "three" },
          ],
          lastAccessedAt: 100,
        },
      ],
    });
    writeFileSync(persistencePath, legacyContent, "utf8");

    const migratedService = new ToolService(new GameStore({ persistencePath, now: () => 100 }));
    const persisted = JSON.parse(readFileSync(persistencePath, "utf8")) as {
      formatVersion: number;
      sessions: Array<{ gameId: string; events: unknown[]; unavailableReason?: string; basketballOutcomeSeed?: string }>;
    };
    expect(persisted.formatVersion).toBe(2);
    expect(readFileSync(`${persistencePath}.v1.bak`, "utf8")).toBe(legacyContent);
    expect(statSync(`${persistencePath}.v1.bak`).mode & 0o777).toBe(0o600);

    const migrated = migratedService.getGameState({ gameId: "legacy-empty-court-duel" });
    const endedEmpty = migratedService.getGameState({ gameId: "legacy-ended-empty-court-duel" });
    const seeded = migratedService.getGameState({ gameId: "legacy-seeded-court-duel" });
    const seed = persistedBasketballSeed(persistencePath, migrated.gameId);
    expectRuleError(() => migratedService.getGameState({ gameId: "legacy-played-court-duel" }), "save_incompatible");
    const preserved = persisted.sessions.find(session => session.gameId === "legacy-played-court-duel");

    expect(preserved).toMatchObject({
      gameId: "legacy-played-court-duel",
      unavailableReason: "missing-basketball-outcome-seed",
    });
    expect(preserved?.events).toEqual([
      { type: "move", actor: "player", move: "drive" },
      { type: "move", actor: "gpt", move: "three" },
      { type: "end" },
    ]);
    expect(preserved?.basketballOutcomeSeed).toBeUndefined();
    expect(seed).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(migrated)).not.toContain(seed);
    expect(endedEmpty).toMatchObject({ status: "finished", finishReason: "ended", stateVersion: 1, moveHistory: [] });
    expect(persistedBasketballSeed(persistencePath, seeded.gameId)).toBe("0".repeat(64));

    const restarted = new ToolService(new GameStore({ persistencePath, now: () => 100 }));
    expect(restarted.getGameState({ gameId: migrated.gameId })).toEqual(migrated);
    expect(restarted.getGameState({ gameId: endedEmpty.gameId })).toEqual(endedEmpty);
    expect(restarted.getGameState({ gameId: seeded.gameId })).toEqual(seeded);
    expectRuleError(() => restarted.getGameState({ gameId: "legacy-played-court-duel" }), "save_incompatible");
    expect(persistedBasketballSeed(persistencePath, migrated.gameId)).toBe(seed);
  });

  it.each([
    ["stale contents", "stale-backup", 0o600],
    ["permissive mode", undefined, 0o644],
  ])("fails closed when the v1 migration backup has %s", (_label, backupOverride, backupMode) => {
    const persistencePath = temporaryStorePath();
    const legacyContent = JSON.stringify({
      formatVersion: 1,
      sessions: [{
        gameId: "legacy-backup-check",
        kind: "chess",
        playerColor: "white",
        difficulty: "medium",
        events: [],
        lastAccessedAt: 100,
      }],
    });
    writeFileSync(persistencePath, legacyContent, "utf8");
    const backupContent = backupOverride ?? legacyContent;
    writeFileSync(`${persistencePath}.v1.bak`, backupContent, { encoding: "utf8", mode: backupMode });

    expect(() => new GameStore({ persistencePath, now: () => 100 })).toThrow(/could not be validated/);
    expect(readFileSync(persistencePath, "utf8")).toBe(legacyContent);
    expect(readFileSync(`${persistencePath}.v1.bak`, "utf8")).toBe(backupContent);
  });

  it.each([
    ["invalid JSON", "{not-json"],
    ["unknown version", JSON.stringify({ formatVersion: 3, sessions: [] })],
    ["an impossible move log", JSON.stringify({
      formatVersion: 1,
      sessions: [{
        gameId: "broken-game",
        kind: "chess",
        playerColor: "white",
        difficulty: "medium",
        events: [{ type: "move", actor: "player", move: "a1a8" }],
        lastAccessedAt: Date.now(),
      }],
    })],
    ["a non-terminal end event", JSON.stringify({
      formatVersion: 1,
      sessions: [{
        gameId: "broken-ended-game",
        kind: "chess",
        playerColor: "white",
        difficulty: "medium",
        events: [{ type: "end" }, { type: "move", actor: "player", move: "e2e4" }],
        lastAccessedAt: Date.now(),
      }],
    })],
    ["multiple end events", JSON.stringify({
      formatVersion: 1,
      sessions: [{
        gameId: "twice-ended-game",
        kind: "chess",
        playerColor: "white",
        difficulty: "medium",
        events: [{ type: "end" }, { type: "end" }],
        lastAccessedAt: Date.now(),
      }],
    })],
    ["a version 2 Court Duel session without its private seed", JSON.stringify({
      formatVersion: 2,
      sessions: [{
        gameId: "seedless-court-duel",
        kind: "basketball",
        playerColor: "black",
        difficulty: "medium",
        resetEpoch: 0,
        events: [],
        lastAccessedAt: Date.now(),
      }],
    })],
    ["a malformed Court Duel private seed", JSON.stringify({
      formatVersion: 2,
      sessions: [{
        gameId: "malformed-seed-court-duel",
        kind: "basketball",
        playerColor: "black",
        difficulty: "medium",
        resetEpoch: 0,
        basketballOutcomeSeed: "public-and-too-short",
        events: [],
        lastAccessedAt: Date.now(),
      }],
    })],
  ])("fails closed instead of discarding %s", (_label, content) => {
    const persistencePath = temporaryStorePath();
    writeFileSync(persistencePath, content, "utf8");

    expect(() => new GameStore({ persistencePath })).toThrow(/could not be validated/);
    expect(readFileSync(persistencePath, "utf8")).toBe(content);
  });

  it("exposes game kind and stone color as narrow TypeScript inputs", () => {
    expectTypeOf<GameKind>().toEqualTypeOf<"chess" | "go" | "tic-tac-toe" | "connect-four" | "reversi" | "pool" | "basketball">();
    expectTypeOf<GameDifficulty>().toEqualTypeOf<"easy" | "medium" | "hard">();
    expectTypeOf<StoneColor>().toEqualTypeOf<"white" | "black">();
    expectTypeOf<GoBoardSize>().toEqualTypeOf<9 | 13 | 19>();
  });
});
