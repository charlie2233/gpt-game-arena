import { describe, expect, it } from "vitest";

import { parseWidgetState, resumeStateFromSnapshot } from "./widget-state";
import type { ChessSnapshot, ChessSquare, GoSnapshot } from "./types";

function chess(): ChessSnapshot {
  return {
    gameId: "legacy-chess",
    kind: "chess",
    difficulty: "hard",
    playerColor: "white",
    turn: "white",
    status: "active",
    legalMoves: ["e2e4"],
    moveHistory: [],
    stateVersion: 0,
    message: "Cached message must never render.",
    board: Array.from({ length: 8 }, (_, row) => Array.from({ length: 8 }, (_, column) => ({
      square: `${"abcdefgh"[column]}${8 - row}` as ChessSquare,
      ...(row === 6 && column === 4 ? { color: "white" as const, piece: "p" as const } : {}),
    }))).flat() as ChessSnapshot["board"],
  };
}

function legacyGo(): GoSnapshot {
  const boardSize = 13;
  return {
    gameId: "legacy-go",
    kind: "go",
    boardSize,
    difficulty: "easy",
    playerColor: "black",
    turn: "black",
    status: "active",
    legalMoves: ["A13", "pass"],
    moveHistory: [],
    stateVersion: 0,
    message: "Cached Go message.",
    board: Array.from({ length: boardSize }, () => Array<"black" | "white" | null>(boardSize).fill(null)),
    captures: { black: 0, white: 0 },
    consecutivePasses: 0,
  };
}

describe("widget resume state", () => {
  it("round-trips a strict v2 pointer and draft without business state", () => {
    const state = resumeStateFromSnapshot(chess(), { game: "go-19", difficulty: "medium", side: "black" });

    expect(state).toEqual({
      formatVersion: 2,
      activeGameId: "legacy-chess",
      draft: { game: "go-19", difficulty: "medium", side: "black" },
    });
    expect(parseWidgetState(JSON.parse(JSON.stringify(state)))).toEqual(state);
    expect(JSON.stringify(state)).not.toMatch(/board|legalMoves|history|stateVersion|resetEpoch|message/);
  });

  it("migrates only the pointer and safe preferences from a legacy widget snapshot", () => {
    const snapshot = legacyGo();

    expect(parseWidgetState({ game: snapshot })).toEqual({
      formatVersion: 2,
      activeGameId: "legacy-go",
      draft: { game: "go-13", difficulty: "easy", side: "black" },
    });
  });

  it.each([
    undefined,
    null,
    {},
    { formatVersion: 2, activeGameId: "g", draft: { game: "chess", difficulty: "medium", side: "white" }, board: [] },
    { formatVersion: 2, activeGameId: "", draft: { game: "chess", difficulty: "medium", side: "white" } },
    { formatVersion: 2, activeGameId: null, draft: { game: "go-12", difficulty: "medium", side: "white" } },
    { formatVersion: 2, activeGameId: null, draft: { game: "chess", difficulty: "expert", side: "white" } },
    { formatVersion: 2, activeGameId: null, draft: { game: "chess", difficulty: "medium", side: "red" } },
    { formatVersion: 2, activeGameId: null, draft: { game: "chess", difficulty: "medium", side: "white", extra: true } },
    { game: chess(), extra: true },
  ])("strictly rejects malformed widget state %#", (candidate) => {
    expect(parseWidgetState(candidate)).toBeUndefined();
  });
});
