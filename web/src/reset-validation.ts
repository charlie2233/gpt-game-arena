import { Chess, type Square } from "chess.js";

import type {
  BaseSnapshot,
  BasketballMove,
  BasketballSnapshot,
  ChessSnapshot,
  ChessSquare,
  Color,
  ConnectFourSnapshot,
  GameSnapshot,
  GoBoardSize,
  GoPositionSetup,
  GoSnapshot,
  PoolBall,
  PoolMove,
  PoolSnapshot,
  ReversiSnapshot,
  ShotOption,
  TicTacToeSnapshot,
} from "./types";

const GO_COLUMNS = "ABCDEFGHJKLMNOPQRST";
const TIC_TAC_TOE_MOVES = ["A1", "A2", "A3", "B1", "B2", "B3", "C1", "C2", "C3"] as const;
const CONNECT_FOUR_MOVES = ["A", "B", "C", "D", "E", "F", "G"] as const;
const REVERSI_MOVES = ["C4", "D3", "E6", "F5"] as const;
const POOL_MOVES = ["POT:1:TM", "POT:1:TR", "POT:2:TM", "POT:2:BM", "POT:3:BM", "POT:3:BR", "SAFE:L", "SAFE:C", "SAFE:R", "SAFE:T", "SAFE:B"] as const satisfies readonly PoolMove[];
const BASKETBALL_MOVES = ["drive", "pull-up", "three"] as const satisfies readonly BasketballMove[];

const INITIAL_POOL_BALLS = [
  { id: 1, group: "solids", x: 32, y: 9 },
  { id: 2, group: "solids", x: 36, y: 20 },
  { id: 3, group: "solids", x: 34, y: 34 },
  { id: 9, group: "stripes", x: 53, y: 13 },
  { id: 10, group: "stripes", x: 54, y: 29 },
  { id: 11, group: "stripes", x: 72, y: 18 },
  { id: 8, group: "eight", x: 76, y: 35 },
] as const satisfies readonly PoolBall[];

const INITIAL_SHOT_OPTIONS = [
  { move: "drive", points: 2, energyCost: 2, accuracy: 82 },
  { move: "pull-up", points: 2, energyCost: 1, accuracy: 66 },
  { move: "three", points: 3, energyCost: 0, accuracy: 48 },
] as const satisfies readonly ShotOption[];

function resetEpochOf(snapshot: GameSnapshot): number {
  return snapshot.resetEpoch ?? 0;
}

function hasResetLifecycleIdentity(previous: GameSnapshot, next: GameSnapshot): boolean {
  return next.gameId === previous.gameId
    && next.kind === previous.kind
    && next.playerColor === previous.playerColor
    && next.difficulty === previous.difficulty
    && resetEpochOf(next) === resetEpochOf(previous) + 1
    && next.stateVersion === 0
    && next.status === "active"
    && next.winner === undefined
    && next.finishReason === undefined
    && next.lastMove === undefined
    && next.moveHistory.length === 0;
}

type CanonicalResetBase<M extends string> = Pick<BaseSnapshot, "gameId" | "difficulty" | "playerColor" | "message"> & {
  resetEpoch: number;
  turn: Color;
  status: "active";
  legalMoves: M[];
  moveHistory: [];
  stateVersion: 0;
};

function resetBase<M extends string>(previous: GameSnapshot, nextMessage: string, turn: Color, legalMoves: readonly M[]): CanonicalResetBase<M> {
  return {
    gameId: previous.gameId,
    resetEpoch: resetEpochOf(previous) + 1,
    difficulty: previous.difficulty,
    playerColor: previous.playerColor,
    turn,
    status: "active",
    legalMoves: [...legalMoves],
    moveHistory: [],
    stateVersion: 0,
    message: nextMessage,
  };
}

function canonicalChessReset(previous: GameSnapshot, nextMessage: string): ChessSnapshot {
  const chess = new Chess();
  const board: ChessSnapshot["board"] = [];
  for (let rank = 8; rank >= 1; rank -= 1) for (const file of "abcdefgh") {
    const square = `${file}${rank}` as ChessSquare;
    const piece = chess.get(square as Square);
    board.push(piece === undefined ? { square } : { square, color: piece.color === "w" ? "white" : "black", piece: piece.type });
  }
  const legalMoves = chess.moves({ verbose: true }).map(move => `${move.from}${move.to}${move.promotion ?? ""}`).sort();
  return { ...resetBase(previous, nextMessage, "white", legalMoves), kind: "chess", board };
}

function emptyBoard(rows: number, columns = rows): (Color | null)[][] {
  return Array.from({ length: rows }, () => Array<Color | null>(columns).fill(null));
}

function canonicalGoMoves(boardSize: GoBoardSize): string[] {
  const moves: string[] = [];
  for (let rank = 1; rank <= boardSize; rank += 1) for (let column = 0; column < boardSize; column += 1) moves.push(`${GO_COLUMNS[column]}${rank}`);
  return [...moves.sort(), "pass"];
}

function cloneGoSetup(setup: GoPositionSetup): GoPositionSetup {
  return { source: "imported", blackStones: [...setup.blackStones], whiteStones: [...setup.whiteStones], turn: setup.turn, captures: { black: setup.captures.black, white: setup.captures.white } };
}

