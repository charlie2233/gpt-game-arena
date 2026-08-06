import { randomUUID } from "node:crypto";

import type { GameActor, GameDifficulty, GameKind, GameSnapshot, GoBoardSize, GoPositionSetup, StoneColor } from "./domain/types.js";
import { GameRuleError } from "./domain/errors.js";
import { cloneGameSession, confirmImportedGoPosition, createGameSession, endGameSession } from "./game-session.js";
import { GameStore } from "./game-store.js";
import { parseGameSnapshot } from "./snapshot-schema.js";

export class ToolService {
  constructor(private readonly store = new GameStore()) {}

  createGame(input: { game: GameKind; playerColor: StoneColor; boardSize?: GoBoardSize; difficulty?: GameDifficulty }): GameSnapshot {
    const session = createGameSession({
      gameId: randomUUID(),
      kind: input.game,
      playerColor: input.playerColor,
      difficulty: input.difficulty ?? "medium",
      resetEpoch: 0,
      ...(input.game === "go" ? { boardSize: input.boardSize ?? 9 } : {}),
    });
    this.store.put(session);
    return session.snapshot();
  }

  importGoPosition(input: {
    boardSize: GoBoardSize;
    playerColor: StoneColor;
    turn: StoneColor;
    blackStones: string[];
    whiteStones: string[];
    captures: { black: number; white: number };
    difficulty?: GameDifficulty;
  }): GameSnapshot {
    const initialPosition: GoPositionSetup = {
      source: "imported",
      blackStones: [...input.blackStones],
      whiteStones: [...input.whiteStones],
      turn: input.turn,
      captures: { ...input.captures },
    };
    const session = createGameSession({
      gameId: randomUUID(),
      kind: "go",
      playerColor: input.playerColor,
      difficulty: input.difficulty ?? "medium",
      resetEpoch: 0,
      boardSize: input.boardSize,
      initialPosition,
    });
    const snapshot = parseGameSnapshot(session.snapshot());
    this.store.put(session);
    return snapshot;
  }

  getGameState(input: { gameId: string }): GameSnapshot {
    return this.store.get(input.gameId).snapshot();
  }

  playGameMove(input: {
    gameId: string;
    actor: GameActor;
    move: string;
    expectedVersion: number;
    expectedResetEpoch?: number;
  }): GameSnapshot {
    const current = this.store.get(input.gameId);
    const expectedResetEpoch = input.expectedResetEpoch ?? 0;
    if ((current.snapshot().resetEpoch ?? 0) !== expectedResetEpoch) {
      throw new GameRuleError("stale_version", "The game reset epoch has changed.");
    }
    const replacement = cloneGameSession(current);
    const snapshot = parseGameSnapshot(replacement.play(input.actor, input.move, input.expectedVersion));
    this.store.replace(replacement);
    return snapshot;
  }

  confirmImportedGoPosition(input: {
    gameId: string;
    expectedVersion: number;
    expectedResetEpoch: number;
  }): GameSnapshot {
    const current = this.store.get(input.gameId);
    if ((current.snapshot().resetEpoch ?? 0) !== input.expectedResetEpoch) {
      throw new GameRuleError("stale_version", "The game reset epoch has changed.");
    }
    const replacement = cloneGameSession(current);
    const snapshot = parseGameSnapshot(confirmImportedGoPosition(replacement, input.expectedVersion));
    this.store.replace(replacement);
    return snapshot;
  }

  endGame(input: {
    gameId: string;
    confirmed: true;
    expectedVersion: number;
    expectedResetEpoch: number;
  }): GameSnapshot {
    const current = this.store.get(input.gameId);
    if ((current.snapshot().resetEpoch ?? 0) !== input.expectedResetEpoch) {
      throw new GameRuleError("stale_version", "The game reset epoch has changed.");
    }
    const replacement = endGameSession(cloneGameSession(current), input.expectedVersion);
    const snapshot = parseGameSnapshot(replacement.snapshot());
    this.store.replace(replacement);
    return snapshot;
  }

  resetGame(input: { gameId: string }): GameSnapshot {
    const current = this.store.get(input.gameId).snapshot();
    const replacement = createGameSession({
      gameId: current.gameId,
      kind: current.kind,
      playerColor: current.playerColor,
      difficulty: current.difficulty,
      resetEpoch: (current.resetEpoch ?? 0) + 1,
      ...(current.kind === "go" ? {
        boardSize: current.boardSize,
        ...(current.initialPosition === undefined ? {} : { initialPosition: current.initialPosition }),
      } : {}),
    });
    this.store.replace(replacement);
    return replacement.snapshot();
  }
}
