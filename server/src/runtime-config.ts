import {
  DEFAULT_GAME_STORE_MAX_SESSIONS,
  DEFAULT_GAME_STORE_TTL_MS,
  MAX_GAME_STORE_SESSIONS,
  type GameStoreOptions,
} from "./game-store.js";

type Environment = Readonly<Record<string, string | undefined>>;

export type GameStoreRuntimeOptions = Required<Pick<GameStoreOptions, "maxSessions" | "ttlMs">>;

export function gameStoreRuntimeOptionsFromEnvironment(
  environment: Environment = process.env,
): GameStoreRuntimeOptions {
  return {
    ttlMs: positiveSafeInteger(
      "GAME_STORE_TTL_MS",
      environment.GAME_STORE_TTL_MS,
      DEFAULT_GAME_STORE_TTL_MS,
    ),
    maxSessions: positiveSafeInteger(
      "GAME_STORE_MAX_SESSIONS",
      environment.GAME_STORE_MAX_SESSIONS,
      DEFAULT_GAME_STORE_MAX_SESSIONS,
      MAX_GAME_STORE_SESSIONS,
    ),
  };
}

function positiveSafeInteger(
  name: string,
  value: string | undefined,
  fallback: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (value === undefined) return fallback;
  if (!/^[1-9]\d*$/.test(value)) {
    throw new RangeError(`${name} must be a positive integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) {
    throw new RangeError(`${name} must be an integer between 1 and ${maximum}.`);
  }
  return parsed;
}