function importedGoBoard(boardSize: GoBoardSize, setup: GoPositionSetup): GoSnapshot["board"] | undefined {
  const board = emptyBoard(boardSize);
  const occupied = new Set<string>();
  for (const [color, stones] of [["black", setup.blackStones], ["white", setup.whiteStones]] as const) for (const notation of stones) {
    const match = /^([A-HJ-T])([1-9]|1[0-9])$/.exec(notation);
    const column = match === null ? -1 : GO_COLUMNS.indexOf(match[1]);
    const rank = match === null ? -1 : Number(match[2]);
    if (column < 0 || column >= boardSize || rank < 1 || rank > boardSize) return undefined;
    const key = `${boardSize - rank},${column}`;
    if (occupied.has(key)) return undefined;
    occupied.add(key);
    board[boardSize - rank]![column] = color;
  }
  return board;
}

function canonicalGoReset(previous: GoSnapshot, nextMessage: string): GoSnapshot | undefined {
  if (previous.initialPosition === undefined) {
    return {
      ...resetBase(previous, nextMessage, "black", canonicalGoMoves(previous.boardSize)),
      kind: "go",
      board: emptyBoard(previous.boardSize),
      boardSize: previous.boardSize,
      captures: { black: 0, white: 0 },
      consecutivePasses: 0,
    };
  }
  const initialPosition = cloneGoSetup(previous.initialPosition);
  const board = importedGoBoard(previous.boardSize, initialPosition);
  if (board === undefined) return undefined;
  return {
    ...resetBase(previous, nextMessage, initialPosition.turn, []),
    kind: "go",
    board,
    boardSize: previous.boardSize,
    initialPosition,
    importReview: "pending",
    captures: { black: initialPosition.captures.black, white: initialPosition.captures.white },
    consecutivePasses: 0,
  };
}

function canonicalTicTacToeReset(previous: GameSnapshot, nextMessage: string): TicTacToeSnapshot {
  return { ...resetBase(previous, nextMessage, "black", TIC_TAC_TOE_MOVES), kind: "tic-tac-toe", board: emptyBoard(3) as TicTacToeSnapshot["board"] };
}

function canonicalConnectFourReset(previous: GameSnapshot, nextMessage: string): ConnectFourSnapshot {
  return { ...resetBase(previous, nextMessage, "black", CONNECT_FOUR_MOVES), kind: "connect-four", board: emptyBoard(6, 7) as ConnectFourSnapshot["board"] };
}

function canonicalReversiReset(previous: GameSnapshot, nextMessage: string): ReversiSnapshot {
  const board = emptyBoard(8) as ReversiSnapshot["board"];
  board[3][3] = "black"; board[3][4] = "white"; board[4][3] = "white"; board[4][4] = "black";
  return { ...resetBase(previous, nextMessage, "black", REVERSI_MOVES), kind: "reversi", board, score: { black: 2, white: 2 } };
}

function canonicalPoolReset(previous: GameSnapshot, nextMessage: string): PoolSnapshot {
  return {
    ...resetBase(previous, nextMessage, "black", POOL_MOVES),
    kind: "pool",
    cueBall: { x: 12, y: 25 },
    balls: INITIAL_POOL_BALLS.map(ball => ({ ...ball })),
  };
}

function canonicalBasketballReset(previous: GameSnapshot, nextMessage: string): BasketballSnapshot {
  return {
    ...resetBase(previous, nextMessage, "black", BASKETBALL_MOVES),
    kind: "basketball",
    score: { black: 0, white: 0 },
    energy: { black: 4, white: 4 },
    streak: { black: 0, white: 0 },
    attempts: { black: 0, white: 0 },
    phase: "regulation",
    round: 1,
    shotOptions: INITIAL_SHOT_OPTIONS.map(option => ({ ...option })),
    shotResults: [],
  };
}

function canonicalReset(previous: GameSnapshot, nextMessage: string): GameSnapshot | undefined {
  switch (previous.kind) {
    case "chess": return canonicalChessReset(previous, nextMessage);
    case "go": return canonicalGoReset(previous, nextMessage);
    case "tic-tac-toe": return canonicalTicTacToeReset(previous, nextMessage);
    case "connect-four": return canonicalConnectFourReset(previous, nextMessage);
    case "reversi": return canonicalReversiReset(previous, nextMessage);
    case "pool": return canonicalPoolReset(previous, nextMessage);
    case "basketball": return canonicalBasketballReset(previous, nextMessage);
  }
}

function exactValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => exactValue(value, right[index]));
  }
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") return false;
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  return leftKeys.length === rightKeys.length
    && leftKeys.every(key => Object.prototype.hasOwnProperty.call(rightRecord, key) && exactValue(leftRecord[key], rightRecord[key]));
}

export function isConfirmedReset(previous: GameSnapshot, next: GameSnapshot): boolean {
  if (!hasResetLifecycleIdentity(previous, next)) return false;
  const expected = canonicalReset(previous, next.message);
  return expected !== undefined && exactValue(next, expected);
}
