import { Chess, type Square } from "chess.js";
import { describe, expect, it } from "vitest";

import { isConfirmedReset } from "./reset-validation";
import type {
  BasketballSnapshot,
  Board,
  ChessSnapshot,
  ChessSquare,
  ConnectFourSnapshot,
  GameSnapshot,
  GoBoardSize,
  GoPositionSetup,
  GoSnapshot,
  PoolSnapshot,
  ReversiSnapshot,
  TicTacToeSnapshot,
} from "./types";

const base = {
  gameId: "reset-validation",
  difficulty: "hard" as const,
  playerColor: "black" as const,
  status: "active" as const,
  moveHistory: [] as [],
  stateVersion: 0,
  resetEpoch: 2,
  message: "Message text is not authoritative.",
};

function chessReset(): ChessSnapshot {
  const chess = new Chess();
  const legalMoves = chess.moves({ verbose: true }).map(move => `${move.from}${move.to}${move.promotion ?? ""}`).sort();
  const board: ChessSnapshot["board"] = [];
  for (let rank = 8; rank >= 1; rank -= 1) for (const file of "abcdefgh") {
    const square = `${file}${rank}` as ChessSquare;
    const piece = chess.get(square as Square);
    board.push(piece === undefined ? { square } : { square, color: piece.color === "w" ? "white" : "black", piece: piece.type });
  }
  return { ...base, kind: "chess", turn: "white", legalMoves, board };
}

const GO_COLUMNS = "ABCDEFGHJKLMNOPQRST";
function allGoMoves(size: GoBoardSize): string[] {
  const moves: string[] = [];
  for (let rank = 1; rank <= size; rank += 1) for (let column = 0; column < size; column += 1) moves.push(`${GO_COLUMNS[column]}${rank}`);
  return [...moves.sort(), "pass"];
}
function emptyGoBoard(size: GoBoardSize): GoSnapshot["board"] {
  return Array.from({ length: size }, () => Array<"black" | "white" | null>(size).fill(null));
}
function normalGoReset(size: GoBoardSize = 9): GoSnapshot {
  return { ...base, kind: "go", turn: "black", legalMoves: allGoMoves(size), boardSize: size, board: emptyGoBoard(size), captures: { black: 0, white: 0 }, consecutivePasses: 0 };
}
function importedGoReset(): GoSnapshot {
  const initialPosition: GoPositionSetup = { source: "imported", blackStones: ["D4", "J9"], whiteStones: ["E4", "E5"], turn: "white", captures: { black: 2, white: 3 } };
  const board = emptyGoBoard(9);
  board[5][3] = "black";
  board[0][8] = "black";
  board[5][4] = "white";
  board[4][4] = "white";
  return { ...base, kind: "go", turn: "white", legalMoves: [], boardSize: 9, board, initialPosition, importReview: "pending", captures: { black: 2, white: 3 }, consecutivePasses: 0 };
}
function ticTacToeReset(): TicTacToeSnapshot {
  return { ...base, kind: "tic-tac-toe", turn: "black", legalMoves: ["A1", "A2", "A3", "B1", "B2", "B3", "C1", "C2", "C3"], board: Array.from({ length: 3 }, () => Array<"black" | "white" | null>(3).fill(null)) as Board<3, 3> };
}
function connectFourReset(): ConnectFourSnapshot {
  return { ...base, kind: "connect-four", turn: "black", legalMoves: ["A", "B", "C", "D", "E", "F", "G"], board: Array.from({ length: 6 }, () => Array<"black" | "white" | null>(7).fill(null)) as Board<6, 7> };
}
function reversiReset(): ReversiSnapshot {
  const board = Array.from({ length: 8 }, () => Array<"black" | "white" | null>(8).fill(null)) as Board<8, 8>;
  board[3][3] = "black"; board[3][4] = "white"; board[4][3] = "white"; board[4][4] = "black";
  return { ...base, kind: "reversi", turn: "black", legalMoves: ["C4", "D3", "E6", "F5"], board, score: { black: 2, white: 2 } };
}
function poolReset(): PoolSnapshot {
  return {
    ...base,
    kind: "pool",
    turn: "black",
    legalMoves: ["POT:1:TM", "POT:1:TR", "POT:2:TM", "POT:2:BM", "POT:3:BM", "POT:3:BR", "SAFE:L", "SAFE:C", "SAFE:R", "SAFE:T", "SAFE:B"],
    cueBall: { x: 12, y: 25 },
    balls: [
      { id: 1, group: "solids", x: 32, y: 9 }, { id: 2, group: "solids", x: 36, y: 20 }, { id: 3, group: "solids", x: 34, y: 34 },
      { id: 9, group: "stripes", x: 53, y: 13 }, { id: 10, group: "stripes", x: 54, y: 29 }, { id: 11, group: "stripes", x: 72, y: 18 },
      { id: 8, group: "eight", x: 76, y: 35 },
    ],
  };
}
function basketballReset(): BasketballSnapshot {
  return {
    ...base,
    kind: "basketball",
    turn: "black",
    legalMoves: ["drive", "pull-up", "three"],
    score: { black: 0, white: 0 }, energy: { black: 4, white: 4 }, streak: { black: 0, white: 0 }, attempts: { black: 0, white: 0 },
    phase: "regulation", round: 1,
    shotOptions: [{ move: "drive", points: 2, energyCost: 2, accuracy: 82 }, { move: "pull-up", points: 2, energyCost: 1, accuracy: 66 }, { move: "three", points: 3, energyCost: 0, accuracy: 48 }],
    shotResults: [],
  };
}

