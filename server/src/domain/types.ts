export type GameKind = "chess" | "go" | "tic-tac-toe" | "connect-four" | "reversi";
export type StoneColor = "white" | "black";
export type GameActor = "player" | "gpt";
export type GameStatus = "active" | "finished";
export type GameDifficulty = "easy" | "medium" | "hard";
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
  difficulty: GameDifficulty;
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

export type TicTacToeCoordinate = "A1" | "A2" | "A3" | "B1" | "B2" | "B3" | "C1" | "C2" | "C3";

export interface TicTacToeGameSnapshot extends BaseGameSnapshot {
  kind: "tic-tac-toe";
  /** Rows descend from rank 3 to 1; columns run A through C. */
  board: (StoneColor | null)[][];
  legalMoves: TicTacToeCoordinate[];
  winningLine?: [TicTacToeCoordinate, TicTacToeCoordinate, TicTacToeCoordinate];
}

export type ConnectFourColumn = "A" | "B" | "C" | "D" | "E" | "F" | "G";
export type ConnectFourCoordinate = `${ConnectFourColumn}${1 | 2 | 3 | 4 | 5 | 6}`;

export interface ConnectFourGameSnapshot extends BaseGameSnapshot {
  kind: "connect-four";
  /** Row 0 is rank 6 (top); row 5 is rank 1 (bottom). */
  board: (StoneColor | null)[][];
  legalMoves: ConnectFourColumn[];
  winningLine?: [ConnectFourCoordinate, ConnectFourCoordinate, ConnectFourCoordinate, ConnectFourCoordinate];
}

export type ReversiCoordinate = `${"A" | "B" | "C" | "D" | "E" | "F" | "G" | "H"}${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}`;

export interface ReversiMoveRecord extends MoveRecord {
  notation: ReversiCoordinate;
}

export interface ReversiGameSnapshot extends BaseGameSnapshot {
  kind: "reversi";
  /** Row 0 is rank 8 (top); row 7 is rank 1 (bottom). */
  board: (StoneColor | null)[][];
  legalMoves: ReversiCoordinate[];
  moveHistory: ReversiMoveRecord[];
  lastMove?: ReversiMoveRecord;
  score: { black: number; white: number };
}

export type GameSnapshot = ChessGameSnapshot | GoGameSnapshot | TicTacToeGameSnapshot | ConnectFourGameSnapshot | ReversiGameSnapshot;
