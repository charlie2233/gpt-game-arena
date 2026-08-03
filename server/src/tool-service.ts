import { randomUUID } from "node:crypto";

import { ChessGame } from "./domain/chess-game.js";
import { GoGame } from "./domain/go-game.js";
import type { GameActor, GameKind, GameSnapshot, StoneColor } from "./domain/types.js";
import { GameStore, type GameSession } from "./game-store.js";

export class ToolService {
  constructor(private readonly store = new GameStore()) {}

  createGame(input: { game: GameKind; playerColor: StoneColor }): GameSnapshot {
    const session = this.createSession(input.game, randomUUID(), input.playerColor);
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
    const replacement = this.createSession(current.kind, current.gameId, current.playerColor);
    this.store.replace(replacement);
    return replacement.snapshot();
  }

  private createSession(kind: GameKind, gameId: string, playerColor: StoneColor): GameSession {
    return kind === "chess"
      ? ChessGame.create(gameId, playerColor)
      : GoGame.create(gameId, playerColor);
  }
}
