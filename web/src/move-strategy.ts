import { Chess, type PieceSymbol, type Square } from "chess.js";
import type { BasketballMove, BasketballSnapshot, ChessPiece, ChessSnapshot, Color, ConnectFourSnapshot, GameSnapshot, GoSnapshot, PoolSnapshot, ReversiSnapshot, TicTacToeSnapshot } from "./types";

const GO_COLUMNS = "ABCDEFGHJKLMNOPQRST";
const PIECE_VALUE: Record<ChessPiece, number> = { p: 1, n: 3, b: 3.25, r: 5, q: 9, k: 100 };
const difficultyInstruction = {
  easy: "Choose a simple legal move quickly.",
  medium: "Briefly compare the engine-ranked candidates and choose a sound move that handles immediate tactics before development.",
  hard: "Think privately and compare the strongest engine-ranked candidates for forcing tactics, defensive replies, and positional consequences before moving.",
} as const;

type ChessBoardPiece = { color: Color; piece: ChessPiece };
type Point = { row: number; column: number };
type GoBoard = (Color | null)[][];
type GoPositionAnalysis = {
  occupied: number;
  friendlyAtariByLiberty: Map<string, number>;
  friendlyStones: Point[];
  opponentStones: Point[];
};

const GO_ENDGAME_OCCUPANCY = 0.35;
const GO_TACTICAL_CONTINUE_SCORE = 700;
const EMBEDDED_CANDIDATE_LIMIT: Record<GameSnapshot["difficulty"], number> = {
  easy: 8,
  medium: 16,
  hard: 32,
};

export type EmbeddedMoveDecision = {
  gameId: string;
  kind: GameSnapshot["kind"];
  difficulty: GameSnapshot["difficulty"];
  turn: Color;
  expectedResetEpoch: number;
  expectedVersion: number;
  positionFormat: string;
  position: string;
  lastMove?: { actor: "player" | "gpt"; color: Color; move: string; ply: number };
  legalMoveCount: number;
  candidatesTruncated: boolean;
  candidateMoves: string[];
  captures?: { black: number; white: number };
  consecutivePasses?: number;
  score?: { black: number; white: number };
  energy?: { black: number; white: number };
  attempts?: { black: number; white: number };
  phase?: "regulation" | "overtime";
  round?: number;
  shotOptions?: Array<{ move: BasketballMove; points: 2 | 3; energyCost: 0 | 1 | 2; accuracy: number }>;
};

export function chooseStandaloneMove(game: GameSnapshot): string | undefined {
  const ordered = [...new Set(game.legalMoves)].sort((left, right) => left.localeCompare(right));
  const nonPass = ordered.filter((move) => move !== "pass");
  const candidates = nonPass.length > 0 ? nonPass : ordered;
  if (candidates.length === 0) return undefined;
  if (game.kind === "go") {
    if (nonPass.length === 0) return candidates[0];
    const passMayFinish = game.consecutivePasses === 1 && ordered.includes("pass");
    if (game.difficulty === "hard" || passMayFinish) {
      const analysis = analyzeGoPosition(game);
      const endgame = analysis.occupied / (game.boardSize * game.boardSize) >= GO_ENDGAME_OCCUPANCY;
      if (game.difficulty === "hard" || endgame) {
        const scores = new Map(nonPass.map((move) => [move, scoreGoMove(game, move, analysis)]));
        if (shouldCompleteGoByPassing(game, ordered, scores, analysis)) return "pass";
        if (game.difficulty === "hard") return bestScored(nonPass, (move) => scores.get(move) ?? Number.NEGATIVE_INFINITY);
      }
    }
    if (game.difficulty === "medium") {
      const analysis = analyzeGoPosition(game);
      return bestScored(candidates, (move) => scoreGoMove(game, move, analysis));
    }
    return candidates[stableHash(positionKey(game)) % candidates.length];
  }
  if (game.kind === "tic-tac-toe") return game.difficulty === "easy" ? candidates[stableHash(positionKey(game)) % candidates.length] : rankedTicMoves(game, candidates, game.difficulty === "hard")[0];
  if (game.kind === "connect-four") return game.difficulty === "easy" ? candidates[stableHash(positionKey(game)) % candidates.length] : rankedConnectMoves(game, candidates, game.difficulty === "hard" ? 5 : 3)[0];
  if (game.kind === "reversi") return game.difficulty === "easy" ? candidates[stableHash(positionKey(game)) % candidates.length] : rankedReversiMoves(game, candidates, game.difficulty === "hard" ? 3 : 1)[0];
  if (game.kind === "pool") return game.difficulty === "easy" ? candidates[stableHash(positionKey(game)) % candidates.length] : rankedPoolMoves(game, candidates, game.difficulty === "hard" ? 5 : 2)[0];
  if (game.kind === "basketball") return game.difficulty === "easy" ? candidates[stableHash(positionKey(game)) % candidates.length] : rankedBasketballMoves(game, candidates, game.difficulty === "hard" ? 6 : 3)[0];
  if (game.difficulty === "easy") return candidates[stableHash(positionKey(game)) % candidates.length];
  return rankedChessMoves(game, candidates, game.difficulty === "hard" ? 3 : 2)[0];
}

const TIC_PREFERENCE = ["B2", "A3", "C3", "A1", "C1", "B3", "A2", "C2", "B1"];

function rankedTicMoves(game: TicTacToeSnapshot, moves: string[], perfect: boolean): string[] {
  const root = game.turn;
  const opponent = otherColor(root);
  const preferred = [...moves].sort((left, right) => TIC_PREFERENCE.indexOf(left) - TIC_PREFERENCE.indexOf(right) || left.localeCompare(right));
  const score = (move: string): number => {
    const next = placeTic(game.board, move, root);
    if (!next) return Number.NEGATIVE_INFINITY;
    if (ticBoardWinner(next) === root) return 10_000;
    if (!perfect) {
      if (moves.some((reply) => ticWins(game.board, reply, opponent)) && ticWins(game.board, move, opponent)) return 9_000;
      return 100 - TIC_PREFERENCE.indexOf(move);
    }
    return ticMinimax(next, opponent, root, 1);
  };
  const scores = new Map(preferred.map((move) => [move, score(move)]));
  return preferred.sort((left, right) => (scores.get(right) ?? Number.NEGATIVE_INFINITY) - (scores.get(left) ?? Number.NEGATIVE_INFINITY) || TIC_PREFERENCE.indexOf(left) - TIC_PREFERENCE.indexOf(right) || left.localeCompare(right));
}

function ticWins(board: (Color | null)[][], move: string, color: Color): boolean {
  const next = placeTic(board, move, color);
  return next ? ticBoardWinner(next) === color : false;
}

function otherColor(color: Color): Color {
  return color === "black" ? "white" : "black";
}

function placeTic(board: (Color | null)[][], move: string, color: Color): GoBoard | undefined {
  const column = move.charCodeAt(0) - 65;
  const row = 3 - Number(move[1]);
  if (row < 0 || row >= 3 || column < 0 || column >= 3 || board[row][column] !== null) return;
  const next = board.map((cells) => [...cells]);
  next[row][column] = color;
  return next;
}

function ticBoardWinner(board: (Color | null)[][]): Color | undefined {
  const lines = [
    ...Array.from({ length: 3 }, (_, row) => [[row, 0], [row, 1], [row, 2]]),
    ...Array.from({ length: 3 }, (_, column) => [[0, column], [1, column], [2, column]]),
    [[0, 0], [1, 1], [2, 2]],
    [[0, 2], [1, 1], [2, 0]],
  ];
  for (const line of lines) {
    const first = board[line[0][0]][line[0][1]];
    if (first && line.every(([row, column]) => board[row][column] === first)) return first;
  }
}

