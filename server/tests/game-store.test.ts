import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ChessGame } from "../src/domain/chess-game.js";
import { GameRuleError } from "../src/domain/errors.js";
import {
  DEFAULT_GAME_STORE_TTL_MS,
  DEFAULT_READINESS_CACHE_MS,
  MAX_STALE_TEMP_FILES_TO_CLEAN,
  STALE_TEMP_FILE_TTL_MS,
  GameStore,
} from "../src/game-store.js";

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

  it("keeps state reads side-effect free and does not rewrite persistence", () => {
    let time = 100;
    const persistencePath = temporaryStorePath();
    const store = new GameStore({ persistencePath, now: () => time });
    const session = ChessGame.create("read-only", "white");
    store.put(session);
    const before = readFileSync(persistencePath, "utf8");

    time = 500;
    expect(store.get("read-only")).toBe(session);
    expect(readFileSync(persistencePath, "utf8")).toBe(before);
  });

  it("caches readiness for 15 seconds and coalesces an expired probe", async () => {
    let time = 0;
    const root = mkdtempSync(join(tmpdir(), "gpt-game-arena-readiness-"));
    temporaryDirectories.push(root);
    const storageDirectory = join(root, "storage");
    const persistencePath = join(storageDirectory, "game-sessions.json");
    const store = new GameStore({ persistencePath, now: () => time });

    rmSync(storageDirectory, { recursive: true, force: true });
    writeFileSync(storageDirectory, "blocks directory creation");
    time = DEFAULT_READINESS_CACHE_MS - 1;
    expect(await store.checkReadiness()).toBe(true);

    time = DEFAULT_READINESS_CACHE_MS;
    const firstProbe = store.checkReadiness();
    const concurrentProbe = store.checkReadiness();
    expect(concurrentProbe).toBe(firstProbe);
    expect(await firstProbe).toBe(false);

    rmSync(storageDirectory, { force: true });
    time += 1;
    expect(await store.checkReadiness()).toBe(false);
    time += DEFAULT_READINESS_CACHE_MS;
    expect(await store.checkReadiness()).toBe(true);
  });

  it("does not collide with a leftover legacy primary temporary filename", () => {
    const persistencePath = temporaryStorePath();
    const legacyTemporaryPath = join(
      dirname(persistencePath),
      `.${basename(persistencePath)}.${process.pid}.1.tmp`,
    );
    writeFileSync(legacyTemporaryPath, "left over from an interrupted write");

    const store = new GameStore({ persistencePath });
    store.put(ChessGame.create("collision-resistant", "white"));

    expect(existsSync(legacyTemporaryPath)).toBe(true);
    expect(JSON.parse(readFileSync(persistencePath, "utf8")).sessions).toHaveLength(1);
  });

  it("removes only a bounded number of recognized stale temporary files per pass", () => {
    const persistencePath = temporaryStorePath();
    const directory = dirname(persistencePath);
    const fileName = basename(persistencePath);
    const staleMtime = new Date(Date.now() - STALE_TEMP_FILE_TTL_MS - 1_000);
    const recognizedNames = Array.from(
      { length: MAX_STALE_TEMP_FILES_TO_CLEAN + 8 },
      (_, index) => `.${fileName}.4242.${index + 1}.tmp`,
    );
    for (const name of recognizedNames) {
      const path = join(directory, name);
      writeFileSync(path, "stale");
      utimesSync(path, staleMtime, staleMtime);
    }
    const unrelatedPath = join(directory, `.${fileName}.not-owned.tmp`);
    writeFileSync(unrelatedPath, "do not remove");
    utimesSync(unrelatedPath, staleMtime, staleMtime);

    const store = new GameStore({ persistencePath });
    const afterStartup = readdirSync(directory).filter(name => recognizedNames.includes(name));
    expect(afterStartup).toHaveLength(8);
    expect(existsSync(unrelatedPath)).toBe(true);

    expect(store.sweepExpired()).toBe(0);
    const afterMaintenance = readdirSync(directory).filter(name => recognizedNames.includes(name));
    expect(afterMaintenance).toHaveLength(0);
    expect(existsSync(unrelatedPath)).toBe(true);
  });

  it("cleans stale UUID-named primary, backup, and probe files without broad matching", () => {
    const persistencePath = temporaryStorePath();
    const directory = dirname(persistencePath);
    const fileName = basename(persistencePath);
    const uuid = "00000000-0000-4000-8000-000000000000";
    const recognizedNames = [
      `.${fileName}.4242.${uuid}.store.tmp`,
      `.${fileName}.v1.bak.4242.${uuid}.backup.tmp`,
      `.${fileName}.4242.${uuid}.probe`,
    ];
    const staleMtime = new Date(Date.now() - STALE_TEMP_FILE_TTL_MS - 1_000);
    for (const name of recognizedNames) {
      const path = join(directory, name);
      writeFileSync(path, "stale");
      utimesSync(path, staleMtime, staleMtime);
    }
    const lookalikePath = join(directory, `.${fileName}.4242.${uuid}.unknown.tmp`);
    writeFileSync(lookalikePath, "do not remove");
    utimesSync(lookalikePath, staleMtime, staleMtime);

    new GameStore({ persistencePath });

    for (const name of recognizedNames) expect(existsSync(join(directory, name))).toBe(false);
    expect(existsSync(lookalikePath)).toBe(true);
  });

  it("physically removes expired sessions during a bounded maintenance sweep", () => {
    let time = 0;
    const persistencePath = temporaryStorePath();
    const store = new GameStore({ persistencePath, ttlMs: 1_000, now: () => time });
    store.put(ChessGame.create("expired-on-sweep", "white"));

    time = 1_000;
    expect(store.sweepExpired()).toBe(1);
    expect(JSON.parse(readFileSync(persistencePath, "utf8"))).toEqual({ formatVersion: 2, sessions: [] });
    expectRuleError(() => store.get("expired-on-sweep"), "not_found");
  });

  it("rewrites a persisted store without expired records during startup", () => {
    let time = 0;
    const persistencePath = temporaryStorePath();
    const store = new GameStore({ persistencePath, ttlMs: 1_000, now: () => time });
    store.put(ChessGame.create("expired-on-startup", "white"));

    time = 1_000;
    const restarted = new GameStore({ persistencePath, ttlMs: 1_000, now: () => time });
    expectRuleError(() => restarted.get("expired-on-startup"), "not_found");
    expect(JSON.parse(readFileSync(persistencePath, "utf8"))).toEqual({ formatVersion: 2, sessions: [] });
  });

  it("removes a legacy migration backup after its bounded retention window", () => {
    const persistencePath = temporaryStorePath();
    const legacySource = JSON.stringify({
      formatVersion: 1,
      sessions: [{
        gameId: "legacy-backup",
        kind: "chess",
        playerColor: "white",
        difficulty: "medium",
        events: [],
        lastAccessedAt: Date.now(),
      }],
    });
    writeFileSync(persistencePath, legacySource);
    new GameStore({ persistencePath, legacyBackupTtlMs: 1_000 });
    const backupPath = `${persistencePath}.v1.bak`;
    expect(existsSync(backupPath)).toBe(true);
    expect(readFileSync(backupPath, "utf8")).toBe(legacySource);
    expect(readdirSync(dirname(persistencePath)).some(name => name.endsWith(".backup.tmp"))).toBe(false);
    const expiredMtime = new Date(Date.now() - 2_000);
    utimesSync(backupPath, expiredMtime, expiredMtime);

    new GameStore({ persistencePath, legacyBackupTtlMs: 1_000 });
    expect(existsSync(backupPath)).toBe(false);
  });

  it("fails startup when the configured persistence directory is not writable", () => {
    const persistencePath = temporaryStorePath();
    const directory = dirname(persistencePath);
    chmodSync(directory, 0o500);
    try {
      expect(() => new GameStore({ persistencePath })).toThrow(/not writable/);
    } finally {
      chmodSync(directory, 0o700);
    }
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

  it("expires inactive sessions while retaining recently mutated sessions", () => {
    let time = 0;
    const store = new GameStore({ maxSessions: 2, ttlMs: 1_000, now: () => time });
    const session = ChessGame.create("expiring", "white");

    store.put(session);
    time = 900;
    expect(store.get("expiring")).toBe(session);
    store.replace(session);
    time = 1_500;
    expect(store.get("expiring")).toBe(session);
    time = 1_900;
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
    store.replace(session);

    const refreshedAt = time;
    time = refreshedAt + DEFAULT_GAME_STORE_TTL_MS - 1;
    expect(store.get("long-save")).toBe(session);
    store.replace(session);

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
