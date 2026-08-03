import { z } from "zod";

import { GameRuleError } from "./domain/errors.js";
import type { GameSnapshot } from "./domain/types.js";
import { ToolService } from "./tool-service.js";

const boundedString = z.string().trim().min(1).max(128);
const moveRecordSchema = z.object({
  actor: z.enum(["player", "gpt"]),
  color: z.enum(["white", "black"]),
  notation: z.string(),
  ply: z.number().int().nonnegative(),
});
const baseSnapshotSchema = z.object({
  gameId: boundedString,
  playerColor: z.enum(["white", "black"]),
  turn: z.enum(["white", "black"]),
  status: z.enum(["active", "finished"]),
  winner: z.enum(["white", "black", "draw"]).optional(),
  legalMoves: z.array(z.string()),
  moveHistory: z.array(moveRecordSchema),
  lastMove: moveRecordSchema.optional(),
  stateVersion: z.number().int().nonnegative(),
  message: z.string(),
});

const chessCellSchema = z.union([
  z.object({
    square: z.string().regex(/^[a-h][1-8]$/),
    color: z.enum(["white", "black"]),
    piece: z.enum(["p", "n", "b", "r", "q", "k"]),
  }),
  z.object({
    square: z.string().regex(/^[a-h][1-8]$/),
  }),
]);

export const gameSnapshotSchema = z.discriminatedUnion("kind", [
  baseSnapshotSchema.extend({ kind: z.literal("chess"), board: z.array(chessCellSchema) }),
  baseSnapshotSchema.extend({
    kind: z.literal("go"),
    board: z.array(z.array(z.enum(["white", "black"]).nullable())),
    boardSize: z.literal(9),
    captures: z.object({ black: z.number().int().nonnegative(), white: z.number().int().nonnegative() }),
    consecutivePasses: z.number().int().nonnegative(),
    score: z.object({ black: z.number(), white: z.number(), komi: z.literal(6.5) }).optional(),
  }),
]);

// MCP tool output schemas must be JSON Schema objects. This object is the
// protocol-compatible form of the discriminated runtime schema above.
export const gameSnapshotOutputSchema = baseSnapshotSchema.extend({
  kind: z.enum(["chess", "go"]),
  board: z.union([
    z.array(chessCellSchema),
    z.array(z.array(z.enum(["white", "black"]).nullable())),
  ]),
  boardSize: z.literal(9).optional(),
  captures: z.object({ black: z.number().int().nonnegative(), white: z.number().int().nonnegative() }).optional(),
  consecutivePasses: z.number().int().nonnegative().optional(),
  score: z.object({ black: z.number(), white: z.number(), komi: z.literal(6.5) }).optional(),
});

export const toolInputSchemas = {
  create_game: z.object({ game: z.enum(["chess", "go"]), playerColor: z.enum(["white", "black"]) }),
  get_game_state: z.object({ gameId: boundedString }),
  play_game_move: z.object({
    gameId: boundedString,
    actor: z.enum(["player", "gpt"]),
    move: boundedString,
    expectedVersion: z.number().int().nonnegative(),
  }),
  reset_game: z.object({ gameId: boundedString }),
  render_game: z.object({ gameId: boundedString }),
} as const;

export type ToolName = keyof typeof toolInputSchemas;
export type ToolSuccess = { structuredContent: GameSnapshot & Record<string, unknown>; content: [{ type: "text"; text: string }] };
export type ToolFailure = { isError: true; content: [{ type: "text"; text: string }] };

export function executeTool(service: ToolService, name: ToolName, input: unknown): ToolSuccess {
  switch (name) {
    case "create_game":
      return success(service.createGame(toolInputSchemas.create_game.parse(input)), "Created game.");
    case "get_game_state":
      return success(service.getGameState(toolInputSchemas.get_game_state.parse(input)), "Retrieved game state.");
    case "play_game_move":
      return success(service.playGameMove(toolInputSchemas.play_game_move.parse(input)), "Played move.");
    case "reset_game":
      return success(service.resetGame(toolInputSchemas.reset_game.parse(input)), "Reset game.");
    case "render_game":
      return success(service.getGameState(toolInputSchemas.render_game.parse(input)), "Rendered game.");
  }
}

export function toToolFailure(error: GameRuleError): ToolFailure {
  const messages: Record<GameRuleError["code"], string> = {
    not_found: "The game was not found.",
    stale_version: "The game has changed; refresh its state before trying again.",
    wrong_actor: "That actor cannot make the next move.",
    illegal_move: "That move is not legal for the current game state.",
    game_finished: "The game is already finished.",
  };
  return { isError: true, content: [{ type: "text", text: `${error.code}: ${messages[error.code]}` }] };
}

export function isGameRuleError(error: unknown): error is GameRuleError {
  return error instanceof GameRuleError;
}

function success(snapshot: GameSnapshot, text: string): ToolSuccess {
  return { structuredContent: snapshot as GameSnapshot & Record<string, unknown>, content: [{ type: "text", text }] };
}