function ticLegalMoves(board: (Color | null)[][]): string[] {
  const moves: string[] = [];
  for (let row = 0; row < 3; row += 1) for (let column = 0; column < 3; column += 1) {
    if (board[row][column] === null) moves.push(`${String.fromCharCode(65 + column)}${3 - row}`);
  }
  return moves.sort((left, right) => TIC_PREFERENCE.indexOf(left) - TIC_PREFERENCE.indexOf(right) || left.localeCompare(right));
}

function ticMinimax(board: (Color | null)[][], turn: Color, root: Color, depth: number): number {
  const winner = ticBoardWinner(board);
  if (winner) return winner === root ? 1_000 - depth : depth - 1_000;
  const moves = ticLegalMoves(board);
  if (moves.length === 0) return 0;
  const values = moves.map((move) => ticMinimax(placeTic(board, move, turn) as GoBoard, otherColor(turn), root, depth + 1));
  return turn === root ? Math.max(...values) : Math.min(...values);
}

const CONNECT_ORDER = ["D", "C", "E", "B", "F", "A", "G"];

function rankedConnectMoves(game: ConnectFourSnapshot, moves: string[], depth: number): string[] {
  const root = game.turn;
  const cache = new Map<string, number>();
  const score = (move: string): number => {
    const next = connectDrop(game.board, move, root);
    if (!next) return Number.NEGATIVE_INFINITY;
    if (connectWinner(next) === root) return 1_000_000;
    return connectSearch(next, otherColor(root), root, depth - 1, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY, cache);
  };
  const scores = new Map(moves.map((move) => [move, score(move)]));
  return [...moves].sort((left, right) => (scores.get(right) ?? Number.NEGATIVE_INFINITY) - (scores.get(left) ?? Number.NEGATIVE_INFINITY) || CONNECT_ORDER.indexOf(left) - CONNECT_ORDER.indexOf(right) || left.localeCompare(right));
}

function connectDrop(board: (Color | null)[][], move: string, color: Color): GoBoard | undefined {
  const column = move.charCodeAt(0) - 65;
  if (column < 0 || column >= 7) return;
  const row = [...board.keys()].reverse().find((candidate) => board[candidate][column] === null);
  if (row === undefined) return;
  const next = board.map((cells) => [...cells]);
  next[row][column] = color;
  return next;
}

function connectLegalMoves(board: (Color | null)[][]): string[] {
  return CONNECT_ORDER.filter((move) => board[0][move.charCodeAt(0) - 65] === null);
}

function connectWinner(board: (Color | null)[][]): Color | undefined {
  for (let row = 0; row < 6; row += 1) for (let column = 0; column < 7; column += 1) {
    const color = board[row][column];
    if (!color) continue;
    for (const [rowStep, columnStep] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
      if (Array.from({ length: 4 }, (_, index) => board[row + rowStep * index]?.[column + columnStep * index]).every((cell) => cell === color)) return color;
    }
  }
}

function connectSearch(
  board: (Color | null)[][],
  turn: Color,
  root: Color,
  depth: number,
  alphaStart: number,
  betaStart: number,
  cache: Map<string, number>,
): number {
  const winner = connectWinner(board);
  if (winner) return winner === root ? 900_000 + depth : -900_000 - depth;
  const moves = connectLegalMoves(board);
  if (depth <= 0 || moves.length === 0) return evaluateConnect(board, root);
  const key = `${depth}|${turn}|${board.map((row) => row.map((cell) => cell?.[0] ?? ".").join("")).join("/")}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  let alpha = alphaStart;
  let beta = betaStart;
  let value = turn === root ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
  let searchedAll = true;
  for (const move of moves) {
    const next = connectDrop(board, move, turn);
    if (!next) continue;
    const child = connectSearch(next, otherColor(turn), root, depth - 1, alpha, beta, cache);
    if (turn === root) {
      value = Math.max(value, child);
      alpha = Math.max(alpha, value);
    } else {
      value = Math.min(value, child);
      beta = Math.min(beta, value);
    }
    if (beta <= alpha) {
      searchedAll = false;
      break;
    }
  }
  if (searchedAll) cache.set(key, value);
  return value;
}

function evaluateConnect(board: (Color | null)[][], root: Color): number {
  const opponent = otherColor(root);
  let score = 0;
  for (let row = 0; row < 6; row += 1) {
    if (board[row][3] === root) score += 8;
    else if (board[row][3] === opponent) score -= 8;
  }
  const windows: Array<Array<Color | null>> = [];
  for (let row = 0; row < 6; row += 1) for (let column = 0; column <= 3; column += 1) windows.push(Array.from({ length: 4 }, (_, offset) => board[row][column + offset]));
  for (let column = 0; column < 7; column += 1) for (let row = 0; row <= 2; row += 1) windows.push(Array.from({ length: 4 }, (_, offset) => board[row + offset][column]));
  for (let row = 0; row <= 2; row += 1) for (let column = 0; column <= 3; column += 1) windows.push(Array.from({ length: 4 }, (_, offset) => board[row + offset][column + offset]));
  for (let row = 0; row <= 2; row += 1) for (let column = 3; column < 7; column += 1) windows.push(Array.from({ length: 4 }, (_, offset) => board[row + offset][column - offset]));
  for (const window of windows) {
    const friendly = window.filter((cell) => cell === root).length;
    const hostile = window.filter((cell) => cell === opponent).length;
    const empty = 4 - friendly - hostile;
    if (hostile === 0) score += friendly === 3 && empty === 1 ? 120 : friendly === 2 && empty === 2 ? 18 : friendly;
    if (friendly === 0) score -= hostile === 3 && empty === 1 ? 145 : hostile === 2 && empty === 2 ? 22 : hostile;
  }
  return score;
}

const REVERSI_POSITION = [
  [120, -30, 20, 5, 5, 20, -30, 120],
  [-30, -45, -5, -5, -5, -5, -45, -30],
  [20, -5, 15, 3, 3, 15, -5, 20],
  [5, -5, 3, 3, 3, 3, -5, 5],
  [5, -5, 3, 3, 3, 3, -5, 5],
  [20, -5, 15, 3, 3, 15, -5, 20],
  [-30, -45, -5, -5, -5, -5, -45, -30],
  [120, -30, 20, 5, 5, 20, -30, 120],
];

function rankedReversiMoves(game: ReversiSnapshot, moves: string[], depth: number): string[] {
  const root = game.turn;
  const cache = new Map<string, number>();
  const emptyCount = game.board.flat().filter((cell) => cell === null).length;
  const searchDepth = depth >= 3 && emptyCount <= 8 ? emptyCount : depth;
  const score = (move: string): number => {
    const next = applyReversiMove(game.board, move, root);
    if (!next) return Number.NEGATIVE_INFINITY;
    return reversiSearch(next, otherColor(root), root, searchDepth - 1, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY, cache);
  };
  const scores = new Map(moves.map((move) => [move, score(move)]));
  return [...moves].sort((left, right) => (scores.get(right) ?? Number.NEGATIVE_INFINITY) - (scores.get(left) ?? Number.NEGATIVE_INFINITY) || left.localeCompare(right));
}

function applyReversiMove(board: (Color | null)[][], move: string, color: Color): GoBoard | undefined {
  const column = move.charCodeAt(0) - 65;
  const row = 8 - Number(move.slice(1));
  if (row < 0 || row >= 8 || column < 0 || column >= 8 || board[row][column] !== null) return;
  const opponent = otherColor(color);
  const flips: Point[] = [];
  for (const [rowStep, columnStep] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]) {
    const line: Point[] = [];
    let cursor = { row: row + rowStep, column: column + columnStep };
    while (cursor.row >= 0 && cursor.row < 8 && cursor.column >= 0 && cursor.column < 8 && board[cursor.row][cursor.column] === opponent) {
      line.push(cursor);
      cursor = { row: cursor.row + rowStep, column: cursor.column + columnStep };
    }
    if (line.length > 0 && board[cursor.row]?.[cursor.column] === color) flips.push(...line);
  }
  if (flips.length === 0) return;
  const next = board.map((cells) => [...cells]);
  next[row][column] = color;
  for (const point of flips) next[point.row][point.column] = color;
  return next;
}

function reversiLegalMoves(board: (Color | null)[][], color: Color): string[] {
  const moves: string[] = [];
  for (let row = 0; row < 8; row += 1) for (let column = 0; column < 8; column += 1) {
    const move = `${String.fromCharCode(65 + column)}${8 - row}`;
    if (applyReversiMove(board, move, color)) moves.push(move);
  }
  return moves;
}

function reversiSearch(
  board: (Color | null)[][],
  turn: Color,
  root: Color,
  depth: number,
  alphaStart: number,
  betaStart: number,
  cache: Map<string, number>,
): number {
  const moves = reversiLegalMoves(board, turn);
  const opponentMoves = moves.length === 0 ? reversiLegalMoves(board, otherColor(turn)) : [];
  if (moves.length === 0 && opponentMoves.length === 0) return reversiTerminalScore(board, root);
  if (depth <= 0) return evaluateReversi(board, root);
  if (moves.length === 0) return reversiSearch(board, otherColor(turn), root, depth, alphaStart, betaStart, cache);
  const key = `${depth}|${turn}|${board.map((row) => row.map((cell) => cell?.[0] ?? ".").join("")).join("/")}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  let alpha = alphaStart;
  let beta = betaStart;
  let value = turn === root ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
  let searchedAll = true;
  const ordered = [...moves].sort((left, right) => REVERSI_POSITION[8 - Number(right.slice(1))][right.charCodeAt(0) - 65] - REVERSI_POSITION[8 - Number(left.slice(1))][left.charCodeAt(0) - 65] || left.localeCompare(right));
  for (const move of ordered) {
    const next = applyReversiMove(board, move, turn);
    if (!next) continue;
    const child = reversiSearch(next, otherColor(turn), root, depth - 1, alpha, beta, cache);
    if (turn === root) {
      value = Math.max(value, child);
      alpha = Math.max(alpha, value);
    } else {
      value = Math.min(value, child);
      beta = Math.min(beta, value);
    }
    if (beta <= alpha) {
      searchedAll = false;
      break;
    }
  }
  if (searchedAll) cache.set(key, value);
  return value;
}

