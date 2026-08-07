import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ChessGame } from "../src/domain/chess-game.js";
import { GameRuleError } from "../src/domain/errors.js";
import { DEFAULT_GAME_STORE_TTL_MS, GameStore } from "../src/game-store.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function temporaryStorePath(): string {
  const directory = mkdtempSync(join(tmpdir(), "gpt-game-arena-store-"));
  temporaryDirectories.push(directory);
  return join(directory, "game-sessions.json");
}

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

  it("refuses a new save at capacity without deleting persisted games", () => {
    const persistencePath = temporaryStorePath();
    const store = new GameStore({ maxSessions: 2, persistencePath });
    const a = ChessGame.create("a", "white");
    const b = ChessGame.create("b", "white");
    const c = ChessGame.create("c", "white");

    store.put(a);
    store.put(b);
    expectRuleError(() => store.put(c), "store_full");

    const restarted = new GameStore({ maxSessions: 2, persistencePath });
    expect(restarted.get("a").snapshot()).toEqual(a.snapshot());
    expect(restarted.get("b").snapshot()).toEqual(b.snapshot());
    expectRuleError(() => restarted.get("c"), "not_found");
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

  it("uses a 30-day sliding default TTL and expires at the exact boundary", () => {
    let time = 0;
    const store = new GameStore({ now: () => time });
    const session = ChessGame.create("long-save", "white");

    store.put(session);
    time = DEFAULT_GAME_STORE_TTL_MS - 1;
    expect(store.get("long-save")).toBe(session);

    const refreshedAt = time;
    time = refreshedAt + DEFAULT_GAME_STORE_TTL_MS - 1;
    expect(store.get("long-save")).toBe(session);

    const refreshedAgainAt = time;
    time = refreshedAgainAt + DEFAULT_GAME_STORE_TTL_MS;
    expectRuleError(() => store.get("long-save"), "not_found");
  });

  it("allows an authoritative replacement at capacity but refuses a new ID", () => {
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
    expectRuleError(() => store.put(ChessGame.create("c", "white")), "store_full");

    expect(store.get("a")).toBe(replacement);
    expect(store.get("b")).toBe(b);
    expectRuleError(() => store.get("c"), "not_found");
  });
});
