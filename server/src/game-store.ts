import { GameRuleError } from "./domain/errors.js";
import type { GameActor, GameSnapshot } from "./domain/types.js";

export interface GameSession {
  snapshot(): GameSnapshot;
  play(actor: GameActor, move: string, expectedVersion: number): GameSnapshot;
}

export class GameStore {
  private readonly sessions = new Map<string, GameSession>();

  put(gameId: string, session: GameSession): void {
    this.sessions.set(gameId, session);
  }

  get(gameId: string): GameSession {
    const session = this.sessions.get(gameId);
    if (!session) {
      throw new GameRuleError("not_found", `Game ${gameId} was not found.`);
    }
    return session;
  }

  replace(gameId: string, session: GameSession): void {
    if (!this.sessions.has(gameId)) {
      throw new GameRuleError("not_found", `Game ${gameId} was not found.`);
    }
    this.sessions.set(gameId, session);
  }
}
