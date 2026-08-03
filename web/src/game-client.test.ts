import { describe, expect, it } from "vitest";
import { isSnapshot } from "./game-client";

const chess = { gameId: "g", kind: "chess", difficulty: "medium", playerColor: "white", turn: "white", status: "active", legalMoves: [], moveHistory: [], stateVersion: 0, message: "ok", board: Array.from({ length: 64 }, (_, i) => ({ square: `${"abcdefgh"[i % 8]}${Math.floor(i / 8) + 1}` })) };
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
});
