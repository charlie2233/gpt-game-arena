export type GameKind = "chess" | "go";
export type StoneColor = "white" | "black";
export type GameActor = "player" | "gpt";
export type GameStatus = "active" | "finished";

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

export interface ChessCell {
  square: string;
  color: StoneColor;
  piece: "p" | "n" | "b" | "r" | "q" | "k";
}

export interface ChessGameSnapshot extends BaseGameSnapshot {
  kind: "chess";
  board: ChessCell[];
}

export interface GoCell {
  row: number;
  column: number;
  color?: StoneColor;
}

export interface GoGameSnapshot extends BaseGameSnapshot {
  kind: "go";
  board: GoCell[];
  boardSize: 9;
}

export type GameSnapshot = ChessGameSnapshot | GoGameSnapshot;