function reversiTerminalScore(board: (Color | null)[][], root: Color): number {
  const opponent = otherColor(root);
  let difference = 0;
  for (const row of board) for (const cell of row) {
    if (cell === root) difference += 1;
    else if (cell === opponent) difference -= 1;
  }
  if (difference === 0) return 0;
  return Math.sign(difference) * 1_000_000 + difference;
}

function evaluateReversi(board: (Color | null)[][], root: Color): number {
  const opponent = otherColor(root);
  let score = 0;
  let occupied = 0;
  let diskDifference = 0;
  let friendlyFrontier = 0;
  let hostileFrontier = 0;
  for (let row = 0; row < 8; row += 1) for (let column = 0; column < 8; column += 1) {
    const color = board[row][column];
    if (!color) continue;
    occupied += 1;
    const sign = color === root ? 1 : -1;
    diskDifference += sign;
    score += REVERSI_POSITION[row][column] * sign;
    const frontier = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]].some(([rowStep, columnStep]) => board[row + rowStep]?.[column + columnStep] === null);
    if (frontier) color === root ? friendlyFrontier += 1 : hostileFrontier += 1;
  }
  score += (reversiLegalMoves(board, root).length - reversiLegalMoves(board, opponent).length) * 14;
  score += (hostileFrontier - friendlyFrontier) * 5;
  score += diskDifference * (occupied > 52 ? 12 : 1);
  for (const { corner, neighbors } of [
    { corner: { row: 0, column: 0 }, neighbors: [{ row: 0, column: 1 }, { row: 1, column: 0 }, { row: 1, column: 1 }] },
    { corner: { row: 0, column: 7 }, neighbors: [{ row: 0, column: 6 }, { row: 1, column: 7 }, { row: 1, column: 6 }] },
    { corner: { row: 7, column: 0 }, neighbors: [{ row: 7, column: 1 }, { row: 6, column: 0 }, { row: 6, column: 1 }] },
    { corner: { row: 7, column: 7 }, neighbors: [{ row: 7, column: 6 }, { row: 6, column: 7 }, { row: 6, column: 6 }] },
  ]) {
    const owner = board[corner.row][corner.column];
    if (!owner) continue;
    const sign = owner === root ? 1 : -1;
    score += neighbors.filter((point) => board[point.row][point.column] === owner).length * 70 * sign;
  }
  return score;
}

type PoolPoint = { x: number; y: number };
type PoolSearchState = {
  cueBall: PoolPoint;
  balls: PoolSnapshot["balls"];
  turn: Color;
  winner?: Color;
};

const POOL_POCKETS: Record<string, PoolPoint> = {
  TL: { x: 0, y: 0 }, TM: { x: 50, y: 0 }, TR: { x: 100, y: 0 },
  BL: { x: 0, y: 50 }, BM: { x: 50, y: 50 }, BR: { x: 100, y: 50 },
};
const POOL_SAFETIES: Record<string, PoolPoint> = {
  L: { x: 18, y: 25 }, C: { x: 50, y: 25 }, R: { x: 82, y: 25 }, T: { x: 50, y: 7 }, B: { x: 50, y: 43 },
};

function rankedPoolMoves(game: PoolSnapshot, moves: string[], depth: number): string[] {
  const state: PoolSearchState = { cueBall: { ...game.cueBall }, balls: game.balls.map((ball) => ({ ...ball })), turn: game.turn };
  const root = game.turn;
  const scores = new Map<string, number>();
  for (const move of moves) {
    const next = applyPoolSearchMove(state, move);
    scores.set(move, next ? poolSearch(next, root, depth - 1, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY) : Number.NEGATIVE_INFINITY);
  }
  return [...moves].sort((left, right) => (scores.get(right) ?? Number.NEGATIVE_INFINITY) - (scores.get(left) ?? Number.NEGATIVE_INFINITY) || poolMoveOrder(right) - poolMoveOrder(left) || left.localeCompare(right));
}

function poolSearch(state: PoolSearchState, root: Color, depth: number, alphaStart: number, betaStart: number): number {
  if (state.winner) return state.winner === root ? 1_000_000 + depth : -1_000_000 - depth;
  if (depth <= 0) return evaluatePool(state, root);
  const moves = poolLegalMoves(state).sort((left, right) => poolMoveOrder(right) - poolMoveOrder(left) || left.localeCompare(right));
  if (moves.length === 0) return evaluatePool(state, root);
  const maximizing = state.turn === root;
  let value = maximizing ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
  let alpha = alphaStart;
  let beta = betaStart;
  for (const move of moves) {
    const next = applyPoolSearchMove(state, move);
    if (!next) continue;
    const child = poolSearch(next, root, depth - 1, alpha, beta);
    if (maximizing) {
      value = Math.max(value, child);
      alpha = Math.max(alpha, value);
    } else {
      value = Math.min(value, child);
      beta = Math.min(beta, value);
    }
    if (beta <= alpha) break;
  }
  return value;
}

function poolLegalMoves(state: PoolSearchState): string[] {
  if (state.winner) return [];
  const group = state.turn === "black" ? "solids" : "stripes";
  const groupBalls = state.balls.filter((ball) => ball.group === group);
  const targets = groupBalls.length > 0 ? groupBalls : state.balls.filter((ball) => ball.group === "eight");
  const moves: string[] = [];
  for (const target of targets) for (const [pocket, point] of Object.entries(POOL_POCKETS)) {
    if (poolClearPot(state, target, point)) moves.push(`POT:${target.id}:${pocket}`);
  }
  for (const zone of ["L", "C", "R", "T", "B"]) moves.push(`SAFE:${zone}`);
  return moves;
}

