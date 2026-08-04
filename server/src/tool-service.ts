import { randomUUID } from "node:crypto";

import type { GameActor, GameDifficulty, GameKind, GameSnapshot, GoBoardSize, StoneColor } from "./domain/types.js";
import { cloneGameSession, createGameSession } from "./game-session.js";
import { GameStore } from "./game-store.js";

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

  getGameState(input: { gameId: string }): GameSnapshot {
    return this.store.get(input.gameId).snapshot();
  }

  playGameMove(input: {
    gameId: string;
    actor: GameActor;
    move: string;
    expectedVersion: number;
  }): GameSnapshot {
    const replacement = cloneGameSession(this.store.get(input.gameId));
    const snapshot = replacement.play(input.actor, input.move, input.expectedVersion);
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
      ...(current.kind === "go" ? { boardSize: current.boardSize } : {}),
    });
    this.store.replace(replacement);
    return replacement.snapshot();
  }
}
