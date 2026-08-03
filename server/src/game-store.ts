import { GameRuleError } from "./domain/errors.js";
import type { GameActor, GameSnapshot } from "./domain/types.js";

export interface GameSession {
  snapshot(): GameSnapshot;
  play(actor: GameActor, move: string, expectedVersion: number): GameSnapshot;
}

export interface GameStoreOptions {
  maxSessions?: number;
  ttlMs?: number;
  now?: () => number;
}

interface StoredSession {
  session: GameSession;
  lastAccessedAt: number;
}

export class GameStore {
  private readonly sessions = new Map<string, StoredSession>();
  private readonly maxSessions: number;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: GameStoreOptions = {}) {
    this.maxSessions = options.maxSessions ?? 1_000;
    this.ttlMs = options.ttlMs ?? 60 * 60 * 1_000;
    this.now = options.now ?? Date.now;
  }

  put(session: GameSession): void {
    this.pruneExpired();
    this.store(session.snapshot().gameId, session);
    this.evictOverflow();
  }

  get(gameId: string): GameSession {
    this.pruneExpired();
    const stored = this.sessions.get(gameId);
    if (!stored) {
      throw new GameRuleError("not_found", `Game ${gameId} was not found.`);
    }
    this.store(gameId, stored.session);
    return stored.session;
  }

  replace(session: GameSession): void {
    this.pruneExpired();
    const gameId = session.snapshot().gameId;
    if (!this.sessions.has(gameId)) {
      throw new GameRuleError("not_found", `Game ${gameId} was not found.`);
    }
    this.store(gameId, session);
    this.evictOverflow();
  }

  private store(gameId: string, session: GameSession): void {
    this.sessions.delete(gameId);
    this.sessions.set(gameId, { session, lastAccessedAt: this.now() });
  }

  private pruneExpired(): void {
    const now = this.now();
    for (const [gameId, stored] of this.sessions) {
      if (now - stored.lastAccessedAt >= this.ttlMs) {
        this.sessions.delete(gameId);
      }
    }
  }

  private evictOverflow(): void {
    while (this.sessions.size > this.maxSessions) {
      const leastRecentlyUsed = this.sessions.keys().next().value as string | undefined;
      if (leastRecentlyUsed === undefined) return;
      this.sessions.delete(leastRecentlyUsed);
    }
  }
}