function applyPoolSearchMove(state: PoolSearchState, move: string): PoolSearchState | undefined {
  if (!poolLegalMoves(state).includes(move)) return;
  const next: PoolSearchState = { cueBall: { ...state.cueBall }, balls: state.balls.map((ball) => ({ ...ball })), turn: state.turn };
  if (move.startsWith("POT:")) {
    const ballId = Number(move.split(":")[1]);
    const ball = next.balls.find((candidate) => candidate.id === ballId);
    if (!ball) return;
    next.cueBall = { x: ball.x, y: ball.y };
    next.balls = next.balls.filter((candidate) => candidate.id !== ballId);
    if (ball.group === "eight") next.winner = state.turn;
  } else {
    const point = POOL_SAFETIES[move.slice(5)];
    if (!point) return;
    next.cueBall = { ...point };
    next.turn = otherColor(state.turn);
  }
  return next;
}

function poolClearPot(state: PoolSearchState, target: PoolSnapshot["balls"][number], pocket: PoolPoint): boolean {
  const incoming = { x: target.x - state.cueBall.x, y: target.y - state.cueBall.y };
  const outgoing = { x: pocket.x - target.x, y: pocket.y - target.y };
  if (incoming.x * outgoing.x + incoming.y * outgoing.y <= 0) return false;
  return state.balls.every((ball) => ball.id === target.id || distanceToPoolSegment(ball, state.cueBall, target) >= 5)
    && state.balls.every((ball) => ball.id === target.id || distanceToPoolSegment(ball, target, pocket) >= 5);
}

function distanceToPoolSegment(point: PoolPoint, start: PoolPoint, end: PoolPoint): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = dx * dx + dy * dy;
  const projection = length === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / length));
  return Math.hypot(point.x - (start.x + projection * dx), point.y - (start.y + projection * dy));
}

function evaluatePool(state: PoolSearchState, root: Color): number {
  const rootGroup = root === "black" ? "solids" : "stripes";
  const opponentGroup = root === "black" ? "stripes" : "solids";
  const rootRemaining = state.balls.filter((ball) => ball.group === rootGroup).length;
  const opponentRemaining = state.balls.filter((ball) => ball.group === opponentGroup).length;
  const rootProgress = 3 - rootRemaining;
  const opponentProgress = 3 - opponentRemaining;
  const rootReady = rootRemaining === 0 && state.balls.some((ball) => ball.group === "eight") ? 1 : 0;
  const opponentReady = opponentRemaining === 0 && state.balls.some((ball) => ball.group === "eight") ? 1 : 0;
  const potMobility = poolLegalMoves(state).filter((move) => move.startsWith("POT:")).length;
  return (rootProgress - opponentProgress) * 900 + (rootReady - opponentReady) * 2_500 + (state.turn === root ? potMobility : -potMobility) * 35;
}

function poolMoveOrder(move: string): number {
  if (/^POT:8:/.test(move)) return 100_000;
  if (move.startsWith("POT:")) return 10_000;
  return move === "SAFE:C" ? 100 : 0;
}

type BasketballSearchState = {
  turn: Color;
  score: Record<Color, number>;
  energy: Record<Color, number>;
  streak: Record<Color, number>;
  attempts: Record<Color, number>;
  previousMove: Partial<Record<Color, BasketballMove>>;
  phase: "regulation" | "overtime";
  winner?: Color | "draw";
};

const BASKETBALL_PROFILES: ReadonlyArray<{ move: BasketballMove; points: 2 | 3; energyCost: 0 | 1 | 2; baseAccuracy: number }> = [
  { move: "drive", points: 2, energyCost: 2, baseAccuracy: 82 },
  { move: "pull-up", points: 2, energyCost: 1, baseAccuracy: 66 },
  { move: "three", points: 3, energyCost: 0, baseAccuracy: 48 },
];

function rankedBasketballMoves(game: BasketballSnapshot, moves: string[], depth: number): string[] {
  const previousMove: Partial<Record<Color, BasketballMove>> = {};
  for (const result of game.shotResults) previousMove[result.color] = result.move;
  const state: BasketballSearchState = {
    turn: game.turn,
    score: { ...game.score },
    energy: { ...game.energy },
    streak: { ...game.streak },
    attempts: { ...game.attempts },
    previousMove,
    phase: game.phase,
  };
  const root = game.turn;
  const scores = new Map<string, number>();
  for (const move of moves) {
    const option = basketballOptions(state).find((candidate) => candidate.move === move);
    if (!option) {
      scores.set(move, Number.NEGATIVE_INFINITY);
      continue;
    }
    scores.set(move, basketballExpectedValue(state, option, root, depth));
  }
  const order = ["drive", "pull-up", "three"];
  return [...moves].sort((left, right) => (scores.get(right) ?? Number.NEGATIVE_INFINITY) - (scores.get(left) ?? Number.NEGATIVE_INFINITY) || order.indexOf(left) - order.indexOf(right));
}

function basketballExpectedValue(state: BasketballSearchState, option: ReturnType<typeof basketballOptions>[number], root: Color, depth: number): number {
  const probability = option.accuracy / 100;
  const made = applyBasketballOutcome(state, option, true);
  const missed = applyBasketballOutcome(state, option, false);
  return probability * basketballSearch(made, root, depth - 1) + (1 - probability) * basketballSearch(missed, root, depth - 1);
}

function basketballSearch(state: BasketballSearchState, root: Color, depth: number): number {
  if (state.winner) return state.winner === "draw" ? 0 : state.winner === root ? 1_000_000 + depth : -1_000_000 - depth;
  if (depth <= 0) return evaluateBasketball(state, root);
  const options = basketballOptions(state);
  const values = options.map((option) => basketballExpectedValue(state, option, root, depth));
  return state.turn === root ? Math.max(...values) : Math.min(...values);
}

function basketballOptions(state: BasketballSearchState) {
  return BASKETBALL_PROFILES.filter((profile) => state.energy[state.turn] >= profile.energyCost).map((profile) => ({
    ...profile,
    accuracy: Math.max(20, Math.min(92, profile.baseAccuracy + Math.min(10, state.streak[state.turn] * 5) - (state.previousMove[state.turn] === profile.move ? 12 : 0))),
  }));
}

function applyBasketballOutcome(state: BasketballSearchState, option: ReturnType<typeof basketballOptions>[number], made: boolean): BasketballSearchState {
  const color = state.turn;
  const next: BasketballSearchState = {
    turn: state.turn,
    score: { ...state.score },
    energy: { ...state.energy },
    streak: { ...state.streak },
    attempts: { ...state.attempts },
    previousMove: { ...state.previousMove, [color]: option.move },
    phase: state.phase,
  };
  next.energy[color] -= option.energyCost;
  next.attempts[color] += 1;
  if (made) next.score[color] += option.points;
  next.streak[color] = made ? next.streak[color] + 1 : 0;
  if (color === "black") {
    next.turn = "white";
    return next;
  }
  const completedRound = next.attempts.white;
  if (completedRound < 5) {
    next.turn = "black";
    return next;
  }
  if (next.score.black !== next.score.white) {
    next.winner = next.score.black > next.score.white ? "black" : "white";
    return next;
  }
  if (completedRound >= 8) {
    next.winner = "draw";
    return next;
  }
  next.phase = "overtime";
  next.energy.black = Math.min(4, next.energy.black + 1);
  next.energy.white = Math.min(4, next.energy.white + 1);
  next.turn = "black";
  return next;
}

function evaluateBasketball(state: BasketballSearchState, root: Color): number {
  const opponent = otherColor(root);
  const scoreLead = state.score[root] - state.score[opponent];
  const energyLead = state.energy[root] - state.energy[opponent];
  const attemptLead = state.attempts[root] - state.attempts[opponent];
  return scoreLead * 1_000 + energyLead * 30 - attemptLead * 20;
}

