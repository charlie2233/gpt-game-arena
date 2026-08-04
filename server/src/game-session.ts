import { ChessGame } from "./domain/chess-game.js";
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
  StoneColor,
} from "./domain/types.js";

export interface GameSession {
  snapshot(): GameSnapshot;
  play(actor: GameActor, move: string, expectedVersion: number): GameSnapshot;
}

export interface GameSessionDescriptor {
  gameId: string;
  kind: GameKind;
  playerColor: StoneColor;
  difficulty: GameDifficulty;
  resetEpoch?: number;
  boardSize?: GoBoardSize;
}

export interface GameSessionMove {
  actor: GameActor;
  move: string;
}

export function createGameSession(descriptor: GameSessionDescriptor): GameSession {
  const {
    gameId,
    kind,
    playerColor,
    difficulty,
    resetEpoch = 0,
    boardSize = 9,
  } = descriptor;

  switch (kind) {
    case "chess":
      return ChessGame.create(gameId, playerColor, difficulty, resetEpoch);
    case "go":
      return GoGame.create(gameId, playerColor, boardSize, difficulty, resetEpoch);
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
    ...(snapshot.kind === "go" ? { boardSize: snapshot.boardSize } : {}),
  };
}

export function replayGameSession(
  descriptor: GameSessionDescriptor,
  moves: readonly GameSessionMove[],
): GameSession {
  const session = createGameSession(descriptor);
  moves.forEach(({ actor, move }, expectedVersion) => {
    session.play(actor, move, expectedVersion);
  });
  return session;
}

export function cloneGameSession(session: GameSession): GameSession {
  const snapshot = session.snapshot();
  return replayGameSession(
    descriptorFromSnapshot(snapshot),
    snapshot.moveHistory.map(({ actor, notation }) => ({ actor, move: notation })),
  );
}

function unhandledGameKind(kind: never): never {
  throw new Error(`Unsupported game kind: ${kind}`);
}
