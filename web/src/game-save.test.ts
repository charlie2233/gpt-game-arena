import { afterEach, describe, expect, it, vi } from "vitest";

import { loadStandaloneGame, saveStandaloneGame, STANDALONE_GAME_SAVE_KEY } from "./game-save";
import type { ChessSnapshot, ChessSquare } from "./types";

function chess(): ChessSnapshot {
  return {
    gameId: "saved-chess",
    kind: "chess",
    difficulty: "hard",
    playerColor: "white",
    turn: "white",
    status: "active",
    legalMoves: ["e2e4"],
    moveHistory: [],
    stateVersion: 0,
    message: "White to move.",
    board: Array.from({ length: 8 }, (_, row) => Array.from({ length: 8 }, (_, column) => ({
      square: `${"abcdefgh"[column]}${8 - row}` as ChessSquare,
      ...(row === 6 && column === 4 ? { color: "white" as const, piece: "p" as const } : {}),
    }))).flat() as ChessSnapshot["board"],
  };
}

describe("standalone game save", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("round-trips a strict versioned game snapshot", () => {
    const game = chess();

    saveStandaloneGame(game);

    expect(JSON.parse(window.localStorage.getItem(STANDALONE_GAME_SAVE_KEY)!)).toEqual({
      formatVersion: 1,
      game,
    });
    expect(loadStandaloneGame()).toEqual(game);
  });

  it.each([
    "not json",
    JSON.stringify({ formatVersion: 2, game: chess() }),
    JSON.stringify({ formatVersion: 1, game: { ...chess(), gameId: "" } }),
    JSON.stringify({ formatVersion: 1, game: chess(), extra: true }),
  ])("ignores and removes malformed or unsupported saves", (serialized) => {
    window.localStorage.setItem(STANDALONE_GAME_SAVE_KEY, serialized);

    expect(loadStandaloneGame()).toBeUndefined();
    expect(window.localStorage.getItem(STANDALONE_GAME_SAVE_KEY)).toBeNull();
  });

  it("swallows unavailable storage reads, writes, and cleanup", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("full"); });
    expect(() => saveStandaloneGame(chess())).not.toThrow();
    expect(setItem).toHaveBeenCalled();
    setItem.mockRestore();

    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new DOMException("blocked"); });
    expect(loadStandaloneGame()).toBeUndefined();
    expect(getItem).toHaveBeenCalled();
    getItem.mockRestore();

    window.localStorage.setItem(STANDALONE_GAME_SAVE_KEY, "not json");
    const removeItem = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new DOMException("blocked"); });
    expect(() => loadStandaloneGame()).not.toThrow();
    expect(loadStandaloneGame()).toBeUndefined();
    expect(removeItem).toHaveBeenCalled();
  });
});