export function embeddedMoveDecision(game: GameSnapshot): EmbeddedMoveDecision {
  const candidateMoves = embeddedMoveCandidates(game);
  const position = game.kind === "chess"
    ? Array.from({ length: 8 }, (_, row) => game.board.slice(row * 8, row * 8 + 8).map((cell) => {
      if (!cell.piece || !cell.color) return ".";
      return cell.color === "white" ? cell.piece.toUpperCase() : cell.piece;
    }).join("")).join("/")
    : game.kind === "pool"
      ? [`C@${game.cueBall.x},${game.cueBall.y}`, ...game.balls.map((ball) => `${ball.id}${ball.group === "solids" ? "S" : ball.group === "stripes" ? "R" : "E"}@${ball.x},${ball.y}`)].join("|")
      : game.kind === "basketball"
        ? `score:B${game.score.black}-W${game.score.white}|energy:B${game.energy.black}-W${game.energy.white}|attempts:B${game.attempts.black}-W${game.attempts.white}|${game.phase}:R${game.round}|options:${game.shotOptions.filter((option) => game.legalMoves.includes(option.move)).map((option) => `${option.move}/${option.points}pt/${option.energyCost}e/${option.accuracy}%`).join(",")}`
        : game.board.map((row) => row.map((cell) => cell === "black" ? "B" : cell === "white" ? "W" : ".").join("")).join("/");
  return {
    gameId: game.gameId,
    kind: game.kind,
    difficulty: game.difficulty,
    turn: game.turn,
    expectedResetEpoch: game.resetEpoch ?? 0,
    expectedVersion: game.stateVersion,
    positionFormat: game.kind === "chess"
      ? "ranks 8-to-1; files a-to-h; uppercase=White, lowercase=Black, .=empty"
      : game.kind === "go"
        ? `rows ${game.boardSize}-to-1; columns ${GO_COLUMNS.slice(0, game.boardSize)}; B=black, W=white, .=empty`
        : game.kind === "tic-tac-toe"
          ? "rows 3-to-1; columns A-to-C; B=black, W=white, .=empty"
          : game.kind === "connect-four"
            ? "rows 6-to-1; columns A-to-G; B=black, W=white, .=empty"
            : game.kind === "reversi"
              ? "rows 8-to-1; columns A-to-H; B=black, W=white, .=empty"
              : game.kind === "pool"
                ? "100x50 table; C=cue, S=solid, R=stripe, E=8-ball; pockets TL/TM/TR/BL/BM/BR"
                : "score, energy, attempts, round, and public move/points/energy/accuracy options",
    position,
    ...(game.lastMove ? { lastMove: { actor: game.lastMove.actor, color: game.lastMove.color, move: game.lastMove.notation, ply: game.lastMove.ply } } : {}),
    legalMoveCount: game.legalMoves.length,
    candidatesTruncated: candidateMoves.length < new Set(game.legalMoves).size,
    candidateMoves,
    ...(game.kind === "go" ? { captures: game.captures, consecutivePasses: game.consecutivePasses } : {}),
    ...(game.kind === "reversi" ? { score: game.score } : {}),
    ...(game.kind === "basketball" ? { score: game.score, energy: game.energy, attempts: game.attempts, phase: game.phase, round: game.round, shotOptions: game.shotOptions.filter((option) => game.legalMoves.includes(option.move)) } : {}),
  };
}

export function embeddedMoveCandidates(game: GameSnapshot): string[] {
  const legalMoves = [...new Set(game.legalMoves)].sort((left, right) => left.localeCompare(right));
  if (legalMoves.length === 0) return [];
  const nonPass = legalMoves.filter((move) => move !== "pass");
  if (nonPass.length === 0) return legalMoves;
  const limit = EMBEDDED_CANDIDATE_LIMIT[game.difficulty];

  const ranked = strategicallyRankedMoves(game, nonPass);
  const recommended = game.difficulty === "easy" || (game.kind === "go" && game.consecutivePasses === 1)
    ? chooseStandaloneMove(game)
    : ranked[0];
  const candidateMoves: string[] = [];
  const add = (move: string | undefined) => {
    if (move && legalMoves.includes(move) && !candidateMoves.includes(move) && candidateMoves.length < limit) candidateMoves.push(move);
  };
  add(recommended);

  const tacticalBudget = game.difficulty === "hard" ? Math.ceil(limit * 0.75) : game.difficulty === "medium" ? Math.ceil(limit / 2) : 2;
  for (const move of ranked.slice(0, tacticalBudget)) add(move);

  if (game.kind === "go" && game.difficulty !== "easy") {
    for (const move of ranked) add(move);
  } else {
    // Easy mode stays unpredictable by sampling across the entire move space.
    const remaining = limit - candidateMoves.length;
    for (let index = 0; index < remaining; index += 1) {
      const position = remaining === 1 ? Math.floor((nonPass.length - 1) / 2) : Math.round(index * (nonPass.length - 1) / (remaining - 1));
      add(nonPass[position]);
    }
  }
  for (const move of ranked) add(move);

  if (game.kind === "go" && game.consecutivePasses === 1 && recommended === "pass") {
    if (candidateMoves.length === limit) candidateMoves.pop();
    add("pass");
  }
  return candidateMoves;
}

export function embeddedMovePrompt(game: GameSnapshot, decision = embeddedMoveDecision(game)): string {
  const level = game.difficulty.toUpperCase();
  return [
    `FAST_TURN ${JSON.stringify(decision)}.`,
    "This compact state comes from the authoritative current position.",
    gameThinkingInstruction(game),
    difficultyInstruction[game.difficulty],
    `For ${level}, think silently and briefly, compare candidateMoves instead of treating their order as a verdict, then make your first visible action exactly one play_game_move call with actor 'gpt', one exact candidate string, and the FAST_TURN gameId, expectedResetEpoch, and expectedVersion.`,
    "Do not call get_game_state, create_game, reset_game, or render_game on this normal fast path. Never retry the mutation.",
    "Only say the move landed after a matching MOVE_CONFIRMED receipt. An explicit MOVE_NOT_APPLIED means it did not land. For a transport/internal error or missing/mismatched receipt, say the move is not confirmed; you may call get_game_state once to reconcile, but never call play_game_move again.",
  ].join(" ");
}

function gameThinkingInstruction(game: GameSnapshot): string {
  if (game.kind === "chess") return "Chess priorities: mate and checks, captures and opponent replies, king safety, material, then development and activity.";
  if (game.kind === "go") return "Go priorities: capture or rescue urgent groups, check liberties and atari, avoid self-atari and eye-filling, then prefer efficient corner/side development, connection, cuts, and whole-board balance; pass only when the position is settled.";
  if (game.kind === "tic-tac-toe") return "Tic-Tac-Toe priorities: win, block, create or stop a fork, then center, corners, and edges.";
  if (game.kind === "connect-four") return "Connect Four priorities: win, block, create or stop double threats, avoid enabling an immediate reply, then prefer central control.";
  if (game.kind === "reversi") return "Reversi priorities: secure corners, limit opponent mobility and frontier access, value stable edges, avoid unsafe corner-adjacent squares, and count immediate flips last.";
  if (game.kind === "pool") return "Mini 8-Ball priorities: take a legal 8-ball winner, extend a runout with clear pots, preserve future pot lanes, and use a safety only when it reduces the opponent's chances.";
  return "Court Duel priorities: use only public accuracy, score pressure, remaining matched attempts, energy, and streaks; never try to predict or reverse-engineer the hidden deterministic result roll.";
}

