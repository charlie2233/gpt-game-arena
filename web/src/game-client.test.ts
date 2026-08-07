import { afterEach, describe, expect, it, vi } from "vitest";
import { GameBridge } from "./bridge";
import { GameClient, isSnapshot } from "./game-client";

const chess = { gameId: "g", kind: "chess", difficulty: "medium", playerColor: "white", turn: "white", status: "active", legalMoves: [], moveHistory: [], stateVersion: 0, message: "ok", board: Array.from({ length: 64 }, (_, i) => ({ square: `${"abcdefgh"[i % 8]}${Math.floor(i / 8) + 1}` })) };
const base = { gameId: "new", difficulty: "hard", playerColor: "black", turn: "black", status: "active", moveHistory: [], stateVersion: 0, message: "Black to move." } as const;
const tic = () => ({ ...base, kind: "tic-tac-toe" as const, legalMoves: ["A3", "B2"], board: Array.from({ length: 3 }, () => Array<"white" | "black" | null>(3).fill(null)) });
const connect = () => ({ ...base, kind: "connect-four" as const, legalMoves: ["A", "D"], board: Array.from({ length: 6 }, () => Array<"white" | "black" | null>(7).fill(null)) });
const reversi = () => ({ ...base, kind: "reversi" as const, legalMoves: ["C4", "D3"], board: Array.from({ length: 8 }, () => Array<"white" | "black" | null>(8).fill(null)), score: { black: 2, white: 2 } });
const pool = () => ({ ...base, kind: "pool" as const, legalMoves: ["POT:1:TM", "SAFE:L"], cueBall: { x: 12, y: 25 }, balls: [{ id: 1, group: "solids", x: 32, y: 9 }, { id: 8, group: "eight", x: 76, y: 35 }] });
const basketball = () => ({ ...base, kind: "basketball" as const, legalMoves: ["drive", "pull-up", "three"], score: { black: 0, white: 0 }, energy: { black: 4, white: 4 }, streak: { black: 0, white: 0 }, attempts: { black: 0, white: 0 }, phase: "regulation", round: 1, shotOptions: [{ move: "drive", points: 2, energyCost: 2, accuracy: 82 }, { move: "pull-up", points: 2, energyCost: 1, accuracy: 66 }, { move: "three", points: 3, energyCost: 0, accuracy: 48 }], shotResults: [] });
const basketballAfterDrive = () => {
  const move = { actor: "player", color: "black", notation: "drive", ply: 1 } as const;
  return { ...basketball(), turn: "white", stateVersion: 1, moveHistory: [move], lastMove: move, score: { black: 2, white: 0 }, energy: { black: 2, white: 4 }, streak: { black: 1, white: 0 }, attempts: { black: 1, white: 0 }, shotResults: [{ actor: "player", color: "black", move: "drive", ply: 1, made: true, points: 2, accuracy: 82 }] } as const;
};
describe("authoritative snapshot validation", () => {
  it("rejects shallow malformed host outputs", () => { expect(isSnapshot(chess)).toBe(true); expect(isSnapshot({ ...chess, difficulty: undefined })).toBe(false); expect(isSnapshot({ ...chess, difficulty: "expert" })).toBe(false); expect(isSnapshot({ ...chess, board: chess.board.slice(1) })).toBe(false); expect(isSnapshot({ ...chess, stateVersion: -1 })).toBe(false); expect(isSnapshot({ ...chess, board: [{ square: "e2", color: "white" }, ...chess.board.slice(1)] })).toBe(false); });
  it("requires a normalized bounded game id", () => { for (const gameId of ["", " ", " g", "g ", "x".repeat(129)]) expect(isSnapshot({ ...chess, gameId })).toBe(false); expect(isSnapshot({ ...chess, gameId: "x".repeat(128) })).toBe(true); });
  it("accepts an optional nonnegative reset epoch", () => { expect(isSnapshot({ ...chess, resetEpoch: 0 })).toBe(true); expect(isSnapshot({ ...chess, resetEpoch: 3 })).toBe(true); expect(isSnapshot({ ...chess, resetEpoch: -1 })).toBe(false); expect(isSnapshot({ ...chess, resetEpoch: 1.5 })).toBe(false); });
  it("accepts only the optional manual-finish field defined by the contract", () => {
    const ended = { ...chess, status: "finished", finishReason: "ended", stateVersion: 1, message: "Game ended." };
    expect(isSnapshot(ended)).toBe(true);
    expect(isSnapshot({ ...chess, finishReason: "ended" })).toBe(false);
    expect(isSnapshot({ ...ended, finishReason: "resignation" })).toBe(false);
    expect(isSnapshot({ ...ended, endedBy: "player" })).toBe(false);
    expect(isSnapshot({ ...ended, unexpectedFinishField: true })).toBe(false);
  });
  it("accepts supported Go sizes and rejects mismatched or unsupported boards", () => {
    const go = (boardSize: number, rows = boardSize) => ({ gameId: "go", kind: "go", difficulty: "hard", playerColor: "black", turn: "black", status: "active", legalMoves: ["pass"], moveHistory: [], stateVersion: 0, message: "ok", boardSize, board: Array.from({ length: rows }, () => Array.from({ length: boardSize }, () => null)), captures: { black: 0, white: 0 }, consecutivePasses: 0 });
    expect(isSnapshot(go(9))).toBe(true);
    expect(isSnapshot(go(13))).toBe(true);
    expect(isSnapshot(go(19))).toBe(true);
    expect(isSnapshot(go(19, 18))).toBe(false);
    expect(isSnapshot({ ...go(13), board: [Array(12).fill(null), ...go(13).board.slice(1)] })).toBe(false);
    expect(isSnapshot(go(11))).toBe(false);
  });
  it("accepts only strict board-sized imported Go metadata", () => {
    const board = Array.from({ length: 9 }, () => Array<"white" | "black" | null>(9).fill(null));
    board[5][3] = "black";
    board[5][4] = "white";
    const imported = { gameId: "photo", kind: "go", difficulty: "hard", playerColor: "white", turn: "white", status: "active", legalMoves: ["A9", "pass"], moveHistory: [], stateVersion: 0, message: "Imported position. White to move.", boardSize: 9, board, captures: { black: 0, white: 0 }, consecutivePasses: 0, importReview: "pending", initialPosition: { source: "imported", blackStones: ["D4"], whiteStones: ["E4"], turn: "white", captures: { black: 0, white: 0 } } };
    expect(isSnapshot(imported)).toBe(true);
    expect(isSnapshot({ ...imported, importReview: "confirmed" })).toBe(true);
    expect(isSnapshot({ ...imported, importReview: undefined })).toBe(false);
    expect(isSnapshot({ ...imported, importReview: "skipped" })).toBe(false);
    expect(isSnapshot({ ...imported, initialPosition: { ...imported.initialPosition, blackStones: ["D4", "D4"] } })).toBe(false);
    expect(isSnapshot({ ...imported, initialPosition: { ...imported.initialPosition, whiteStones: ["D4"] } })).toBe(false);
    expect(isSnapshot({ ...imported, initialPosition: { ...imported.initialPosition, blackStones: ["I4"] } })).toBe(false);
    expect(isSnapshot({ ...imported, initialPosition: { ...imported.initialPosition, blackStones: ["A10"] } })).toBe(false);
    expect(isSnapshot({ ...imported, initialPosition: { ...imported.initialPosition, turn: "secret" } })).toBe(false);
    expect(isSnapshot({ ...imported, initialPosition: { ...imported.initialPosition, captures: { black: -1, white: 0 } } })).toBe(false);
    expect(isSnapshot({ ...imported, initialPosition: { ...imported.initialPosition, extra: "SECRET" } })).toBe(false);
    expect(isSnapshot({ ...chess, initialPosition: imported.initialPosition })).toBe(false);
  });
  it("accepts server-shaped Tic-Tac-Toe, Connect Four, and Reversi snapshots", () => {
    expect(isSnapshot(tic())).toBe(true);
    expect(isSnapshot({ ...tic(), winningLine: ["A3", "B2", "C1"] })).toBe(true);
    expect(isSnapshot(connect())).toBe(true);
    expect(isSnapshot({ ...connect(), winningLine: ["A1", "B1", "C1", "D1"] })).toBe(true);
    expect(isSnapshot({ ...tic(), moveHistory: [{ actor: "player", color: "black", notation: "A1", ply: 1 }], lastMove: { actor: "player", color: "black", notation: "A1", ply: 1 } })).toBe(true);
    expect(isSnapshot({ ...connect(), moveHistory: [{ actor: "player", color: "black", notation: "A", ply: 1 }], lastMove: { actor: "player", color: "black", notation: "A", ply: 1 } })).toBe(true);
    expect(isSnapshot({ ...reversi(), moveHistory: [{ actor: "player", color: "black", notation: "C4", ply: 1 }], lastMove: { actor: "player", color: "black", notation: "C4", ply: 1 } })).toBe(true);
  });
  it("rejects malformed dimensions, coordinates, winner lines, and Reversi records", () => {
    expect(isSnapshot({ ...tic(), board: tic().board.slice(1) })).toBe(false);
    expect(isSnapshot({ ...tic(), legalMoves: ["D1"] })).toBe(false);
    expect(isSnapshot({ ...tic(), winningLine: ["A1", "B1"] })).toBe(false);
    expect(isSnapshot({ ...tic(), moveHistory: [{ actor: "player", color: "black", notation: "a1", ply: 1 }] })).toBe(false);
    expect(isSnapshot({ ...tic(), lastMove: { actor: "player", color: "black", notation: "D1", ply: 1 } })).toBe(false);
    expect(isSnapshot({ ...connect(), board: connect().board.map(row => row.slice(1)) })).toBe(false);
    expect(isSnapshot({ ...connect(), legalMoves: ["H"] })).toBe(false);
    expect(isSnapshot({ ...connect(), winningLine: ["A1", "B1", "C1", "D7"] })).toBe(false);
    expect(isSnapshot({ ...connect(), moveHistory: [{ actor: "player", color: "black", notation: "a", ply: 1 }] })).toBe(false);
    expect(isSnapshot({ ...connect(), lastMove: { actor: "player", color: "black", notation: "H", ply: 1 } })).toBe(false);
    expect(isSnapshot({ ...reversi(), score: { black: 2.5, white: 2 } })).toBe(false);
    expect(isSnapshot({ ...reversi(), score: { black: -1, white: 2 } })).toBe(false);
    expect(isSnapshot({ ...reversi(), moveHistory: [{ actor: "player", color: "black", notation: "pass", ply: 1 }] })).toBe(false);
    expect(isSnapshot({ ...reversi(), lastMove: { actor: "player", color: "black", notation: "A9", ply: 1 } })).toBe(false);
    expect(isSnapshot({ ...tic(), boardSize: 9 })).toBe(false);
    expect(isSnapshot({ ...connect(), score: { black: 1, white: 1 } })).toBe(false);
    expect(isSnapshot({ ...reversi(), winningLine: ["A1", "B1", "C1"] })).toBe(false);
    expect(isSnapshot({ ...reversi(), score: { black: 2, white: 2, extra: true } })).toBe(false);
    expect(isSnapshot({ ...reversi(), moveHistory: [{ actor: "player", color: "black", notation: "C4", ply: 1, extra: true }] })).toBe(false);
  });
  it("accepts strict Pool and Court Duel snapshots and rejects hidden or malformed state", () => {
    expect(isSnapshot(pool())).toBe(true);
    expect(isSnapshot({ ...pool(), legalMoves: ["pot:1:TM"] })).toBe(false);
    expect(isSnapshot({ ...pool(), cueBall: { x: 101, y: 25 } })).toBe(false);
    expect(isSnapshot({ ...pool(), balls: [{ id: 1, group: "stripes", x: 32, y: 9 }] })).toBe(false);
    expect(isSnapshot({ ...pool(), balls: [{ id: 8, group: "eight", x: 70, y: 30 }, { id: 8, group: "eight", x: 76, y: 35 }] })).toBe(false);
    expect(isSnapshot(basketball())).toBe(true);
    expect(isSnapshot({ ...basketball(), legalMoves: ["dunk"] })).toBe(false);
    expect(isSnapshot({ ...basketball(), energy: { black: 5, white: 4 } })).toBe(false);
    expect(isSnapshot({ ...basketball(), shotOptions: [{ move: "three", points: 3, energyCost: 0, accuracy: 93 }] })).toBe(false);
    expect(isSnapshot({ ...basketball(), hiddenRoll: 17 })).toBe(false);
  });
  it("rejects internally inconsistent Court Duel results, totals, options, and phase", () => {
    const opening = basketball();
    const moved = basketballAfterDrive();
    const shot = moved.shotResults[0];
    expect(isSnapshot(moved)).toBe(true);
    expect(isSnapshot({ ...moved, status: "finished", finishReason: "ended", stateVersion: 2, legalMoves: [] })).toBe(true);
    for (const invalid of [
      { ...opening, legalMoves: ["drive"] },
      { ...opening, round: 2 },
      { ...opening, phase: "overtime" },
      { ...opening, shotOptions: [...opening.shotOptions, opening.shotOptions[0]] },
      { ...moved, score: { black: 3, white: 0 } },
      { ...moved, attempts: { black: 0, white: 0 } },
      { ...moved, turn: "black" },
      { ...moved, stateVersion: 2 },
      { ...moved, moveHistory: [{ ...moved.moveHistory[0], notation: "three" }] },
      { ...moved, shotResults: [{ ...shot, made: false, points: 2 }] },
      { ...moved, shotResults: [{ ...shot, accuracy: 83 }] },
      { ...moved, shotOptions: [{ ...moved.shotOptions[0], points: 3 }, ...moved.shotOptions.slice(1)] },
    ]) expect(isSnapshot(invalid)).toBe(false);
  });
});

