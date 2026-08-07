import { isSnapshot } from "./game-client";
import type { Color, GameDifficulty, GameSnapshot, GoBoardSize } from "./types";

export type GamePreset = "chess" | "tic-tac-toe" | "connect-four" | "reversi" | "pool" | "basketball" | `go-${GoBoardSize}`;
export type GameDraft = { game: GamePreset; difficulty: GameDifficulty; side: Color };
export type WidgetResumeState = { formatVersion: 2; activeGameId: string | null; draft: GameDraft };

export const DEFAULT_GAME_DRAFT: GameDraft = { game: "chess", difficulty: "medium", side: "white" };

const presets: readonly GamePreset[] = ["chess", "tic-tac-toe", "connect-four", "reversi", "pool", "basketball", "go-9", "go-13", "go-19"];

function plain(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function validGameId(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 128 && value === value.trim();
}

function isGameDraft(value: unknown): value is GameDraft {
  if (!plain(value) || !exact(value, ["game", "difficulty", "side"])) return false;
  return presets.includes(value.game as GamePreset)
    && (value.difficulty === "easy" || value.difficulty === "medium" || value.difficulty === "hard")
    && (value.side === "white" || value.side === "black");
}

export function parseWidgetResumeState(value: unknown): WidgetResumeState | undefined {
  if (!plain(value) || !exact(value, ["formatVersion", "activeGameId", "draft"])) return;
  if (value.formatVersion !== 2 || (value.activeGameId !== null && !validGameId(value.activeGameId)) || !isGameDraft(value.draft)) return;
  return value as WidgetResumeState;
}

export function draftFromSnapshot(snapshot: GameSnapshot): GameDraft {
  return {
    game: snapshot.kind === "go" ? `go-${snapshot.boardSize}` : snapshot.kind,
    difficulty: snapshot.difficulty,
    side: snapshot.playerColor,
  };
}

export function createWidgetResumeState(activeGameId: string | null, draft: GameDraft = DEFAULT_GAME_DRAFT): WidgetResumeState {
  return { formatVersion: 2, activeGameId, draft };
}

export function resumeStateFromSnapshot(snapshot: GameSnapshot, draft: GameDraft = draftFromSnapshot(snapshot)): WidgetResumeState {
  return createWidgetResumeState(snapshot.gameId, draft);
}

/** Parse current pointer state or extract only safe pointer/UI fields from the old { game } shape. */
export function parseWidgetState(value: unknown): WidgetResumeState | undefined {
  const current = parseWidgetResumeState(value);
  if (current) return current;
  if (!plain(value) || !exact(value, ["game"]) || !isSnapshot(value.game)) return;
  return resumeStateFromSnapshot(value.game);
}
