import { z } from "zod";
import { z as z4 } from "zod/v4";
import { toJsonSchemaCompat } from "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js";
import type { AnySchema } from "@modelcontextprotocol/sdk/server/zod-compat.js";

import { GameRuleError } from "./domain/errors.js";
import type { GameSnapshot, GoBoardSize } from "./domain/types.js";
import { ToolService } from "./tool-service.js";

const boundedString = z.string().trim().min(1).max(128);
const boundedMoveString = z.string().min(1).max(128);
const difficultySchema = z.enum(["easy", "medium", "hard"]);
const moveRecordSchema = z.object({
  actor: z.enum(["player", "gpt"]),
  color: z.enum(["white", "black"]),
  notation: z.string(),
  ply: z.number().int().nonnegative(),
}).strict();
const baseSnapshotSchema = z.object({
  gameId: boundedString,
  difficulty: difficultySchema,
  playerColor: z.enum(["white", "black"]),
  turn: z.enum(["white", "black"]),
  status: z.enum(["active", "finished"]),
  winner: z.enum(["white", "black", "draw"]).optional(),
  legalMoves: z.array(z.string()),
  moveHistory: z.array(moveRecordSchema),
  lastMove: moveRecordSchema.optional(),
  stateVersion: z.number().int().nonnegative(),
  message: z.string(),
}).strict();

const chessCellSchema = z.union([
  z.object({
    square: z.string().regex(/^[a-h][1-8]$/),
    color: z.enum(["white", "black"]),
    piece: z.enum(["p", "n", "b", "r", "q", "k"]),
  }).strict(),
  z.object({
    square: z.string().regex(/^[a-h][1-8]$/),
  }).strict(),
]);

const stoneSchema = z.enum(["white", "black"]).nullable();
const goBoardSizeSchema = z.union([z.literal(9), z.literal(13), z.literal(19)]);
const ticTacToeCoordinateSchema = z.string().regex(/^[A-C][1-3]$/);
const connectFourColumnSchema = z.string().regex(/^[A-G]$/);
const connectFourCoordinateSchema = z.string().regex(/^[A-G][1-6]$/);
const reversiCoordinateSchema = z.string().regex(/^[A-H][1-8]$/);
const reversiMoveRecordSchema = moveRecordSchema.extend({ notation: reversiCoordinateSchema }).strict();
const ticTacToeMoveRecordSchema = moveRecordSchema.extend({ notation: ticTacToeCoordinateSchema }).strict();
const connectFourMoveRecordSchema = moveRecordSchema.extend({ notation: connectFourColumnSchema }).strict();

function goSnapshotSchema(boardSize: GoBoardSize) {
  const rowSchema = z.array(stoneSchema).length(boardSize);
  return baseSnapshotSchema.extend({
    kind: z.literal("go"),
    board: z.array(rowSchema).length(boardSize),
    boardSize: z.literal(boardSize),
    captures: z.object({ black: z.number().int().nonnegative(), white: z.number().int().nonnegative() }).strict(),
    consecutivePasses: z.number().int().nonnegative(),
    score: z.object({ black: z.number(), white: z.number(), komi: z.literal(6.5) }).strict().optional(),
  }).strict();
}

export const gameSnapshotSchema = z.union([
  baseSnapshotSchema.extend({ kind: z.literal("chess"), board: z.array(chessCellSchema) }).strict(),
  goSnapshotSchema(9),
  goSnapshotSchema(13),
  goSnapshotSchema(19),
  baseSnapshotSchema.extend({
    kind: z.literal("tic-tac-toe"),
    board: z.array(z.array(stoneSchema).length(3)).length(3),
    legalMoves: z.array(ticTacToeCoordinateSchema),
    moveHistory: z.array(ticTacToeMoveRecordSchema),
    lastMove: ticTacToeMoveRecordSchema.optional(),
    winningLine: z.tuple([ticTacToeCoordinateSchema, ticTacToeCoordinateSchema, ticTacToeCoordinateSchema]).optional(),
  }).strict(),
  baseSnapshotSchema.extend({
    kind: z.literal("reversi"),
    board: z.array(z.array(stoneSchema).length(8)).length(8),
    legalMoves: z.array(reversiCoordinateSchema),
    moveHistory: z.array(reversiMoveRecordSchema),
    lastMove: reversiMoveRecordSchema.optional(),
    score: z.object({ black: z.number().int().nonnegative(), white: z.number().int().nonnegative() }).strict(),
  }).strict(),
  baseSnapshotSchema.extend({
    kind: z.literal("connect-four"),
    board: z.array(z.array(stoneSchema).length(7)).length(6),
    legalMoves: z.array(connectFourColumnSchema),
    moveHistory: z.array(connectFourMoveRecordSchema),
    lastMove: connectFourMoveRecordSchema.optional(),
    winningLine: z.tuple([connectFourCoordinateSchema, connectFourCoordinateSchema, connectFourCoordinateSchema, connectFourCoordinateSchema]).optional(),
  }).strict(),
]);

const generatedSnapshotSchema = toJsonSchemaCompat(
  gameSnapshotSchema as unknown as AnySchema,
  { strictUnions: true, pipeStrategy: "output" },
) as { anyOf?: unknown[]; [key: string]: unknown };
const publishedSnapshotSchemaJson = JSON.parse(
  JSON.stringify(generatedSnapshotSchema).replaceAll("#/anyOf/", "#/oneOf/"),
) as { anyOf?: unknown[]; [key: string]: unknown };
export const publishedGameSnapshotSchema = {
  ...publishedSnapshotSchemaJson,
  type: "object",
  oneOf: publishedSnapshotSchemaJson.anyOf,
  anyOf: undefined,
};

/**
 * The installed MCP SDK only calls its JSON Schema converter for object Zod
 * schemas. This object bridge validates with the actual discriminated union
 * above and supplies that union's generated JSON Schema to the SDK converter.
 */
export const mcpGameSnapshotSchema = z4.object({}).passthrough().superRefine((value, context) => {
  const parsed = gameSnapshotSchema.safeParse(value);
  if (!parsed.success) {
    context.addIssue({ code: "custom", message: "Invalid game snapshot." });
  }
});
(mcpGameSnapshotSchema as unknown as { _zod: { toJSONSchema?: () => unknown } })._zod.toJSONSchema = () => ({
  ...publishedGameSnapshotSchema,
  oneOf: [...(publishedGameSnapshotSchema.oneOf ?? [])],
});

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

export class ToolOutputError extends Error {
  constructor() {
    super("Invalid tool output.");
    this.name = "ToolOutputError";
  }
}

export function isToolOutputError(error: unknown): error is ToolOutputError {
  return error instanceof ToolOutputError;
}

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
  const parsed = gameSnapshotSchema.safeParse(snapshot);
  if (!parsed.success) throw new ToolOutputError();
  return { structuredContent: parsed.data as GameSnapshot & Record<string, unknown>, content: [{ type: "text", text }] };
}