function strategicallyRankedMoves(game: GameSnapshot, moves: string[]): string[] {
  if (game.kind === "chess") return rankedChessMoves(game, moves, game.difficulty === "hard" ? 3 : game.difficulty === "medium" ? 2 : 1);
  if (game.kind === "go") {
    const analysis = analyzeGoPosition(game);
    const scores = new Map(moves.map((move) => [move, scoreGoMove(game, move, analysis)]));
    return [...moves].sort((left, right) => (scores.get(right) ?? Number.NEGATIVE_INFINITY) - (scores.get(left) ?? Number.NEGATIVE_INFINITY) || left.localeCompare(right));
  }
  if (game.kind === "tic-tac-toe") return rankedTicMoves(game, moves, game.difficulty === "hard");
  if (game.kind === "connect-four") return rankedConnectMoves(game, moves, game.difficulty === "hard" ? 5 : game.difficulty === "medium" ? 3 : 1);
  if (game.kind === "reversi") return rankedReversiMoves(game, moves, game.difficulty === "hard" ? 3 : 1);
  if (game.kind === "pool") return rankedPoolMoves(game, moves, game.difficulty === "hard" ? 5 : game.difficulty === "medium" ? 2 : 1);
  return rankedBasketballMoves(game, moves, game.difficulty === "hard" ? 6 : game.difficulty === "medium" ? 3 : 1);
}

function bestScored(moves: string[], score: (move: string) => number): string {
  let best = moves[0];
  let bestScore = score(best);
  for (const move of moves.slice(1)) {
    const nextScore = score(move);
    if (nextScore > bestScore) {
      best = move;
      bestScore = nextScore;
    }
  }
  return best;
}

function stableHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function positionKey(game: GameSnapshot): string {
  const board = game.kind === "chess"
    ? game.board.map((cell) => `${cell.square}${cell.color?.[0] ?? "."}${cell.piece ?? "."}`).join("")
    : game.kind === "pool"
      ? `${game.cueBall.x},${game.cueBall.y}|${game.balls.map((ball) => `${ball.id}@${ball.x},${ball.y}`).join("|")}`
      : game.kind === "basketball"
        ? `${game.score.black}-${game.score.white}|${game.energy.black}-${game.energy.white}|${game.streak.black}-${game.streak.white}|${game.attempts.black}-${game.attempts.white}|${game.shotResults.map((shot) => `${shot.color[0]}${shot.move}${shot.made ? 1 : 0}`).join("|")}`
        : game.board.map((row) => row.map((stone) => stone?.[0] ?? ".").join("")).join("/");
  return `${game.kind}|${game.turn}|${game.stateVersion}|${board}|${game.legalMoves.join(",")}`;
}

type ChessSearchState = { nodes: number; maxNodes: number; cache: Map<string, number> };

function rankedChessMoves(game: ChessSnapshot, moves: string[], depth: number): string[] {
  const chess = chessFromHistory(game);
  if (!chess) return [...moves].sort((left, right) => scoreChessMove(game, right) - scoreChessMove(game, left) || left.localeCompare(right));
  const root = game.turn === "white" ? "w" : "b";
  const scores = new Map<string, number>();
  for (const move of moves) {
    const applied = applyChessUci(chess, move);
    if (!applied) {
      scores.set(move, Number.NEGATIVE_INFINITY);
      continue;
    }
    const score = chessSearch(chess, 0, root, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY, { nodes: 0, maxNodes: 1, cache: new Map() });
    chess.undo();
    scores.set(move, score);
  }
  const baseline = [...moves].sort((left, right) => (scores.get(right) ?? Number.NEGATIVE_INFINITY) - (scores.get(left) ?? Number.NEGATIVE_INFINITY) || left.localeCompare(right));
  const deeperCandidates = depth >= 3 ? baseline.slice(0, 8) : baseline;
  if (depth >= 2) for (const move of deeperCandidates) {
    const applied = applyChessUci(chess, move);
    if (!applied) continue;
    const state: ChessSearchState = { nodes: 0, maxNodes: depth >= 3 ? 1_200 : 600, cache: new Map() };
    scores.set(move, chessSearch(chess, depth - 1, root, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY, state));
    chess.undo();
  }
  if (depth >= 3) {
    const deepSet = new Set(deeperCandidates);
    const searched = [...deeperCandidates].sort((left, right) => (scores.get(right) ?? Number.NEGATIVE_INFINITY) - (scores.get(left) ?? Number.NEGATIVE_INFINITY) || left.localeCompare(right));
    return [...searched, ...baseline.filter((move) => !deepSet.has(move))];
  }
  return [...moves].sort((left, right) => (scores.get(right) ?? Number.NEGATIVE_INFINITY) - (scores.get(left) ?? Number.NEGATIVE_INFINITY) || left.localeCompare(right));
}

function chessFromHistory(game: ChessSnapshot): Chess | undefined {
  const chess = new Chess();
  try {
    for (const record of game.moveHistory) {
      if (!applyChessUci(chess, record.notation)) return;
    }
  } catch {
    return;
  }
  const expectedTurn = game.turn === "white" ? "w" : "b";
  if (chess.turn() !== expectedTurn || chessBoardKey(chess) !== snapshotChessBoardKey(game)) return;
  return chess;
}

function applyChessUci(chess: Chess, move: string): boolean {
  try {
    chess.move({
      from: move.slice(0, 2),
      to: move.slice(2, 4),
      ...(move[4] ? { promotion: move[4] as PieceSymbol } : {}),
    });
    return true;
  } catch {
    return false;
  }
}

function chessSearch(chess: Chess, depth: number, root: "w" | "b", alphaStart: number, betaStart: number, state: ChessSearchState): number {
  state.nodes += 1;
  if (chess.isCheckmate()) return chess.turn() === root ? -100_000 - depth : 100_000 + depth;
  if (chess.isDraw()) return 0;
  if (depth <= 0 || state.nodes >= state.maxNodes) return evaluateChess(chess, root);
  const key = `${depth}|${chess.fen()}`;
  const cached = state.cache.get(key);
  if (cached !== undefined) return cached;
  const maximizing = chess.turn() === root;
  let value = maximizing ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
  let alpha = alphaStart;
  let beta = betaStart;
  let searchedAll = true;
  const moves = chess.moves({ verbose: true }).sort((left, right) => chessMoveOrder(right) - chessMoveOrder(left) || `${left.from}${left.to}${left.promotion ?? ""}`.localeCompare(`${right.from}${right.to}${right.promotion ?? ""}`));
  for (const move of moves) {
    chess.move({ from: move.from, to: move.to, ...(move.promotion ? { promotion: move.promotion } : {}) });
    const child = chessSearch(chess, depth - 1, root, alpha, beta, state);
    chess.undo();
    if (maximizing) {
      value = Math.max(value, child);
      alpha = Math.max(alpha, value);
    } else {
      value = Math.min(value, child);
      beta = Math.min(beta, value);
    }
    if (beta <= alpha || state.nodes >= state.maxNodes) {
      searchedAll = false;
      break;
    }
  }
  if (searchedAll) state.cache.set(key, value);
  return value;
}

function chessMoveOrder(move: { captured?: PieceSymbol; promotion?: PieceSymbol; san: string }): number {
  const values: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
  return (move.san.includes("#") ? 50_000 : move.san.includes("+") ? 5_000 : 0) + (move.captured ? values[move.captured] * 500 : 0) + (move.promotion ? values[move.promotion] * 300 : 0);
}

function evaluateChess(chess: Chess, root: "w" | "b"): number {
  const values: Record<PieceSymbol, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
  let score = 0;
  for (const rank of "12345678") for (const file of "abcdefgh") {
    const square = `${file}${rank}` as Square;
    const piece = chess.get(square);
    if (!piece) continue;
    const row = Number(rank) - 1;
    const column = file.charCodeAt(0) - 97;
    const center = 7 - (Math.abs(row - 3.5) + Math.abs(column - 3.5));
    const advancement = piece.color === "w" ? row : 7 - row;
    const positional = (piece.type === "n" || piece.type === "b" ? center * 4 : 0) + (piece.type === "p" ? advancement * 2 : 0);
    score += (piece.color === root ? 1 : -1) * (values[piece.type] + positional);
  }
  const mobility = chess.moves().length * 2;
  score += chess.turn() === root ? mobility : -mobility;
  if (chess.inCheck()) score += chess.turn() === root ? -35 : 35;
  return score;
}

