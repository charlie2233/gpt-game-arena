import type { ChessPiece, ChessSnapshot, Color, ConnectFourSnapshot, GameSnapshot, GoSnapshot, ReversiSnapshot, TicTacToeSnapshot } from "./types";

const GO_COLUMNS = "ABCDEFGHJKLMNOPQRST";
const PIECE_VALUE: Record<ChessPiece, number> = { p: 1, n: 3, b: 3.25, r: 5, q: 9, k: 100 };
const difficultyInstruction = {
  easy: "Play casually and choose a simple legal move without deep tactical search.",
  medium: "Play a balanced move after checking immediate captures, defenses, development, and shape.",
  hard: "Play your strongest move after carefully analyzing forcing moves, tactical threats, defenses, king safety, and positional consequences.",
} as const;

type ChessBoardPiece = { color: Color; piece: ChessPiece };
type Point = { row: number; column: number };
type GoBoard = (Color | null)[][];
type GoPositionAnalysis = {
  occupied: number;
  friendlyAtariByLiberty: Map<string, number>;
};

const GO_ENDGAME_OCCUPANCY = 0.35;
const GO_TACTICAL_CONTINUE_SCORE = 700;

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
    if (game.difficulty === "medium") return candidates[Math.floor(candidates.length / 2)];
    return candidates[stableHash(positionKey(game)) % candidates.length];
  }
  if (game.kind === "tic-tac-toe") return game.difficulty === "hard" ? hardTic(game, candidates) : game.difficulty === "medium" ? candidates[Math.floor(candidates.length / 2)] : candidates[stableHash(positionKey(game)) % candidates.length];
  if (game.kind === "connect-four") return game.difficulty === "hard" ? hardConnect(game, candidates) : game.difficulty === "medium" ? candidates[Math.floor(candidates.length / 2)] : candidates[stableHash(positionKey(game)) % candidates.length];
  if (game.kind === "reversi") return game.difficulty === "hard" ? hardReversi(game, candidates) : game.difficulty === "medium" ? candidates[Math.floor(candidates.length / 2)] : candidates[stableHash(positionKey(game)) % candidates.length];
  if (game.difficulty === "medium") return candidates[Math.floor(candidates.length / 2)];
  if (game.difficulty === "easy") return candidates[stableHash(positionKey(game)) % candidates.length];
  return bestScored(candidates, (move) => scoreChessMove(game, move));
}

function hardTic(game: TicTacToeSnapshot, moves: string[]): string {
  const win = (color: Color) => moves.find(move => ticWins(game.board, move, color));
  return win(game.turn) ?? win(game.turn === "black" ? "white" : "black") ?? ["B2", "A3", "C3", "A1", "C1"].find(move => moves.includes(move)) ?? moves[0];
}
function ticWins(board: (Color | null)[][], move: string, color: Color): boolean {
  const c = move.charCodeAt(0) - 65, r = 3 - Number(move[1]); if (r < 0 || c < 0) return false;
  const next = board.map(row => [...row]); next[r][c] = color;
  return [[0, 1, 2].map(i => [r, i]), [0, 1, 2].map(i => [i, c]), [[0, 0], [1, 1], [2, 2]], [[0, 2], [1, 1], [2, 0]]].some(line => line.every(([y, x]) => next[y][x] === color));
}
function hardConnect(game: ConnectFourSnapshot, moves: string[]): string {
  const opponent = game.turn === "black" ? "white" : "black";
  const win = (color: Color) => moves.find(move => connectWins(game.board, move, color));
  return win(game.turn) ?? win(opponent) ?? [...moves].sort((a, b) => Math.abs(a.charCodeAt(0) - 68) - Math.abs(b.charCodeAt(0) - 68) || a.localeCompare(b))[0];
}
function connectWins(board: (Color | null)[][], move: string, color: Color): boolean {
  const c = move.charCodeAt(0) - 65, next = board.map(row => [...row]); const r = [...next.keys()].reverse().find(row => !next[row][c]); if (r === undefined) return false; next[r][c] = color;
  return [[0, 1], [1, 0], [1, 1], [1, -1]].some(([dy, dx]) => { let n = 1; for (const sign of [-1, 1]) for (let y = r + dy * sign, x = c + dx * sign; y >= 0 && y < 6 && x >= 0 && x < 7 && next[y][x] === color; y += dy * sign, x += dx * sign) n++; return n >= 4; });
}
function hardReversi(game: ReversiSnapshot, moves: string[]): string {
  const corners = moves.filter(move => ["A1", "A8", "H1", "H8"].includes(move)); if (corners.length) return corners[0];
  const safe = moves.filter(move => !["A2", "B1", "B2", "A7", "B7", "B8", "G1", "G2", "H2", "G7", "G8", "H7"].includes(move));
  return bestScored(safe.length ? safe : moves, move => reversiFlips(game.board, move, game.turn));
}
function reversiFlips(board: (Color | null)[][], move: string, color: Color): number {
  const x = move.charCodeAt(0) - 65, y = 8 - Number(move[1]), enemy = color === "black" ? "white" : "black"; let flips = 0;
  for (const [dy, dx] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]) { let row = y + dy, col = x + dx, n = 0; while (row >= 0 && row < 8 && col >= 0 && col < 8 && board[row][col] === enemy) { n++; row += dy; col += dx; } if (n && board[row]?.[col] === color) flips += n; } return flips;
}

export function embeddedMovePrompt(game: GameSnapshot): string {
  const level = game.difficulty.toUpperCase();
  return [
    `Continue this game at ${level} difficulty.`,
    `Call get_game_state with exactly ${JSON.stringify({ gameId: game.gameId })} and use that freshly returned snapshot as the authority.`,
    difficultyInstruction[game.difficulty],
    "Choose exactly one string from that snapshot's legalMoves array.",
    "Then call play_game_move exactly once with actor 'gpt', that exact move, the same gameId, and expectedVersion from that same freshly fetched snapshot.",
    "Do not call create_game or reset_game.",
  ].join(" ");
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
    : game.board.map((row) => row.map((stone) => stone?.[0] ?? ".").join("")).join("/");
  return `${game.kind}|${game.turn}|${game.stateVersion}|${board}|${game.legalMoves.join(",")}`;
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
  const visited = new Set<string>();
  let occupied = 0;
  for (let row = 0; row < game.boardSize; row += 1) {
    for (let column = 0; column < game.boardSize; column += 1) {
      const color = game.board[row][column];
      if (color) occupied += 1;
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
  return { occupied, friendlyAtariByLiberty };
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
  for (const neighbor of goNeighbors(point, game.boardSize)) {
    if (board[neighbor.row][neighbor.column] === color) adjacentFriendlyGroups.add(groupKey(goGroup(board, neighbor)));
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

  const opening = analysis.occupied / (game.boardSize * game.boardSize) < 0.16;
  const starDistance = Math.min(...goStarPoints(game.boardSize).map((star) => Math.abs(star.row - point.row) + Math.abs(star.column - point.column)));
  let score = captured * 10_000 + savedStones * 5_000 + threatenedStones * 700;
  score += adjacentFriendlyGroups.size * 180 + ownGroup.liberties.size * 40;
  if (opening) score += Math.max(0, 280 - starDistance * 45);
  if (ownGroup.liberties.size === 1 && captured === 0) score -= 4_000;
  if (eyeFill && captured === 0) score -= 3_000;
  return score;
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
