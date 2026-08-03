import { describe, expect, it } from "vitest";

import { ChessGame } from "../src/domain/chess-game.js";
import { GameRuleError } from "../src/domain/errors.js";
import { GameStore } from "../src/game-store.js";

describe("GameStore", () => {
  it("stores and replaces sessions by their authoritative snapshot game ID", () => {
    const store = new GameStore();
    const initial = ChessGame.create("match-1", "white");
    const replacement = ChessGame.create("match-1", "black");

    store.put(initial);
    expect(store.get("match-1")).toBe(initial);

    store.replace(replacement);
    expect(store.get("match-1")).toBe(replacement);
  });

  it("throws not_found when getting a missing session", () => {
    const store = new GameStore();
    let error: unknown;

    try {
      store.get("missing");
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(GameRuleError);
    expect((error as GameRuleError).code).toBe("not_found");
  });

  it("throws not_found when replacing a missing authoritative ID", () => {
    const store = new GameStore();
    let error: unknown;

    try {
      store.replace(ChessGame.create("missing", "white"));
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(GameRuleError);
    expect((error as GameRuleError).code).toBe("not_found");
  });
});
