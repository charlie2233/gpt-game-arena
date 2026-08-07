// @vitest-environment node

import { describe, expect, it } from "vitest";

import { GameStore } from "../../server/src/game-store";
import { ToolService } from "../../server/src/tool-service";
import { isSnapshot } from "./game-client";
import { isConfirmedReset } from "./reset-validation";
import type { GameSnapshot, GoBoardSize } from "./types";

function asWebSnapshot(value: unknown): GameSnapshot {
  expect(isSnapshot(value)).toBe(true);
  if (!isSnapshot(value)) throw new Error("The server returned a snapshot outside the web contract.");
  return value;
}

function reset(service: ToolService, previous: GameSnapshot): GameSnapshot {
  const next = asWebSnapshot(service.resetGame({
    gameId: previous.gameId,
    confirmed: true,
    expectedVersion: previous.stateVersion,
    expectedResetEpoch: previous.resetEpoch ?? 0,
  }));
  expect(next.stateVersion).toBe(0);
  expect(next.resetEpoch).toBe((previous.resetEpoch ?? 0) + 1);
  return next;
}

describe("canonical reset server contract", () => {
  it.each(["chess", "tic-tac-toe", "connect-four", "reversi", "pool", "basketball"] as const)("accepts the actual %s ToolService reset", (game) => {
    const service = new ToolService(new GameStore());
    const previous = asWebSnapshot(service.createGame({ game, playerColor: game === "chess" ? "white" : "black", difficulty: "hard" }));
    expect(isConfirmedReset(previous, reset(service, previous))).toBe(true);
  });

  it.each([9, 13, 19] as const)("accepts the actual %d-point-side Go ToolService reset", (boardSize: GoBoardSize) => {
    const service = new ToolService(new GameStore());
    const previous = asWebSnapshot(service.createGame({ game: "go", playerColor: "black", difficulty: "hard", boardSize }));
    expect(isConfirmedReset(previous, reset(service, previous))).toBe(true);
  });

  it("accepts the actual imported Go ToolService reset", () => {
    const service = new ToolService(new GameStore());
    const previous = asWebSnapshot(service.importGoPosition({
      boardSize: 13,
      playerColor: "white",
      turn: "white",
      blackStones: ["N13", "D4"],
      whiteStones: ["E4", "E5"],
      captures: { black: 2, white: 3 },
      difficulty: "hard",
    }));
    expect(isConfirmedReset(previous, reset(service, previous))).toBe(true);
  });
});
