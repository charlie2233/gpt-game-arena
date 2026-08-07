import { z } from "zod";

import type { BasketballGameSnapshot, BasketballMove, GameSnapshot, GoBoardSize, StoneColor } from "./domain/types.js";

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
const poolMoveSchema = z.string().regex(/^(?:POT:(?:[12389]|10|11):(?:TL|TM|TR|BL|BM|BR)|SAFE:(?:L|C|R|T|B))$/);
const basketballMoveSchema = z.enum(["drive", "pull-up", "three"]);
const reversiMoveRecordSchema = moveRecordSchema.extend({ notation: reversiCoordinateSchema }).strict();
const ticTacToeMoveRecordSchema = moveRecordSchema.extend({ notation: ticTacToeCoordinateSchema }).strict();
const connectFourMoveRecordSchema = moveRecordSchema.extend({ notation: connectFourColumnSchema }).strict();
const poolMoveRecordSchema = moveRecordSchema.extend({ notation: poolMoveSchema }).strict();
const basketballMoveRecordSchema = moveRecordSchema.extend({ notation: basketballMoveSchema }).strict();
const sideCountsSchema = z.object({
  black: z.number().int().nonnegative(),
  white: z.number().int().nonnegative(),
}).strict();

const basketballProfiles = {
  drive: { points: 2, energyCost: 2, baseAccuracy: 82 },
  "pull-up": { points: 2, energyCost: 1, baseAccuracy: 66 },
  three: { points: 3, energyCost: 0, baseAccuracy: 48 },
} as const satisfies Record<BasketballMove, { points: 2 | 3; energyCost: 0 | 1 | 2; baseAccuracy: number }>;
const basketballMoveOrder: readonly BasketballMove[] = ["drive", "pull-up", "three"];

function basketballAccuracy(move: BasketballMove, color: StoneColor, streak: Record<StoneColor, number>, previous: Partial<Record<StoneColor, BasketballMove>>): number {
  const profile = basketballProfiles[move];
  const repeatPenalty = previous[color] === move ? 12 : 0;
  const streakBonus = Math.min(10, streak[color] * 5);
  return Math.max(20, Math.min(92, profile.baseAccuracy + streakBonus - repeatPenalty));
}