function previousFor(reset: GameSnapshot): GameSnapshot {
  return { ...reset, resetEpoch: 1, stateVersion: 7, message: "Played position." } as GameSnapshot;
}

describe("isConfirmedReset", () => {
  it.each([
    ["Chess", chessReset],
    ["imported Go", importedGoReset],
    ["Tic-Tac-Toe", ticTacToeReset],
    ["Connect Four", connectFourReset],
    ["Reversi", reversiReset],
    ["Pool", poolReset],
    ["Basketball", basketballReset],
  ] as const)("accepts the exact canonical %s reset while ignoring message text", (_name, createReset) => {
    const reset = createReset();
    expect(isConfirmedReset(previousFor(reset), { ...reset, message: "A differently worded canonical reset." })).toBe(true);
  });

  it.each([9, 13, 19] as const)("accepts the exact canonical %d-point-side normal Go reset", (boardSize) => {
    const reset = normalGoReset(boardSize);
    expect(reset.legalMoves).toHaveLength(boardSize * boardSize + 1);
    expect(isConfirmedReset(previousFor(reset), reset)).toBe(true);
  });

  it("rejects lifecycle identity changes", () => {
    const reset = chessReset();
    const previous = previousFor(reset);
    expect(isConfirmedReset(previous, { ...reset, gameId: "other" })).toBe(false);
    expect(isConfirmedReset(previous, { ...reset, difficulty: "easy" })).toBe(false);
    expect(isConfirmedReset(previous, { ...reset, resetEpoch: 3 })).toBe(false);
    expect(isConfirmedReset(previous, { ...reset, stateVersion: 1 })).toBe(false);
    expect(isConfirmedReset(previous, { ...reset, status: "finished", finishReason: "ended" })).toBe(false);
    expect(isConfirmedReset(previous, { ...reset, moveHistory: [{ actor: "gpt", color: "white", notation: "e2e4", ply: 1 }] })).toBe(false);
  });

  it("rejects non-canonical Chess turn, board, and legal moves", () => {
    const reset = chessReset();
    const previous = previousFor(reset);
    expect(isConfirmedReset(previous, { ...reset, turn: "black" })).toBe(false);
    expect(isConfirmedReset(previous, { ...reset, board: reset.board.map(cell => cell.square === "a8" ? { ...cell, piece: "q" } : cell) as ChessSnapshot["board"] })).toBe(false);
    expect(isConfirmedReset(previous, { ...reset, legalMoves: [...reset.legalMoves].reverse() })).toBe(false);
  });

  it("rejects non-canonical normal and imported Go resets", () => {
    const normal = normalGoReset();
    const normalPrevious = previousFor(normal);
    const occupied = normal.board.map(row => [...row]); occupied[0][0] = "black";
    expect(isConfirmedReset(normalPrevious, { ...normal, board: occupied })).toBe(false);
    expect(isConfirmedReset(normalPrevious, { ...normal, legalMoves: [...normal.legalMoves.slice(1), normal.legalMoves[0]!] })).toBe(false);
    expect(isConfirmedReset(normalPrevious, { ...normal, captures: { black: 1, white: 0 } })).toBe(false);
    expect(isConfirmedReset(normalPrevious, { ...normal, score: { black: 0, white: 6.5, komi: 6.5 } })).toBe(false);

    const imported = importedGoReset();
    const importedPrevious = previousFor(imported);
    const wrongBoard = imported.board.map(row => [...row]); wrongBoard[0][8] = null;
    expect(isConfirmedReset(importedPrevious, { ...imported, board: wrongBoard })).toBe(false);
    expect(isConfirmedReset(importedPrevious, { ...imported, initialPosition: { ...imported.initialPosition!, blackStones: [...imported.initialPosition!.blackStones].reverse() } })).toBe(false);
    expect(isConfirmedReset(importedPrevious, { ...imported, importReview: "confirmed" })).toBe(false);
    expect(isConfirmedReset(importedPrevious, { ...imported, legalMoves: ["A1"] })).toBe(false);
  });

  it("rejects non-canonical grid-game openings", () => {
    const tic = ticTacToeReset();
    const ticBoard = tic.board.map(row => [...row]) as Board<3, 3>; ticBoard[0][0] = "black";
    expect(isConfirmedReset(previousFor(tic), { ...tic, board: ticBoard })).toBe(false);
    expect(isConfirmedReset(previousFor(tic), { ...tic, winningLine: ["A1", "B2", "C3"] })).toBe(false);

    const connect = connectFourReset();
    const connectBoard = connect.board.map(row => [...row]) as Board<6, 7>; connectBoard[5][0] = "black";
    expect(isConfirmedReset(previousFor(connect), { ...connect, board: connectBoard })).toBe(false);
    expect(isConfirmedReset(previousFor(connect), { ...connect, legalMoves: [...connect.legalMoves].reverse() })).toBe(false);

    const reversi = reversiReset();
    const reversiBoard = reversi.board.map(row => [...row]) as Board<8, 8>; reversiBoard[3][3] = "white";
    expect(isConfirmedReset(previousFor(reversi), { ...reversi, board: reversiBoard })).toBe(false);
    expect(isConfirmedReset(previousFor(reversi), { ...reversi, score: { black: 3, white: 1 } })).toBe(false);
  });

  it("rejects non-canonical sports openings", () => {
    const pool = poolReset();
    expect(isConfirmedReset(previousFor(pool), { ...pool, cueBall: { x: 13, y: 25 } })).toBe(false);
    expect(isConfirmedReset(previousFor(pool), { ...pool, balls: [...pool.balls].reverse() })).toBe(false);
    expect(isConfirmedReset(previousFor(pool), { ...pool, legalMoves: pool.legalMoves.slice(1) })).toBe(false);

    const basketball = basketballReset();
    expect(isConfirmedReset(previousFor(basketball), { ...basketball, energy: { black: 3, white: 4 } })).toBe(false);
    expect(isConfirmedReset(previousFor(basketball), { ...basketball, phase: "overtime" })).toBe(false);
    expect(isConfirmedReset(previousFor(basketball), { ...basketball, shotOptions: basketball.shotOptions.map(option => option.move === "drive" ? { ...option, accuracy: 81 } : option) })).toBe(false);
  });

  it("does not treat object key order as authoritative state", () => {
    const reset = basketballReset();
    const reordered: BasketballSnapshot = {
      ...reset,
      score: { white: 0, black: 0 },
      energy: { white: 4, black: 4 },
      streak: { white: 0, black: 0 },
      attempts: { white: 0, black: 0 },
    };
    expect(isConfirmedReset(previousFor(reset), reordered)).toBe(true);
  });
});
