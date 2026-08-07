import { isAbsolute } from "node:path";

import {
  DEFAULT_GAME_STORE_MAX_SESSIONS,
  DEFAULT_GAME_STORE_TTL_MS,
  MAX_GAME_STORE_SESSIONS,
  type GameStoreOptions,
} from "./game-store.js";

type Environment = Readonly<Record<string, string | undefined>>;

export type GameStoreRuntimeOptions = Required<Pick<GameStoreOptions, "maxSessions" | "ttlMs">>;

export interface PublicAppRuntimeOptions {
  widgetDomain?: string;
  openAiAppsChallengeToken?: string;
}

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

export function publicAppRuntimeOptionsFromEnvironment(
  environment: Environment = process.env,
): PublicAppRuntimeOptions {
  const widgetDomain = optionalHttpsOrigin("PUBLIC_BASE_URL", environment.PUBLIC_BASE_URL);
  if (environment.NODE_ENV === "production" && widgetDomain === undefined) {
    throw new RangeError("PUBLIC_BASE_URL is required when NODE_ENV is production.");
  }
  if (environment.NODE_ENV === "production"
    && (environment.GAME_STORE_PATH === undefined || !isAbsolute(environment.GAME_STORE_PATH))) {
    throw new RangeError("GAME_STORE_PATH must be an absolute path when NODE_ENV is production.");
  }
  return {
    widgetDomain,
    openAiAppsChallengeToken: optionalChallengeToken(
      "OPENAI_APPS_CHALLENGE_TOKEN",
      environment.OPENAI_APPS_CHALLENGE_TOKEN,
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

function optionalHttpsOrigin(name: string, value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new RangeError(`${name} must be an HTTPS origin.`);
  }
  if (
    parsed.protocol !== "https:"
    || parsed.username !== ""
    || parsed.password !== ""
    || parsed.pathname !== "/"
    || parsed.search !== ""
    || parsed.hash !== ""
  ) {
    throw new RangeError(`${name} must be an HTTPS origin.`);
  }
  return parsed.origin;
}

function optionalChallengeToken(name: string, value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (value.length === 0 || value.length > 2_048 || value.trim() !== value || /[\r\n]/.test(value)) {
    throw new RangeError(`${name} must be a non-empty single-line token of at most 2048 characters.`);
  }
  return value;
}