function validateBasketballSnapshot(value: BasketballGameSnapshot, context: z.RefinementCtx): void {
  const issue = (path: (string | number)[], message: string) => context.addIssue({ code: z.ZodIssueCode.custom, path, message });
  if (value.moveHistory.length !== value.shotResults.length) issue(["shotResults"], "Court Duel shots must match move history one-for-one.");

  const score: Record<StoneColor, number> = { black: 0, white: 0 };
  const energy: Record<StoneColor, number> = { black: 4, white: 4 };
  const streak: Record<StoneColor, number> = { black: 0, white: 0 };
  const attempts: Record<StoneColor, number> = { black: 0, white: 0 };
  const previous: Partial<Record<StoneColor, BasketballMove>> = {};
  let turn: StoneColor = "black";
  let phase: "regulation" | "overtime" = "regulation";
  let naturalWinner: StoneColor | "draw" | undefined;

  for (let index = 0; index < value.shotResults.length; index += 1) {
    const shot = value.shotResults[index]!;
    const history = value.moveHistory[index];
    const expectedPly = index + 1;
    const expectedActor = shot.color === value.playerColor ? "player" : "gpt";
    const profile = basketballProfiles[shot.move];
    const expectedAccuracy = basketballAccuracy(shot.move, shot.color, streak, previous);

    if (naturalWinner !== undefined) issue(["shotResults", index], "Court Duel cannot contain shots after its natural finish.");
    if (shot.ply !== expectedPly) issue(["shotResults", index, "ply"], "Court Duel shot plies must be consecutive.");
    if (shot.color !== turn) issue(["shotResults", index, "color"], "Court Duel shots must alternate Black then White.");
    if (shot.actor !== expectedActor) issue(["shotResults", index, "actor"], "Court Duel shot actor does not own that color.");
    if (shot.accuracy !== expectedAccuracy) issue(["shotResults", index, "accuracy"], "Court Duel recorded accuracy is inconsistent with prior shots.");
    if (shot.points !== (shot.made ? profile.points : 0)) issue(["shotResults", index, "points"], "Court Duel made and points fields are inconsistent.");
    if (history === undefined || history.ply !== shot.ply || history.actor !== shot.actor || history.color !== shot.color || history.notation !== shot.move) {
      issue(["moveHistory", index], "Court Duel move history does not match its shot result.");
    }
    if (energy[shot.color] < profile.energyCost) issue(["shotResults", index, "move"], "Court Duel shot spends unavailable energy.");

    energy[shot.color] -= profile.energyCost;
    attempts[shot.color] += 1;
    score[shot.color] += shot.made ? profile.points : 0;
    streak[shot.color] = shot.made ? streak[shot.color] + 1 : 0;
    previous[shot.color] = shot.move;

    if (shot.color === "black") {
      turn = "white";
      continue;
    }
    const completedRound = attempts.white;
    if (completedRound < 5) {
      turn = "black";
    } else if (score.black !== score.white) {
      naturalWinner = score.black > score.white ? "black" : "white";
    } else if (completedRound >= 8) {
      naturalWinner = "draw";
    } else {
      phase = "overtime";
      energy.black = Math.min(4, energy.black + 1);
      energy.white = Math.min(4, energy.white + 1);
      turn = "black";
    }
  }

  for (const color of ["black", "white"] as const) {
    if (value.score[color] !== score[color]) issue(["score", color], "Court Duel score does not equal made shot points.");
    if (value.energy[color] !== energy[color]) issue(["energy", color], "Court Duel energy is inconsistent with shot costs and overtime refills.");
    if (value.streak[color] !== streak[color]) issue(["streak", color], "Court Duel streak is inconsistent with shot results.");
    if (value.attempts[color] !== attempts[color]) issue(["attempts", color], "Court Duel attempts do not equal recorded shots.");
  }
  if (value.turn !== turn) issue(["turn"], "Court Duel turn is inconsistent with recorded attempts.");
  if (value.phase !== phase) issue(["phase"], "Court Duel phase is inconsistent with completed rounds.");
  const expectedRound = naturalWinner === undefined ? Math.min(8, Math.min(attempts.black, attempts.white) + 1) : Math.max(attempts.black, attempts.white);
  if (value.round !== expectedRound) issue(["round"], "Court Duel round is inconsistent with recorded attempts.");

  const manuallyEnded = value.finishReason === "ended";
  const expectedStatus = naturalWinner !== undefined || manuallyEnded ? "finished" : "active";
  if (value.status !== expectedStatus) issue(["status"], "Court Duel finish state is inconsistent with its shots.");
  if (value.winner !== naturalWinner) issue(["winner"], "Court Duel winner is inconsistent with the final score.");
  if (manuallyEnded && naturalWinner !== undefined) issue(["finishReason"], "A naturally finished Court Duel cannot also be manually ended.");
  const expectedVersion = value.moveHistory.length + (manuallyEnded ? 1 : 0);
  if (value.stateVersion !== expectedVersion) issue(["stateVersion"], "Court Duel version must match its authoritative events.");

  const expectedLastMove = value.moveHistory.at(-1);
  if (expectedLastMove === undefined ? value.lastMove !== undefined : value.lastMove === undefined
    || (expectedLastMove !== undefined && value.lastMove !== undefined && (value.lastMove.ply !== expectedLastMove.ply || value.lastMove.actor !== expectedLastMove.actor || value.lastMove.color !== expectedLastMove.color || value.lastMove.notation !== expectedLastMove.notation))) {
    issue(["lastMove"], "Court Duel last move must match the final history record.");
  }

  const expectedLegalMoves = expectedStatus === "active"
    ? basketballMoveOrder.filter((move) => energy[turn] >= basketballProfiles[move].energyCost)
    : [];
  if (value.legalMoves.length !== expectedLegalMoves.length || value.legalMoves.some((move, index) => move !== expectedLegalMoves[index])) {
    issue(["legalMoves"], "Court Duel legal moves are inconsistent with status and energy.");
  }

  const expectedOptions = naturalWinner === undefined
    ? basketballMoveOrder.map((move) => ({
      move,
      points: basketballProfiles[move].points,
      energyCost: basketballProfiles[move].energyCost,
      accuracy: basketballAccuracy(move, turn, streak, previous),
    }))
    : [];
  if (value.shotOptions.length !== expectedOptions.length || value.shotOptions.some((option, index) => {
    const expected = expectedOptions[index];
    return expected === undefined || option.move !== expected.move || option.points !== expected.points || option.energyCost !== expected.energyCost || option.accuracy !== expected.accuracy;
  })) {
    issue(["shotOptions"], "Court Duel shot options are duplicated, incomplete, or inconsistent with public state.");
  }
}

