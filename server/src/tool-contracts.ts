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
const captureCountsSchema = z.object({
  black: z.number().int().nonnegative().max(10_000),
  white: z.number().int().nonnegative().max(10_000),
}).strict();

function importGoBranch(boardSize: 9 | 13 | 19, coordinate: RegExp) {
  return z.object({
    boardSize: z.literal(boardSize),
    playerColor: z.enum(["white", "black"]),
    turn: z.enum(["white", "black"]),
    blackStones: z.array(z.string().regex(coordinate)).max(boardSize * boardSize),
    whiteStones: z.array(z.string().regex(coordinate)).max(boardSize * boardSize),
    captures: captureCountsSchema.default({ black: 0, white: 0 }),
    difficulty: difficultySchema.default("medium"),
  }).strict();
}

const importGoPositionSchema = z.discriminatedUnion("boardSize", [
  importGoBranch(9, /^[A-HJ][1-9]$/),
  importGoBranch(13, /^[A-HJ-N](?:[1-9]|1[0-3])$/),
  importGoBranch(19, /^[A-HJ-T](?:[1-9]|1[0-9])$/),
]).superRefine((value, context) => {
  for (const key of ["blackStones", "whiteStones"] as const) {
    if (new Set(value[key]).size !== value[key].length) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: "Stone coordinates must be unique." });
    }
  }
  const black = new Set(value.blackStones);
  if (value.whiteStones.some((coordinate) => black.has(coordinate))) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["whiteStones"], message: "Black and white stones cannot overlap." });
  }
});

/**
 * Keep the model-facing tool catalog compact. Tool results are still validated
 * against the complete strict union in success(), while this common summary
 * avoids repeating an 11KB board union on every registered tool.
 */
export const mcpGameSnapshotSummarySchema = z4.object({
  gameId: z4.string(),
  kind: z4.enum(["chess", "go", "tic-tac-toe", "connect-four", "reversi", "pool", "basketball"]),
  turn: z4.enum(["white", "black"]),
  stateVersion: z4.number().int().nonnegative(),
  resetEpoch: z4.number().int().nonnegative().optional(),
  importReview: z4.enum(["pending", "confirmed"]).optional(),
  legalMoves: z4.array(z4.string()),
}).passthrough();

export const toolInputSchemas = {
  create_game: z.object({
    game: z.enum(["chess", "go", "tic-tac-toe", "connect-four", "reversi", "pool", "basketball"]),
    playerColor: z.enum(["white", "black"]),
    boardSize: goBoardSizeSchema.optional(),
    difficulty: difficultySchema.default("medium"),
  }).strict(),
  import_go_position: importGoPositionSchema,
  confirm_imported_go_position: z.object({
    gameId: boundedString,
    expectedVersion: z.number().int().nonnegative(),
    expectedResetEpoch: z.number().int().nonnegative(),
  }).strict(),
  get_game_state: z.object({ gameId: boundedString }).strict(),
  play_game_move: z.object({
    gameId: boundedString,
    actor: z.enum(["player", "gpt"]),
    move: boundedMoveString,
    expectedVersion: z.number().int().nonnegative(),
    expectedResetEpoch: z.number().int().nonnegative().optional(),
  }).strict(),
  end_game: z.object({
    gameId: boundedString,
    confirmed: z.literal(true),
    expectedVersion: z.number().int().nonnegative(),
    expectedResetEpoch: z.number().int().nonnegative(),
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
  (bridge as unknown as { _zod: { toJSONSchema?: () => unknown } })._zod.toJSONSchema = () => {
    const generated = toJsonSchemaCompat(schema as unknown as AnySchema, { strictUnions: true, pipeStrategy: "output" });
    return typeof generated === "object" && generated !== null && !("type" in generated)
      ? { type: "object", ...generated }
      : generated;
  };
  return bridge;
}

/**
 * MCP validates these generic bridges before handlers run. Their advertised
 * JSON Schemas stay precise while validation failures remain value-agnostic.
 */
export const mcpToolInputSchemas = {
  create_game: mcpInputSchema(toolInputSchemas.create_game),
  import_go_position: mcpInputSchema(toolInputSchemas.import_go_position),
  confirm_imported_go_position: mcpInputSchema(toolInputSchemas.confirm_imported_go_position),
  get_game_state: mcpInputSchema(toolInputSchemas.get_game_state),
  play_game_move: mcpInputSchema(toolInputSchemas.play_game_move),
  end_game: mcpInputSchema(toolInputSchemas.end_game),
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
    case "import_go_position":
      {
        const parsed = toolInputSchemas.import_go_position.parse(input);
        const snapshot = service.importGoPosition(parsed);
        return success(snapshot, `IMPORT_CONFIRMED ${JSON.stringify({
          gameId: snapshot.gameId,
          boardSize: parsed.boardSize,
          playerColor: parsed.playerColor,
          gptColor: parsed.playerColor === "white" ? "black" : "white",
          turn: parsed.turn,
          blackStones: parsed.blackStones.length,
          whiteStones: parsed.whiteStones.length,
          resetEpoch: snapshot.resetEpoch ?? 0,
          stateVersion: snapshot.stateVersion,
        })}`);
      }
    case "confirm_imported_go_position":
      {
        const parsed = toolInputSchemas.confirm_imported_go_position.parse(input);
        const snapshot = service.confirmImportedGoPosition(parsed);
        return success(snapshot, `IMPORT_REVIEW_CONFIRMED ${JSON.stringify({
          gameId: snapshot.gameId,
          resetEpoch: snapshot.resetEpoch ?? 0,
          previousVersion: parsed.expectedVersion,
          stateVersion: snapshot.stateVersion,
          importReview: snapshot.kind === "go" ? snapshot.importReview : undefined,
        })}`);
      }
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
    case "end_game":
      {
        const parsed = toolInputSchemas.end_game.parse(input);
        const snapshot = service.endGame(parsed);
        return success(snapshot, `END_CONFIRMED ${JSON.stringify({
          gameId: snapshot.gameId,
          resetEpoch: snapshot.resetEpoch ?? 0,
          finishReason: snapshot.finishReason,
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

export function toToolFailure(error: GameRuleError, attempt?: "move" | "end" | "import" | "import-review"): ToolFailure {
  const messages: Record<GameRuleError["code"], string> = {
    not_found: "The game was not found.",
    stale_version: "The game has changed; refresh its state before trying again.",
    wrong_actor: "That actor cannot make the next move.",
    illegal_move: "That move is not legal for the current game state.",
    invalid_position: "That imported Go position is not a valid playable board.",
    import_review_required: "Confirm the imported Go position before making a move.",
    import_review_unavailable: "This game does not have an imported Go position awaiting confirmation.",
    game_finished: "The game is already finished.",
  };
  const prefix = attempt === "move"
    ? "MOVE_NOT_APPLIED "
    : attempt === "end"
      ? "END_NOT_APPLIED "
      : attempt === "import"
        ? "IMPORT_NOT_APPLIED "
        : attempt === "import-review"
          ? "IMPORT_REVIEW_NOT_APPLIED "
          : "";
  return { isError: true, content: [{ type: "text", text: `${prefix}${error.code}: ${messages[error.code]}` }] };
}

export function isGameRuleError(error: unknown): error is GameRuleError {
  return error instanceof GameRuleError;
}

function success(snapshot: GameSnapshot, text: string): ToolSuccess {
  return { structuredContent: parseGameSnapshot(snapshot), content: [{ type: "text", text }] };
}
