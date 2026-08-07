import { isSnapshot } from "./game-client";
import { parseWidgetResumeState, resumeStateFromSnapshot, type WidgetResumeState } from "./widget-state";

export const STANDALONE_GAME_SAVE_KEY = "gpt-game-arena:standalone-game";
function browserStorage(): Storage | undefined {
  if (typeof window === "undefined") return;
  try {
    return window.localStorage;
  } catch {
    return;
  }
}

function isLegacyStandaloneGameSave(value: unknown): value is { formatVersion: 1; game: Parameters<typeof resumeStateFromSnapshot>[0] } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as { formatVersion?: unknown; game?: unknown };
  const keys = Object.keys(value);
  return keys.length === 2
    && keys.includes("formatVersion")
    && keys.includes("game")
    && record.formatVersion === 1
    && isSnapshot(record.game);
}

export function loadStandaloneGame(): WidgetResumeState | undefined {
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
    const current = parseWidgetResumeState(candidate);
    if (current) return current;
    if (isLegacyStandaloneGameSave(candidate)) {
      const migrated = resumeStateFromSnapshot(candidate.game);
      try { storage.setItem(STANDALONE_GAME_SAVE_KEY, JSON.stringify(migrated)); } catch { /* Migration remains safe in memory when storage is unavailable. */ }
      return migrated;
    }
  } catch {
    // Remove unreadable JSON below.
  }

  clearStandaloneGame();
  return;
}

export function saveStandaloneGame(state: WidgetResumeState): void {
  const validated = parseWidgetResumeState(state);
  if (!validated) return;
  const storage = browserStorage();
  if (!storage) return;
  try {
    storage.setItem(STANDALONE_GAME_SAVE_KEY, JSON.stringify(validated));
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