function goSnapshotSchema(boardSize: GoBoardSize) {
  const rowSchema = z.array(stoneSchema).length(boardSize);
  const coordinate = boardSize === 9
    ? /^[A-HJ][1-9]$/
    : boardSize === 13
      ? /^[A-HJ-N](?:[1-9]|1[0-3])$/
      : /^[A-HJ-T](?:[1-9]|1[0-9])$/;
  const initialPositionSchema = z.object({
    source: z.literal("imported"),
    blackStones: z.array(z.string().regex(coordinate)).max(boardSize * boardSize),
    whiteStones: z.array(z.string().regex(coordinate)).max(boardSize * boardSize),
    turn: z.enum(["black", "white"]),
    captures: z.object({ black: z.number().int().nonnegative(), white: z.number().int().nonnegative() }).strict(),
  }).strict().superRefine((value, context) => {
    if (new Set(value.blackStones).size !== value.blackStones.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["blackStones"], message: "Black stones must be unique." });
    }
    if (new Set(value.whiteStones).size !== value.whiteStones.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["whiteStones"], message: "White stones must be unique." });
    }
    const black = new Set(value.blackStones);
    if (value.whiteStones.some((stone) => black.has(stone))) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["whiteStones"], message: "Stone colors cannot overlap." });
    }
  });
  return baseSnapshotSchema.extend({
    kind: z.literal("go"),
    board: z.array(rowSchema).length(boardSize),
    boardSize: z.literal(boardSize),
    initialPosition: initialPositionSchema.optional(),
    importReview: z.enum(["pending", "confirmed"]).optional(),
    captures: z.object({ black: z.number().int().nonnegative(), white: z.number().int().nonnegative() }).strict(),
    consecutivePasses: z.number().int().nonnegative(),
    score: z.object({ black: z.number(), white: z.number(), komi: z.literal(6.5) }).strict().optional(),
  }).strict().superRefine((value, context) => {
    if ((value.initialPosition === undefined) !== (value.importReview === undefined)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [value.initialPosition === undefined ? "importReview" : "initialPosition"],
        message: "Imported Go position and review state must be present together.",
      });
    }
  });
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
  baseSnapshotSchema.extend({
    kind: z.literal("pool"),
    cueBall: z.object({
      x: z.number().int().min(0).max(100),
      y: z.number().int().min(0).max(50),
    }).strict(),
    balls: z.array(z.object({
      id: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(8), z.literal(9), z.literal(10), z.literal(11)]),
      group: z.enum(["solids", "stripes", "eight"]),
      x: z.number().int().min(0).max(100),
      y: z.number().int().min(0).max(50),
    }).strict()).max(7).superRefine((balls, context) => {
      if (new Set(balls.map((ball) => ball.id)).size !== balls.length) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "Pool ball IDs must be unique." });
      }
      for (const [index, ball] of balls.entries()) {
        const expectedGroup = ball.id === 8 ? "eight" : ball.id <= 3 ? "solids" : "stripes";
        if (ball.group !== expectedGroup) {
          context.addIssue({ code: z.ZodIssueCode.custom, path: [index, "group"], message: "Pool ball group does not match its ID." });
        }
      }
    }),
    legalMoves: z.array(poolMoveSchema),
    moveHistory: z.array(poolMoveRecordSchema),
    lastMove: poolMoveRecordSchema.optional(),
  }).strict(),
  baseSnapshotSchema.extend({
    kind: z.literal("basketball"),
    legalMoves: z.array(basketballMoveSchema),
    moveHistory: z.array(basketballMoveRecordSchema),
    lastMove: basketballMoveRecordSchema.optional(),
    score: sideCountsSchema,
    energy: z.object({
      black: z.number().int().min(0).max(4),
      white: z.number().int().min(0).max(4),
    }).strict(),
    streak: z.object({
      black: z.number().int().min(0).max(8),
      white: z.number().int().min(0).max(8),
    }).strict(),
    attempts: z.object({
      black: z.number().int().min(0).max(8),
      white: z.number().int().min(0).max(8),
    }).strict(),
    phase: z.enum(["regulation", "overtime"]),
    round: z.number().int().min(1).max(8),
    shotOptions: z.array(z.object({
      move: basketballMoveSchema,
      points: z.union([z.literal(2), z.literal(3)]),
      energyCost: z.union([z.literal(0), z.literal(1), z.literal(2)]),
      accuracy: z.number().int().min(20).max(92),
    }).strict()).max(3),
    shotResults: z.array(z.object({
      ply: z.number().int().positive(),
      actor: z.enum(["player", "gpt"]),
      color: z.enum(["white", "black"]),
      move: basketballMoveSchema,
      made: z.boolean(),
      points: z.union([z.literal(0), z.literal(2), z.literal(3)]),
      accuracy: z.number().int().min(20).max(92),
    }).strict()).max(16),
  }).strict().superRefine((value, context) => validateBasketballSnapshot(value, context)),
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
