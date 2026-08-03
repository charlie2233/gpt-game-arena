import { describe, expect, it } from "vitest";
import { isSnapshot } from "./game-client";

const chess = { gameId: "g", kind: "chess", difficulty: "medium", playerColor: "white", turn: "white", status: "active", legalMoves: [], moveHistory: [], stateVersion: 0, message: "ok", board: Array.from({ length: 64 }, (_, i) => ({ square: `${"abcdefgh"[i % 8]}${Math.floor(i / 8) + 1}` })) };
const base = { gameId: "new", difficulty: "hard", playerColor: "black", turn: "black", status: "active", moveHistory: [], stateVersion: 0, message: "Black to move." } as const;
const tic = () => ({ ...base, kind: "tic-tac-toe" as const, legalMoves: ["A3", "B2"], board: Array.from({ length: 3 }, () => Array<"white" | "black" | null>(3).fill(null)) });
const connect = () => ({ ...base, kind: "connect-four" as const, legalMoves: ["A", "D"], board: Array.from({ length: 6 }, () => Array<"white" | "black" | null>(7).fill(null)) });
const reversi = () => ({ ...base, kind: "reversi" as const, legalMoves: ["C4", "D3"], board: Array.from({ length: 8 }, () => Array<"white" | "black" | null>(8).fill(null)), score: { black: 2, white: 2 } });
describe("authoritative snapshot validation", () => {
  it("rejects shallow malformed host outputs", () => { expect(isSnapshot(chess)).toBe(true); expect(isSnapshot({ ...chess, difficulty: undefined })).toBe(false); expect(isSnapshot({ ...chess, difficulty: "expert" })).toBe(false); expect(isSnapshot({ ...chess, board: chess.board.slice(1) })).toBe(false); expect(isSnapshot({ ...chess, stateVersion: -1 })).toBe(false); expect(isSnapshot({ ...chess, board: [{ square: "e2", color: "white" }, ...chess.board.slice(1)] })).toBe(false); });
  it("accepts supported Go sizes and rejects mismatched or unsupported boards", () => {
    const go = (boardSize: number, rows = boardSize) => ({ gameId: "go", kind: "go", difficulty: "hard", playerColor: "black", turn: "black", status: "active", legalMoves: ["pass"], moveHistory: [], stateVersion: 0, message: "ok", boardSize, board: Array.from({ length: rows }, () => Array.from({ length: boardSize }, () => null)), captures: { black: 0, white: 0 }, consecutivePasses: 0 });
    expect(isSnapshot(go(9))).toBe(true);
    expect(isSnapshot(go(13))).toBe(true);
    expect(isSnapshot(go(19))).toBe(true);
    expect(isSnapshot(go(19, 18))).toBe(false);
    expect(isSnapshot({ ...go(13), board: [Array(12).fill(null), ...go(13).board.slice(1)] })).toBe(false);
    expect(isSnapshot(go(11))).toBe(false);
  });
  it("accepts server-shaped Tic-Tac-Toe, Connect Four, and Reversi snapshots", () => {
    expect(isSnapshot(tic())).toBe(true);
    expect(isSnapshot({ ...tic(), winningLine: ["A3", "B2", "C1"] })).toBe(true);
    expect(isSnapshot(connect())).toBe(true);
    expect(isSnapshot({ ...connect(), winningLine: ["A1", "B1", "C1", "D1"] })).toBe(true);
    expect(isSnapshot({ ...reversi(), moveHistory: [{ actor: "player", color: "black", notation: "C4", ply: 1 }], lastMove: { actor: "player", color: "black", notation: "C4", ply: 1 } })).toBe(true);
  });
  it("rejects malformed dimensions, coordinates, winner lines, and Reversi records", () => {
    expect(isSnapshot({ ...tic(), board: tic().board.slice(1) })).toBe(false);
    expect(isSnapshot({ ...tic(), legalMoves: ["D1"] })).toBe(false);
    expect(isSnapshot({ ...tic(), winningLine: ["A1", "B1"] })).toBe(false);
    expect(isSnapshot({ ...connect(), board: connect().board.map(row => row.slice(1)) })).toBe(false);
    expect(isSnapshot({ ...connect(), legalMoves: ["H"] })).toBe(false);
    expect(isSnapshot({ ...connect(), winningLine: ["A1", "B1", "C1", "D7"] })).toBe(false);
    expect(isSnapshot({ ...reversi(), score: { black: 2.5, white: 2 } })).toBe(false);
    expect(isSnapshot({ ...reversi(), score: { black: -1, white: 2 } })).toBe(false);
    expect(isSnapshot({ ...reversi(), moveHistory: [{ actor: "player", color: "black", notation: "pass", ply: 1 }] })).toBe(false);
    expect(isSnapshot({ ...reversi(), lastMove: { actor: "player", color: "black", notation: "A9", ply: 1 } })).toBe(false);
  });
});
