export type GameKind = "chess" | "go";
export type StoneColor = "white" | "black";
export type GameActor = "player" | "gpt";
export type GameStatus = "active" | "finished";
export type GoBoardSize = 9 | 13 | 19;
export type ChessFile = "a" | "b" | "c" | "d" | "e" | "f" | "g" | "h";
export type ChessRank = "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8";
export type ChessSquare = `${ChessFile}${ChessRank}`;
export type ChessPiece = "p" | "n" | "b" | "r" | "q" | "k";

export interface MoveRecord {
  actor: GameActor;
  color: StoneColor;
  notation: string;
  ply: number;
}

export interface BaseGameSnapshot {
  gameId: string;
  kind: GameKind;
  playerColor: StoneColor;
  turn: StoneColor;
  status: GameStatus;
  winner?: StoneColor | "draw";
  legalMoves: string[];
  moveHistory: MoveRecord[];
  lastMove?: MoveRecord;
  stateVersion: number;
  message: string;
}

export type ChessCell =
  | { square: ChessSquare; color: StoneColor; piece: ChessPiece }
  | { square: ChessSquare; color?: never; piece?: never };

export interface ChessGameSnapshot extends BaseGameSnapshot {
  kind: "chess";
  board: ChessCell[];
}

export interface GoGameSnapshot extends BaseGameSnapshot {
  kind: "go";
  /** Rows descend from boardSize to 1; columns start at A and skip I. */
  board: (StoneColor | null)[][];
  boardSize: GoBoardSize;
  captures: { black: number; white: number };
  consecutivePasses: number;
  score?: { black: number; white: number; komi: 6.5 };
}

export type GameSnapshot = ChessGameSnapshot | GoGameSnapshot;
