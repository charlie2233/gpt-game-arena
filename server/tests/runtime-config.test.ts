import { describe, expect, it } from "vitest";

import {
  DEFAULT_GAME_STORE_MAX_SESSIONS,
  DEFAULT_GAME_STORE_TTL_MS,
  MAX_GAME_STORE_SESSIONS,
} from "../src/game-store.js";
import { gameStoreRuntimeOptionsFromEnvironment } from "../src/runtime-config.js";

describe("game store runtime configuration", () => {
  it("uses the documented safe defaults when variables are absent", () => {
    expect(gameStoreRuntimeOptionsFromEnvironment({})).toEqual({
      ttlMs: DEFAULT_GAME_STORE_TTL_MS,
      maxSessions: DEFAULT_GAME_STORE_MAX_SESSIONS,
    });
  });

  it("accepts positive bounded integer overrides", () => {
    expect(gameStoreRuntimeOptionsFromEnvironment({
      GAME_STORE_TTL_MS: "604800000",
      GAME_STORE_MAX_SESSIONS: "2500",
    })).toEqual({ ttlMs: 604_800_000, maxSessions: 2_500 });
  });

  it.each(["", "0", "-1", "1.5", " 1000", "1000 ", "1e3", "9007199254740992"])(
    "rejects invalid GAME_STORE_TTL_MS value %j",
    (value) => {
      expect(() => gameStoreRuntimeOptionsFromEnvironment({ GAME_STORE_TTL_MS: value }))
        .toThrow(/GAME_STORE_TTL_MS/);
    },
  );

  it.each(["", "0", "-1", "1.5", " 1000", "1000 ", "1e3", String(MAX_GAME_STORE_SESSIONS + 1)])(
    "rejects invalid GAME_STORE_MAX_SESSIONS value %j",
    (value) => {
      expect(() => gameStoreRuntimeOptionsFromEnvironment({ GAME_STORE_MAX_SESSIONS: value }))
        .toThrow(/GAME_STORE_MAX_SESSIONS/);
    },
  );
});
