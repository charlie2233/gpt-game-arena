import { z } from "zod";

import type { GameSnapshot, GoBoardSize } from "./domain/types.js";

const boundedString = z.string().trim().min(1).max(128);
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
  finishReason: z.literal("ended").optional(),
  legalMoves: z.array(z.string()),
  moveHistory: z.array(moveRecordSchema),
  lastMove: moveRecordSchema.optional(),
  stateVersion: z.number().int().nonnegative(),
  resetEpoch: z.number().int().nonnegative().optional(),
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

export class ToolOutputError extends Error {
  constructor() {
    super("Invalid tool output.");
    this.name = "ToolOutputError";
  }
}

export function isToolOutputError(error: unknown): error is ToolOutputError {
  return error instanceof ToolOutputError;
}

export function parseGameSnapshot(snapshot: GameSnapshot): GameSnapshot & Record<string, unknown> {
  const parsed = gameSnapshotSchema.safeParse(snapshot);
  if (!parsed.success) throw new ToolOutputError();
  return parsed.data as GameSnapshot & Record<string, unknown>;
}
