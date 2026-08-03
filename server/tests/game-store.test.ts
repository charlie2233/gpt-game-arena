import { describe, expect, it } from "vitest";

import { ChessGame } from "../src/domain/chess-game.js";
import { GameRuleError } from "../src/domain/errors.js";
import { GameStore } from "../src/game-store.js";

function expectRuleError(action: () => unknown, code: GameRuleError["code"]): void {
  let error: unknown;
  try {
    action();
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(GameRuleError);
  expect((error as GameRuleError).code).toBe(code);
}

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

  it("evicts the least recently used session when capacity is exceeded", () => {
    const store = new GameStore({ maxSessions: 2 });
    const a = ChessGame.create("a", "white");
    const b = ChessGame.create("b", "white");
    const c = ChessGame.create("c", "white");

    store.put(a);
    store.put(b);
    expect(store.get("a")).toBe(a);
    store.put(c);

    expect(store.get("a")).toBe(a);
    expect(store.get("c")).toBe(c);
    expectRuleError(() => store.get("b"), "not_found");
  });

  it("prunes expired sessions while retaining recently accessed sessions", () => {
    let time = 0;
    const store = new GameStore({ maxSessions: 2, ttlMs: 1_000, now: () => time });
    const session = ChessGame.create("expiring", "white");

    store.put(session);
    time = 900;
    expect(store.get("expiring")).toBe(session);
    time = 1_500;
    expect(store.get("expiring")).toBe(session);
    time = 2_501;
    expectRuleError(() => store.get("expiring"), "not_found");
    expectRuleError(() => store.replace(ChessGame.create("expiring", "black")), "not_found");
  });

  it("replaces by authoritative ID without exceeding capacity", () => {
    let time = 0;
    const store = new GameStore({ maxSessions: 2, now: () => time });
    const a = ChessGame.create("a", "white");
    const b = ChessGame.create("b", "white");
    const replacement = ChessGame.create("a", "black");

    store.put(a);
    time += 1;
    store.put(b);
    time += 1;
    store.replace(replacement);
    time += 1;
    store.put(ChessGame.create("c", "white"));

    expect(store.get("a")).toBe(replacement);
    expectRuleError(() => store.get("b"), "not_found");
    expect(store.get("c").snapshot().gameId).toBe("c");
  });
});
