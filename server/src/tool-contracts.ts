import { z } from "zod";
import { z as z4 } from "zod/v4";
import { toJsonSchemaCompat } from "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js";
import type { AnySchema } from "@modelcontextprotocol/sdk/server/zod-compat.js";

import { GameRuleError } from "./domain/errors.js";
import type { GameSnapshot } from "./domain/types.js";
import { parseGameSnapshot } from "./snapshot-schema.js";
import { ToolService } from "./tool-service.js";

export { gameSnapshotSchema, isToolOutputError, ToolOutputError } from "./snapshot-schema.js";

const boundedString = z.string().trim().min(1).max(128);
const boundedMoveString = z.string().min(1).max(128);
const difficultySchema = z.enum(["easy", "medium", "hard"]);
const goBoardSizeSchema = z.union([z.literal(9), z.literal(13), z.literal(19)]);

/**
 * Keep the model-facing tool catalog compact. Tool results are still validated
 * against the complete strict union in success(), while this common summary
 * avoids repeating an 11KB board union on every registered tool.
 */
export const mcpGameSnapshotSummarySchema = z4.object({
  gameId: z4.string(),
  kind: z4.enum(["chess", "go", "tic-tac-toe", "connect-four", "reversi"]),
  difficulty: z4.enum(["easy", "medium", "hard"]),
  playerColor: z4.enum(["white", "black"]),
  turn: z4.enum(["white", "black"]),
  status: z4.enum(["active", "finished"]),
  stateVersion: z4.number().int().nonnegative(),
  resetEpoch: z4.number().int().nonnegative().optional(),
  legalMoves: z4.array(z4.string()),
  message: z4.string(),
}).passthrough();

export const toolInputSchemas = {
  create_game: z.object({
    game: z.enum(["chess", "go", "tic-tac-toe", "connect-four", "reversi"]),
    playerColor: z.enum(["white", "black"]),
    boardSize: goBoardSizeSchema.optional(),
    difficulty: difficultySchema.default("medium"),
  }).strict(),
  get_game_state: z.object({ gameId: boundedString }).strict(),
  play_game_move: z.object({
    gameId: boundedString,
    actor: z.enum(["player", "gpt"]),
    move: boundedMoveString,
    expectedVersion: z.number().int().nonnegative(),
    expectedResetEpoch: z.number().int().nonnegative().optional(),
  }).strict(),
  reset_game: z.object({ gameId: boundedString }).strict(),
  render_game: z.object({ gameId: boundedString }).strict(),
} as const;

function mcpInputSchema(schema: z.ZodTypeAny) {
  const bridge = z4.object({}).passthrough().superRefine((value, context) => {
    if (!schema.safeParse(value).success) {
      context.addIssue({ code: "custom", message: "Invalid tool input." });
    }
  });
  (bridge as unknown as { _zod: { toJSONSchema?: () => unknown } })._zod.toJSONSchema = () => (
    toJsonSchemaCompat(schema as unknown as AnySchema, { strictUnions: true, pipeStrategy: "output" })
  );
  return bridge;
}

/**
 * MCP validates these generic bridges before handlers run. Their advertised
 * JSON Schemas stay precise while validation failures remain value-agnostic.
 */
export const mcpToolInputSchemas = {
  create_game: mcpInputSchema(toolInputSchemas.create_game),
  get_game_state: mcpInputSchema(toolInputSchemas.get_game_state),
  play_game_move: mcpInputSchema(toolInputSchemas.play_game_move),
  reset_game: mcpInputSchema(toolInputSchemas.reset_game),
  render_game: mcpInputSchema(toolInputSchemas.render_game),
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
      {
        const parsed = toolInputSchemas.play_game_move.parse(input);
        const snapshot = service.playGameMove(parsed);
        return success(snapshot, `MOVE_CONFIRMED ${JSON.stringify({
          gameId: snapshot.gameId,
          resetEpoch: snapshot.resetEpoch ?? 0,
          actor: parsed.actor,
          move: parsed.move,
          previousVersion: parsed.expectedVersion,
          stateVersion: snapshot.stateVersion,
        })}`);
      }
    case "reset_game":
      return success(service.resetGame(toolInputSchemas.reset_game.parse(input)), "Reset game.");
    case "render_game":
      return success(service.getGameState(toolInputSchemas.render_game.parse(input)), "Rendered game.");
  }
}

export function toToolFailure(error: GameRuleError, moveAttempt = false): ToolFailure {
  const messages: Record<GameRuleError["code"], string> = {
    not_found: "The game was not found.",
    stale_version: "The game has changed; refresh its state before trying again.",
    wrong_actor: "That actor cannot make the next move.",
    illegal_move: "That move is not legal for the current game state.",
    game_finished: "The game is already finished.",
  };
  return { isError: true, content: [{ type: "text", text: `${moveAttempt ? "MOVE_NOT_APPLIED " : ""}${error.code}: ${messages[error.code]}` }] };
}

export function isGameRuleError(error: unknown): error is GameRuleError {
  return error instanceof GameRuleError;
}

function success(snapshot: GameSnapshot, text: string): ToolSuccess {
  return { structuredContent: parseGameSnapshot(snapshot), content: [{ type: "text", text }] };
}
