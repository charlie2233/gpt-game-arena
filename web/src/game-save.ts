import { isSnapshot } from "./game-client";
import type { GameSnapshot } from "./types";

export const STANDALONE_GAME_SAVE_KEY = "gpt-game-arena:standalone-game";
const standaloneGameSaveFormatVersion = 1;

type StandaloneGameSave = {
  formatVersion: typeof standaloneGameSaveFormatVersion;
  game: GameSnapshot;
};

function browserStorage(): Storage | undefined {
  if (typeof window === "undefined") return;
  try {
    return window.localStorage;
  } catch {
    return;
  }
}

function isStandaloneGameSave(value: unknown): value is StandaloneGameSave {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as { formatVersion?: unknown; game?: unknown };
  const keys = Object.keys(value);
  return keys.length === 2
    && keys.includes("formatVersion")
    && keys.includes("game")
    && record.formatVersion === standaloneGameSaveFormatVersion
    && isSnapshot(record.game);
}

export function loadStandaloneGame(): GameSnapshot | undefined {
  const storage = browserStorage();
  if (!storage) return;

  let serialized: string | null;
  try {
    serialized = storage.getItem(STANDALONE_GAME_SAVE_KEY);
  } catch {
    return;
  }
  if (serialized === null) return;

  try {
    const candidate: unknown = JSON.parse(serialized);
    if (isStandaloneGameSave(candidate)) return candidate.game;
  } catch {
    // Remove unreadable JSON below.
  }

  clearStandaloneGame();
  return;
}

export function saveStandaloneGame(game: GameSnapshot): void {
  if (!isSnapshot(game)) return;
  const storage = browserStorage();
  if (!storage) return;
  try {
    storage.setItem(STANDALONE_GAME_SAVE_KEY, JSON.stringify({
      formatVersion: standaloneGameSaveFormatVersion,
      game,
    } satisfies StandaloneGameSave));
  } catch {
    // Storage can be disabled, full, or unavailable in privacy-restricted contexts.
  }
}

export function clearStandaloneGame(): void {
  const storage = browserStorage();
  if (!storage) return;
  try {
    storage.removeItem(STANDALONE_GAME_SAVE_KEY);
  } catch {
    // A failed cleanup must not block gameplay.
  }
}
