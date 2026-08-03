import { randomUUID } from "node:crypto";

import { ChessGame } from "./domain/chess-game.js";
import { GoGame } from "./domain/go-game.js";
import type { GameActor, GameDifficulty, GameKind, GameSnapshot, GoBoardSize, StoneColor } from "./domain/types.js";
import { GameStore, type GameSession } from "./game-store.js";

export class ToolService {
  constructor(private readonly store = new GameStore()) {}

  createGame(input: { game: GameKind; playerColor: StoneColor; boardSize?: GoBoardSize; difficulty?: GameDifficulty }): GameSnapshot {
    const session = this.createSession(input.game, randomUUID(), input.playerColor, input.boardSize, input.difficulty);
    this.store.put(session);
    return session.snapshot();
  }

  getGameState(input: { gameId: string }): GameSnapshot {
    return this.store.get(input.gameId).snapshot();
  }

  playGameMove(input: {
    gameId: string;
    actor: GameActor;
    move: string;
    expectedVersion: number;
  }): GameSnapshot {
    return this.store.get(input.gameId).play(input.actor, input.move, input.expectedVersion);
  }

  resetGame(input: { gameId: string }): GameSnapshot {
    const current = this.store.get(input.gameId).snapshot();
    const replacement = this.createSession(
      current.kind,
      current.gameId,
      current.playerColor,
      current.kind === "go" ? current.boardSize : undefined,
      current.difficulty,
    );
    this.store.replace(replacement);
    return replacement.snapshot();
  }

  private createSession(
    kind: GameKind,
    gameId: string,
    playerColor: StoneColor,
    boardSize: GoBoardSize = 9,
    difficulty: GameDifficulty = "medium",
  ): GameSession {
    switch (kind) {
      case "chess":
        return ChessGame.create(gameId, playerColor, difficulty);
      case "go":
        return GoGame.create(gameId, playerColor, boardSize, difficulty);
      default:
        return this.unhandledGameKind(kind);
    }
  }

  private unhandledGameKind(kind: never): never {
    throw new Error(`Unsupported game kind: ${kind}`);
  }
}