describe("GameClient end_game", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends an explicit confirmation with the captured version and reset epoch", async () => {
    const ended = { ...chess, status: "finished", finishReason: "ended", stateVersion: 5, message: "Game ended." };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ structuredContent: ended }) } as Response);
    vi.stubGlobal("fetch", fetchMock);
    const client = new GameClient(new GameBridge(window));

    await expect(client.end("g", 4, 2)).resolves.toMatchObject({ status: "finished", finishReason: "ended" });
    expect(fetchMock).toHaveBeenCalledWith("/api/tools/end_game", expect.objectContaining({
      method: "POST",
      body: '{"gameId":"g","confirmed":true,"expectedVersion":4,"expectedResetEpoch":2}',
    }));
  });
});

describe("GameClient imported-position confirmation", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends the authoritative version and reset epoch exactly once", async () => {
    const board = Array.from({ length: 9 }, () => Array<"white" | "black" | null>(9).fill(null));
    const confirmed = { gameId: "photo", kind: "go", difficulty: "hard", playerColor: "white", turn: "white", status: "active", legalMoves: ["A9", "pass"], moveHistory: [], stateVersion: 3, resetEpoch: 4, message: "Imported position. White to move.", boardSize: 9, board, captures: { black: 0, white: 0 }, consecutivePasses: 0, importReview: "confirmed", initialPosition: { source: "imported", blackStones: [], whiteStones: [], turn: "white", captures: { black: 0, white: 0 } } };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ structuredContent: confirmed }) } as Response);
    vi.stubGlobal("fetch", fetchMock);
    const client = new GameClient(new GameBridge(window));

    await expect(client.confirmImportedGo("photo", 2, 4)).resolves.toMatchObject({ importReview: "confirmed", stateVersion: 3 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/tools/confirm_imported_go_position", expect.objectContaining({
      method: "POST",
      body: '{"gameId":"photo","expectedVersion":2,"expectedResetEpoch":4}',
    }));
  });
});