function chessBoardKey(chess: Chess): string {
  const cells: string[] = [];
  for (const rank of "12345678") for (const file of "abcdefgh") {
    const square = `${file}${rank}` as Square;
    const piece = chess.get(square);
    if (piece) cells.push(`${square}${piece.color}${piece.type}`);
  }
  return cells.sort().join("|");
}

function snapshotChessBoardKey(game: ChessSnapshot): string {
  return game.board.filter((cell) => cell.color && cell.piece).map((cell) => `${cell.square}${cell.color === "white" ? "w" : "b"}${cell.piece}`).sort().join("|");
}

function scoreChessMove(game: ChessSnapshot, move: string): number {
  const from = move.slice(0, 2);
  const to = move.slice(2, 4);
  const promotion = move[4] as ChessPiece | undefined;
  const board = new Map<string, ChessBoardPiece>();
  for (const cell of game.board) if (cell.color && cell.piece) board.set(cell.square, { color: cell.color, piece: cell.piece });
  const moving = board.get(from);
  const fromPoint = chessPoint(from);
  const toPoint = chessPoint(to);
  if (!moving || !fromPoint || !toPoint) return Number.NEGATIVE_INFINITY;

  let captured = board.get(to);
  board.delete(from);
  if (moving.piece === "p" && fromPoint.column !== toPoint.column && !captured) {
    const capturedSquare = chessSquare({ row: fromPoint.row, column: toPoint.column });
    captured = board.get(capturedSquare);
    board.delete(capturedSquare);
  }
  board.delete(to);
  if (moving.piece === "k" && Math.abs(toPoint.column - fromPoint.column) === 2) {
    const kingSide = toPoint.column > fromPoint.column;
    const rookFrom = chessSquare({ row: fromPoint.row, column: kingSide ? 7 : 0 });
    const rookTo = chessSquare({ row: fromPoint.row, column: kingSide ? 5 : 3 });
    const rook = board.get(rookFrom);
    if (rook) {
      board.delete(rookFrom);
      board.set(rookTo, rook);
    }
  }
  const resultingPiece = promotion && ["q", "r", "b", "n"].includes(promotion) ? promotion : moving.piece;
  board.set(to, { color: moving.color, piece: resultingPiece });

  const opponent: Color = moving.color === "white" ? "black" : "white";
  const friendlyAttacks = attackedSquares(board, moving.color);
  const opponentAttacks = attackedSquares(board, opponent);
  const centerDistance = Math.abs(toPoint.row - 3.5) + Math.abs(toPoint.column - 3.5);
  let score = (captured ? PIECE_VALUE[captured.piece] : 0) * 1_000;
  if (promotion) score += (PIECE_VALUE[resultingPiece] - PIECE_VALUE.p) * 900;
  if (moving.piece === "k" && Math.abs(toPoint.column - fromPoint.column) === 2) score += 180;
  if ((moving.piece === "n" || moving.piece === "b") && isHomeMinorSquare(from, moving.color)) score += 55;
  if (moving.piece === "p") score += Math.abs(toPoint.row - fromPoint.row) * 12;
  score += (7 - centerDistance) * 10;
  if (opponentAttacks.has(to)) score -= PIECE_VALUE[resultingPiece] * 650;
  if (friendlyAttacks.has(to)) score += PIECE_VALUE[resultingPiece] * 85;

  for (const [square, piece] of board) {
    if (piece.color === opponent && friendlyAttacks.has(square)) score += PIECE_VALUE[piece.piece] * 35;
    if (piece.color === opponent && piece.piece === "k" && friendlyAttacks.has(square)) score += 900;
  }
  return score;
}

function isHomeMinorSquare(square: string, color: Color): boolean {
  return color === "white" ? ["b1", "c1", "f1", "g1"].includes(square) : ["b8", "c8", "f8", "g8"].includes(square);
}

