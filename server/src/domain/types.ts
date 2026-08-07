export type GameKind = "chess" | "go" | "tic-tac-toe" | "connect-four" | "reversi" | "pool" | "basketball";
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
  /** Present only when the player explicitly ended the game. */
  finishReason?: "ended";
  legalMoves: string[];
  moveHistory: MoveRecord[];
  lastMove?: MoveRecord;
  stateVersion: number;
  /** Increments whenever this game ID is reset to a fresh position. */
  resetEpoch?: number;
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
  /** Present when this game started from a user-supplied board position. */
  initialPosition?: GoPositionSetup;
  /** Present iff initialPosition is present. Moves are blocked while pending. */
  importReview?: "pending" | "confirmed";
  captures: { black: number; white: number };
  consecutivePasses: number;
  score?: { black: number; white: number; komi: 6.5 };
}

export interface GoPositionSetup {
  source: "imported";
  blackStones: string[];
  whiteStones: string[];
  turn: StoneColor;
  captures: { black: number; white: number };
}

export type TicTacToeCoordinate = "A1" | "A2" | "A3" | "B1" | "B2" | "B3" | "C1" | "C2" | "C3";

export interface TicTacToeMoveRecord extends MoveRecord {
  notation: TicTacToeCoordinate;
}

export interface TicTacToeGameSnapshot extends BaseGameSnapshot {
  kind: "tic-tac-toe";
  /** Rows descend from rank 3 to 1; columns run A through C. */
  board: (StoneColor | null)[][];
  legalMoves: TicTacToeCoordinate[];
  moveHistory: TicTacToeMoveRecord[];
  lastMove?: TicTacToeMoveRecord;
  winningLine?: [TicTacToeCoordinate, TicTacToeCoordinate, TicTacToeCoordinate];
}

export type ConnectFourColumn = "A" | "B" | "C" | "D" | "E" | "F" | "G";
export type ConnectFourCoordinate = `${ConnectFourColumn}${1 | 2 | 3 | 4 | 5 | 6}`;

export interface ConnectFourMoveRecord extends MoveRecord {
  notation: ConnectFourColumn;
}

export interface ConnectFourGameSnapshot extends BaseGameSnapshot {
  kind: "connect-four";
  /** Row 0 is rank 6 (top); row 5 is rank 1 (bottom). */
  board: (StoneColor | null)[][];
  legalMoves: ConnectFourColumn[];
  moveHistory: ConnectFourMoveRecord[];
  lastMove?: ConnectFourMoveRecord;
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

export type PoolPocket = "TL" | "TM" | "TR" | "BL" | "BM" | "BR";
export type PoolSafetyZone = "L" | "C" | "R" | "T" | "B";
export type PoolBallId = 1 | 2 | 3 | 8 | 9 | 10 | 11;
export type PoolMove = `POT:${PoolBallId}:${PoolPocket}` | `SAFE:${PoolSafetyZone}`;
export type PoolBallGroup = "solids" | "stripes" | "eight";

export interface PoolBall {
  id: PoolBallId;
  group: PoolBallGroup;
  x: number;
  y: number;
}

export interface PoolMoveRecord extends MoveRecord {
  notation: PoolMove;
}

export interface PoolGameSnapshot extends BaseGameSnapshot {
  kind: "pool";
  /** Integer coordinates on a 100 by 50 table, measured from the top-left rail. */
  cueBall: { x: number; y: number };
  balls: PoolBall[];
  legalMoves: PoolMove[];
  moveHistory: PoolMoveRecord[];
  lastMove?: PoolMoveRecord;
}

export type BasketballMove = "drive" | "pull-up" | "three";

export interface BasketballMoveRecord extends MoveRecord {
  notation: BasketballMove;
}

export interface ShotOption {
  move: BasketballMove;
  points: 2 | 3;
  energyCost: 0 | 1 | 2;
  accuracy: number;
}

export interface ShotResult {
  ply: number;
  actor: GameActor;
  color: StoneColor;
  move: BasketballMove;
  made: boolean;
  points: 0 | 2 | 3;
  accuracy: number;
}

export interface BasketballGameSnapshot extends BaseGameSnapshot {
  kind: "basketball";
  legalMoves: BasketballMove[];
  moveHistory: BasketballMoveRecord[];
  lastMove?: BasketballMoveRecord;
  score: { black: number; white: number };
  energy: { black: number; white: number };
  streak: { black: number; white: number };
  attempts: { black: number; white: number };
  phase: "regulation" | "overtime";
  round: number;
  shotOptions: ShotOption[];
  shotResults: ShotResult[];
}

export type GameSnapshot =
  | ChessGameSnapshot
  | GoGameSnapshot
  | TicTacToeGameSnapshot
  | ConnectFourGameSnapshot
  | ReversiGameSnapshot
  | PoolGameSnapshot
  | BasketballGameSnapshot;
