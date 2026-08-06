import { ChessGame } from "./domain/chess-game.js";
import { GameRuleError } from "./domain/errors.js";
import { ConnectFourGame } from "./domain/connect-four-game.js";
import { GoGame } from "./domain/go-game.js";
import { ReversiGame } from "./domain/reversi-game.js";
import { TicTacToeGame } from "./domain/tic-tac-toe-game.js";
import type {
  GameActor,
  GameDifficulty,
  GameKind,
  GameSnapshot,
  GoBoardSize,
  GoPositionSetup,
  StoneColor,
} from "./domain/types.js";

export interface GameSession {
  snapshot(): GameSnapshot;
  play(actor: GameActor, move: string, expectedVersion: number): GameSnapshot;
  confirmImportedPosition?(expectedVersion: number): GameSnapshot;
}

export interface GameSessionDescriptor {
  gameId: string;
  kind: GameKind;
  playerColor: StoneColor;
  difficulty: GameDifficulty;
  resetEpoch?: number;
  boardSize?: GoBoardSize;
  initialPosition?: GoPositionSetup;
  importReview?: "pending" | "confirmed";
}

export interface GameSessionMove {
  type: "move";
  actor: GameActor;
  move: string;
}

export interface GameSessionEnd {
  type: "end";
}

export type GameSessionEvent = GameSessionMove | GameSessionEnd;

export function createGameSession(descriptor: GameSessionDescriptor): GameSession {
  const {
    gameId,
    kind,
    playerColor,
    difficulty,
    resetEpoch = 0,
    boardSize = 9,
    initialPosition,
    importReview,
  } = descriptor;

  switch (kind) {
    case "chess":
      return ChessGame.create(gameId, playerColor, difficulty, resetEpoch);
    case "go":
      return GoGame.create(gameId, playerColor, boardSize, difficulty, resetEpoch, initialPosition, importReview);
    case "tic-tac-toe":
      return TicTacToeGame.create(gameId, playerColor, difficulty, resetEpoch);
    case "connect-four":
      return ConnectFourGame.create(gameId, playerColor, difficulty, resetEpoch);
    case "reversi":
      return ReversiGame.create(gameId, playerColor, difficulty, resetEpoch);
    default:
      return unhandledGameKind(kind);
  }
}

export function descriptorFromSnapshot(snapshot: GameSnapshot): GameSessionDescriptor {
  return {
    gameId: snapshot.gameId,
    kind: snapshot.kind,
    playerColor: snapshot.playerColor,
    difficulty: snapshot.difficulty,
    resetEpoch: snapshot.resetEpoch ?? 0,
    ...(snapshot.kind === "go" ? {
      boardSize: snapshot.boardSize,
      ...(snapshot.initialPosition === undefined ? {} : { initialPosition: cloneGoPosition(snapshot.initialPosition) }),
      ...(snapshot.importReview === undefined ? {} : { importReview: snapshot.importReview }),
    } : {}),
  };
}

function cloneGoPosition(value: GoPositionSetup): GoPositionSetup {
  return {
    source: "imported",
    blackStones: [...value.blackStones],
    whiteStones: [...value.whiteStones],
    turn: value.turn,
    captures: { ...value.captures },
  };
}

export function replayGameSession(
  descriptor: GameSessionDescriptor,
  events: readonly GameSessionEvent[],
): GameSession {
  let session = createGameSession(descriptor);
  for (const event of events) {
    const expectedVersion = session.snapshot().stateVersion;
    session = event.type === "move"
      ? playEvent(session, event, expectedVersion)
      : endGameSession(session, expectedVersion);
  }
  return session;
}

export function cloneGameSession(session: GameSession): GameSession {
  const snapshot = session.snapshot();
  return replayGameSession(
    descriptorFromSnapshot(snapshot),
    eventsFromSnapshot(snapshot),
  );
}

export function endGameSession(
  session: GameSession,
  expectedVersion: number,
): GameSession {
  const snapshot = session.snapshot();
  if (snapshot.status === "finished") {
    throw new GameRuleError("game_finished", "This game has already finished.");
  }
  if (expectedVersion !== snapshot.stateVersion) {
    throw new GameRuleError("stale_version", "The supplied game version is stale.");
  }
  return new EndedGameSession(endedSnapshot(snapshot));
}

export function confirmImportedGoPosition(
  session: GameSession,
  expectedVersion: number,
): GameSnapshot {
  const snapshot = session.snapshot();
  if (expectedVersion !== snapshot.stateVersion) {
    throw new GameRuleError("stale_version", "The supplied game version is stale.");
  }
  if (snapshot.status === "finished") {
    throw new GameRuleError("game_finished", "This game has already finished.");
  }
  if (snapshot.kind !== "go" || snapshot.importReview !== "pending" || session.confirmImportedPosition === undefined) {
    throw new GameRuleError("import_review_unavailable", "This game does not have an imported Go position awaiting review.");
  }
  return session.confirmImportedPosition(expectedVersion);
}

function eventsFromSnapshot(snapshot: GameSnapshot): GameSessionEvent[] {
  const events: GameSessionEvent[] = snapshot.moveHistory.map(({ actor, notation }) => ({
    type: "move",
    actor,
    move: notation,
  }));
  if (snapshot.finishReason === "ended") {
    events.push({ type: "end" });
  }
  return events;
}

function playEvent(session: GameSession, event: GameSessionMove, expectedVersion: number): GameSession {
  session.play(event.actor, event.move, expectedVersion);
  return session;
}

class EndedGameSession implements GameSession {
  constructor(private readonly value: GameSnapshot) {}

  snapshot(): GameSnapshot {
    return structuredClone(this.value);
  }

  play(): never {
    throw new GameRuleError("game_finished", "This game has already finished.");
  }
}

function endedSnapshot(snapshot: GameSnapshot): GameSnapshot {
  return {
    ...snapshot,
    status: "finished" as const,
    finishReason: "ended" as const,
    legalMoves: [],
    stateVersion: snapshot.stateVersion + 1,
    message: "Game ended.",
  };
}

function unhandledGameKind(kind: never): never {
  throw new Error(`Unsupported game kind: ${kind}`);
}
