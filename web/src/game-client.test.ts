import { describe, expect, it } from "vitest";
import { isSnapshot } from "./game-client";

const chess = { gameId: "g", kind: "chess", playerColor: "white", turn: "white", status: "active", legalMoves: [], moveHistory: [], stateVersion: 0, message: "ok", board: Array.from({ length: 64 }, (_, i) => ({ square: `${"abcdefgh"[i % 8]}${Math.floor(i / 8) + 1}` })) };
describe("authoritative snapshot validation", () => {
  it("rejects shallow malformed host outputs", () => { expect(isSnapshot(chess)).toBe(true); expect(isSnapshot({ ...chess, board: chess.board.slice(1) })).toBe(false); expect(isSnapshot({ ...chess, stateVersion: -1 })).toBe(false); expect(isSnapshot({ ...chess, board: [{ square: "e2", color: "white" }, ...chess.board.slice(1)] })).toBe(false); });
});