function attackedSquares(board: Map<string, ChessBoardPiece>, color: Color): Set<string> {
  const attacked = new Set<string>();
  for (const [square, piece] of board) {
    if (piece.color !== color) continue;
    const point = chessPoint(square);
    if (!point) continue;
    if (piece.piece === "p") {
      const direction = color === "white" ? 1 : -1;
      addChessPoint(attacked, { row: point.row + direction, column: point.column - 1 });
      addChessPoint(attacked, { row: point.row + direction, column: point.column + 1 });
    } else if (piece.piece === "n") {
      for (const [row, column] of [[2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [1, -2], [-1, 2], [-1, -2]]) addChessPoint(attacked, { row: point.row + row, column: point.column + column });
    } else if (piece.piece === "k") {
      for (let row = -1; row <= 1; row += 1) for (let column = -1; column <= 1; column += 1) if (row !== 0 || column !== 0) addChessPoint(attacked, { row: point.row + row, column: point.column + column });
    } else {
      const directions = piece.piece === "b" ? [[1, 1], [1, -1], [-1, 1], [-1, -1]] : piece.piece === "r" ? [[1, 0], [-1, 0], [0, 1], [0, -1]] : [[1, 1], [1, -1], [-1, 1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
      for (const [rowStep, columnStep] of directions) {
        let cursor = { row: point.row + rowStep, column: point.column + columnStep };
        while (validChessPoint(cursor)) {
          const target = chessSquare(cursor);
          attacked.add(target);
          if (board.has(target)) break;
          cursor = { row: cursor.row + rowStep, column: cursor.column + columnStep };
        }
      }
    }
  }
  return attacked;
}

function chessPoint(square: string): Point | undefined {
  if (!/^[a-h][1-8]$/.test(square)) return undefined;
  return { row: Number(square[1]) - 1, column: square.charCodeAt(0) - 97 };
}

function chessSquare(point: Point): string {
  return `${String.fromCharCode(97 + point.column)}${point.row + 1}`;
}

function validChessPoint(point: Point): boolean {
  return point.row >= 0 && point.row < 8 && point.column >= 0 && point.column < 8;
}

function addChessPoint(points: Set<string>, point: Point): void {
  if (validChessPoint(point)) points.add(chessSquare(point));
}

function analyzeGoPosition(game: GoSnapshot): GoPositionAnalysis {
  const friendlyAtariByLiberty = new Map<string, number>();
  const friendlyStones: Point[] = [];
  const opponentStones: Point[] = [];
  const visited = new Set<string>();
  let occupied = 0;
  for (let row = 0; row < game.boardSize; row += 1) {
    for (let column = 0; column < game.boardSize; column += 1) {
      const color = game.board[row][column];
      if (color) {
        occupied += 1;
        (color === game.turn ? friendlyStones : opponentStones).push({ row, column });
      }
      if (color !== game.turn) continue;
      const key = goKey({ row, column });
      if (visited.has(key)) continue;
      const group = goGroup(game.board, { row, column });
      for (const stone of group.stones) visited.add(goKey(stone));
      if (group.liberties.size === 1) {
        const liberty = [...group.liberties][0];
        friendlyAtariByLiberty.set(liberty, (friendlyAtariByLiberty.get(liberty) ?? 0) + group.stones.length);
      }
    }
  }
  return { occupied, friendlyAtariByLiberty, friendlyStones, opponentStones };
}

function shouldCompleteGoByPassing(
  game: GoSnapshot,
  legalMoves: string[],
  placementScores: Map<string, number>,
  analysis: GoPositionAnalysis,
): boolean {
  if (game.consecutivePasses !== 1 || !legalMoves.includes("pass")) return false;
  if (analysis.occupied / (game.boardSize * game.boardSize) < GO_ENDGAME_OCCUPANCY) return false;
  return [...placementScores.values()].every((score) => score < GO_TACTICAL_CONTINUE_SCORE);
}

function scoreGoMove(game: GoSnapshot, move: string, analysis: GoPositionAnalysis): number {
  const point = goPoint(move, game.boardSize);
  if (!point) return Number.NEGATIVE_INFINITY;
  const board = game.board.map((row) => [...row]);
  const color = game.turn;
  const opponent: Color = color === "black" ? "white" : "black";
  const adjacentFriendlyGroups = new Set<string>();
  const adjacentOpponentGroups = new Set<string>();
  for (const neighbor of goNeighbors(point, game.boardSize)) {
    if (board[neighbor.row][neighbor.column] === color) adjacentFriendlyGroups.add(groupKey(goGroup(board, neighbor)));
    if (board[neighbor.row][neighbor.column] === opponent) adjacentOpponentGroups.add(groupKey(goGroup(board, neighbor)));
  }
  const eyeFill = goNeighbors(point, game.boardSize).length > 1 && goNeighbors(point, game.boardSize).every((neighbor) => board[neighbor.row][neighbor.column] === color);
  let savedStones = analysis.friendlyAtariByLiberty.get(goKey(point)) ?? 0;

  board[point.row][point.column] = color;
  let captured = 0;
  const inspectedOpponents = new Set<string>();
  for (const neighbor of goNeighbors(point, game.boardSize)) {
    if (board[neighbor.row][neighbor.column] !== opponent) continue;
    const group = goGroup(board, neighbor);
    const key = groupKey(group);
    if (inspectedOpponents.has(key)) continue;
    inspectedOpponents.add(key);
    if (group.liberties.size === 0) {
      captured += group.stones.length;
      for (const stone of group.stones) board[stone.row][stone.column] = null;
    }
  }
  const ownGroup = goGroup(board, point);
  if (ownGroup.liberties.size <= 1) savedStones = 0;

  let threatenedStones = 0;
  const threatenedGroups = new Set<string>();
  for (const neighbor of goNeighbors(point, game.boardSize)) {
    if (board[neighbor.row][neighbor.column] !== opponent) continue;
    const group = goGroup(board, neighbor);
    const key = groupKey(group);
    if (!threatenedGroups.has(key) && group.liberties.size === 1) {
      threatenedGroups.add(key);
      threatenedStones += group.stones.length;
    }
  }

  const opening = analysis.occupied / (game.boardSize * game.boardSize) < 0.18;
  const starDistance = Math.min(...goStarPoints(game.boardSize).map((star) => Math.abs(star.row - point.row) + Math.abs(star.column - point.column)));
  const tactical = captured > 0 || savedStones > 0 || threatenedStones > 0;
  let score = captured * 10_000 + savedStones * 5_000 + threatenedStones * 700;
  score += ownGroup.liberties.size * 40;
  score += adjacentFriendlyGroups.size >= 2 ? adjacentFriendlyGroups.size * 260 : opening && !tactical ? adjacentFriendlyGroups.size * -180 : adjacentFriendlyGroups.size * 180;
  if (adjacentOpponentGroups.size >= 2) score += adjacentOpponentGroups.size * 180;
  if (opening && !tactical) {
    const anchors = goOpeningAnchors(game.boardSize);
    const anchor = anchors.reduce((best, candidate) => manhattan(candidate, point) < manhattan(best, point) ? candidate : best);
    const anchorDistance = manhattan(anchor, point);
    const cornerRadius = game.boardSize === 19 ? 5 : game.boardSize === 13 ? 4 : 3;
    const friendlyInCorner = analysis.friendlyStones.some((stone) => manhattan(stone, anchor) <= cornerRadius);
    const opponentInCorner = analysis.opponentStones.some((stone) => manhattan(stone, anchor) <= cornerRadius);
    const friendlyDistance = minimumGoDistance(point, analysis.friendlyStones);
    const edgeDepth = Math.min(point.row, point.column, game.boardSize - 1 - point.row, game.boardSize - 1 - point.column);
    score += Math.max(0, 620 - anchorDistance * 95);
    score += !friendlyInCorner && !opponentInCorner ? 320 : friendlyInCorner ? -300 : 80;
    if (friendlyDistance !== undefined) {
      score += Math.min(220, friendlyDistance * 20);
      if (friendlyDistance <= 1) score -= 760;
      else if (friendlyDistance <= 3) score -= 380;
    }
    if (edgeDepth === 0) score -= 1_400;
    else if (edgeDepth === 1) score -= 650;
    else if (edgeDepth === 2 && game.boardSize >= 13) score -= 80;
  } else if (opening) {
    score += Math.max(0, 280 - starDistance * 45);
  }
  if (ownGroup.liberties.size === 1 && captured === 0) score -= 4_000;
  if (game.difficulty === "hard" && ownGroup.liberties.size === 2 && !tactical) score -= 220;
  if (eyeFill && captured === 0) score -= 3_000;
  return score;
}

function manhattan(left: Point, right: Point): number {
  return Math.abs(left.row - right.row) + Math.abs(left.column - right.column);
}

function minimumGoDistance(point: Point, stones: Point[]): number | undefined {
  return stones.length === 0 ? undefined : Math.min(...stones.map((stone) => manhattan(point, stone)));
}

function goPoint(move: string, size: number): Point | undefined {
  const match = /^([A-HJ-T])([1-9]|1[0-9])$/.exec(move);
  if (!match) return undefined;
  const column = GO_COLUMNS.indexOf(match[1]);
  const rank = Number(match[2]);
  if (column < 0 || column >= size || rank < 1 || rank > size) return undefined;
  return { row: size - rank, column };
}

function goNeighbors(point: Point, size: number): Point[] {
  return [
    { row: point.row - 1, column: point.column },
    { row: point.row + 1, column: point.column },
    { row: point.row, column: point.column - 1 },
    { row: point.row, column: point.column + 1 },
  ].filter((neighbor) => neighbor.row >= 0 && neighbor.row < size && neighbor.column >= 0 && neighbor.column < size);
}

function goGroup(board: GoBoard, start: Point): { stones: Point[]; liberties: Set<string> } {
  const color = board[start.row][start.column];
  if (!color) return { stones: [], liberties: new Set() };
  const stones: Point[] = [];
  const liberties = new Set<string>();
  const visited = new Set<string>();
  const pending = [start];
  while (pending.length > 0) {
    const point = pending.pop() as Point;
    const key = goKey(point);
    if (visited.has(key)) continue;
    visited.add(key);
    stones.push(point);
    for (const neighbor of goNeighbors(point, board.length)) {
      const value = board[neighbor.row][neighbor.column];
      if (value === null) liberties.add(goKey(neighbor));
      else if (value === color && !visited.has(goKey(neighbor))) pending.push(neighbor);
    }
  }
  return { stones, liberties };
}

function groupKey(group: { stones: Point[] }): string {
  return group.stones.map(goKey).sort()[0] ?? "";
}

function goKey(point: Point): string {
  return `${point.row},${point.column}`;
}

function goStarPoints(size: GoSnapshot["boardSize"]): Point[] {
  if (size === 19) return [3, 9, 15].flatMap((row) => [3, 9, 15].map((column) => ({ row, column })));
  const edge = size === 13 ? [3, 9] : [2, 6];
  const center = Math.floor(size / 2);
  return [...edge.flatMap((row) => edge.map((column) => ({ row, column }))), { row: center, column: center }];
}

function goOpeningAnchors(size: GoSnapshot["boardSize"]): Point[] {
  const edge = size === 9 ? 2 : 3;
  const far = size - 1 - edge;
  return [{ row: edge, column: edge }, { row: edge, column: far }, { row: far, column: edge }, { row: far, column: far }];
}
