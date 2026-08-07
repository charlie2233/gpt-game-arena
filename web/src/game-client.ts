import { GameBridge } from "./bridge";
import type { BasketballMove, BasketballSnapshot, Color, GameSnapshot, GoBoardSize, ToolInput, ToolName } from "./types";

export class GameClient {
  constructor(private readonly bridge: GameBridge) {}
  create(input: ToolInput["create_game"]) { return this.call("create_game", input); }
  importGo(input: ToolInput["import_go_position"]) { return this.call("import_go_position", input); }
  confirmImportedGo(gameId: string, expectedVersion: number, expectedResetEpoch: number) { return this.call("confirm_imported_go_position", { gameId, expectedVersion, expectedResetEpoch }); }
  state(gameId: string) { return this.call("get_game_state", { gameId }); }
  play(gameId: string, actor: "player" | "gpt", move: string, expectedVersion: number, expectedResetEpoch?: number) { return this.call("play_game_move", { gameId, actor, move, expectedVersion, ...(expectedResetEpoch === undefined ? {} : { expectedResetEpoch }) }); }
  end(gameId: string, expectedVersion: number, expectedResetEpoch: number) { return this.call("end_game", { gameId, confirmed: true, expectedVersion, expectedResetEpoch }); }
  reset(gameId: string, expectedVersion: number, expectedResetEpoch: number) { return this.call("reset_game", { gameId, confirmed: true, expectedVersion, expectedResetEpoch }); }
  render(gameId: string) { return this.call("render_game", { gameId }); }
  private async call<N extends ToolName>(name: N, input: ToolInput[N]): Promise<GameSnapshot> {
    const output = await this.bridge.callTool(name, input);
    if (output.isError || !isSnapshot(output.structuredContent)) throw new Error(output.content?.[0]?.text || "The game service returned an invalid state.");
    return output.structuredContent;
  }
}
const color = (v: unknown): v is "white" | "black" => v === "white" || v === "black";
const difficulty = (v: unknown): v is "easy" | "medium" | "hard" => v === "easy" || v === "medium" || v === "hard";
const record = (v: unknown): boolean => !!v && typeof v === "object" && (v as { actor?: unknown }).actor !== undefined && (["player", "gpt"].includes((v as { actor: string }).actor)) && color((v as { color: unknown }).color) && typeof (v as { notation?: unknown }).notation === "string" && nonnegative((v as { ply?: unknown }).ply);
const nonnegative = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;
const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const goBoardSize = (v: unknown): v is GoBoardSize => v === 9 || v === 13 || v === 19;
const board = (v: unknown, rows: number, columns: number) => Array.isArray(v) && v.length === rows && v.every(row => Array.isArray(row) && row.length === columns && row.every(cell => cell === null || color(cell)));
const coordinate = (v: unknown, expression: RegExp): v is string => typeof v === "string" && expression.test(v);
const exact = (v: unknown, keys: readonly string[]) => plain(v) && Object.keys(v).every(key => keys.includes(key)) && keys.every(key => key in v || ["resetEpoch", "winner", "finishReason", "lastMove", "score", "winningLine", "initialPosition", "importReview"].includes(key));
const recordExact = (v: unknown) => exact(v, ["actor", "color", "notation", "ply"]) && record(v);
const baseKeys = ["gameId", "resetEpoch", "kind", "difficulty", "playerColor", "turn", "status", "winner", "finishReason", "legalMoves", "moveHistory", "lastMove", "stateVersion", "message"] as const;
function validGoPosition(value: unknown, size: GoBoardSize): boolean {
  if (!plain(value) || !exact(value, ["source", "blackStones", "whiteStones", "turn", "captures"]) || value.source !== "imported" || !color(value.turn)) return false;
  const expression = size === 9 ? /^[A-HJ][1-9]$/ : size === 13 ? /^[A-HJ-N](?:[1-9]|1[0-3])$/ : /^[A-HJ-T](?:[1-9]|1[0-9])$/;
  const blackStones = value.blackStones;
  const whiteStones = value.whiteStones;
  if (!Array.isArray(blackStones) || !Array.isArray(whiteStones) || blackStones.length > size * size || whiteStones.length > size * size || !blackStones.every(stone => coordinate(stone, expression)) || !whiteStones.every(stone => coordinate(stone, expression))) return false;
  const black = new Set(blackStones);
  const white = new Set(whiteStones);
  if (black.size !== blackStones.length || white.size !== whiteStones.length || whiteStones.some(stone => black.has(stone))) return false;
  const captures = value.captures;
  return plain(captures) && exact(captures, ["black", "white"]) && nonnegative(captures.black) && nonnegative(captures.white);
}

const basketballProfiles = {
  drive: { points: 2, energyCost: 2, baseAccuracy: 82 },
  "pull-up": { points: 2, energyCost: 1, baseAccuracy: 66 },
  three: { points: 3, energyCost: 0, baseAccuracy: 48 },
} as const satisfies Record<BasketballMove, { points: 2 | 3; energyCost: 0 | 1 | 2; baseAccuracy: number }>;
const basketballMoveOrder: readonly BasketballMove[] = ["drive", "pull-up", "three"];

function basketballAccuracy(move: BasketballMove, color: Color, streak: Record<Color, number>, previous: Partial<Record<Color, BasketballMove>>): number {
  const profile = basketballProfiles[move];
  return Math.max(20, Math.min(92, profile.baseAccuracy + Math.min(10, streak[color] * 5) - (previous[color] === move ? 12 : 0)));
}

function validBasketballSemantics(value: BasketballSnapshot): boolean {
  if (value.moveHistory.length !== value.shotResults.length) return false;
  const score: Record<Color, number> = { black: 0, white: 0 };
  const energy: Record<Color, number> = { black: 4, white: 4 };
  const streak: Record<Color, number> = { black: 0, white: 0 };
  const attempts: Record<Color, number> = { black: 0, white: 0 };
  const previous: Partial<Record<Color, BasketballMove>> = {};
  let turn: Color = "black";
  let phase: "regulation" | "overtime" = "regulation";
  let naturalWinner: Color | "draw" | undefined;

  for (let index = 0; index < value.shotResults.length; index += 1) {
    const shot = value.shotResults[index]!;
    const history = value.moveHistory[index];
    const profile = basketballProfiles[shot.move];
    if (naturalWinner !== undefined
      || shot.ply !== index + 1
      || shot.color !== turn
      || shot.actor !== (shot.color === value.playerColor ? "player" : "gpt")
      || shot.accuracy !== basketballAccuracy(shot.move, shot.color, streak, previous)
      || shot.points !== (shot.made ? profile.points : 0)
      || history === undefined
      || history.ply !== shot.ply
      || history.actor !== shot.actor
      || history.color !== shot.color
      || history.notation !== shot.move
      || energy[shot.color] < profile.energyCost) return false;

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
    if (completedRound < 5) turn = "black";
    else if (score.black !== score.white) naturalWinner = score.black > score.white ? "black" : "white";
    else if (completedRound >= 8) naturalWinner = "draw";
    else {
      phase = "overtime";
      energy.black = Math.min(4, energy.black + 1);
      energy.white = Math.min(4, energy.white + 1);
      turn = "black";
    }
  }

  for (const side of ["black", "white"] as const) {
    if (value.score[side] !== score[side] || value.energy[side] !== energy[side] || value.streak[side] !== streak[side] || value.attempts[side] !== attempts[side]) return false;
  }
  if (value.turn !== turn || value.phase !== phase) return false;
  const expectedRound = naturalWinner === undefined ? Math.min(8, Math.min(attempts.black, attempts.white) + 1) : Math.max(attempts.black, attempts.white);
  if (value.round !== expectedRound) return false;

  const manuallyEnded = value.finishReason === "ended";
  if (value.status !== (naturalWinner !== undefined || manuallyEnded ? "finished" : "active")
    || value.winner !== naturalWinner
    || (manuallyEnded && naturalWinner !== undefined)
    || value.stateVersion !== value.moveHistory.length + (manuallyEnded ? 1 : 0)) return false;
  const expectedLastMove = value.moveHistory.at(-1);
  if (expectedLastMove === undefined ? value.lastMove !== undefined : value.lastMove === undefined
    || (expectedLastMove !== undefined && value.lastMove !== undefined && (value.lastMove.ply !== expectedLastMove.ply || value.lastMove.actor !== expectedLastMove.actor || value.lastMove.color !== expectedLastMove.color || value.lastMove.notation !== expectedLastMove.notation))) return false;

  const expectedLegalMoves = value.status === "active" ? basketballMoveOrder.filter((move) => energy[turn] >= basketballProfiles[move].energyCost) : [];
  if (value.legalMoves.length !== expectedLegalMoves.length || value.legalMoves.some((move, index) => move !== expectedLegalMoves[index])) return false;
  const expectedOptions = naturalWinner === undefined ? basketballMoveOrder.map((move) => ({ move, ...basketballProfiles[move], accuracy: basketballAccuracy(move, turn, streak, previous) })) : [];
  return value.shotOptions.length === expectedOptions.length && value.shotOptions.every((option, index) => {
    const expected = expectedOptions[index];
    return expected !== undefined && option.move === expected.move && option.points === expected.points && option.energyCost === expected.energyCost && option.accuracy === expected.accuracy;
  });
}
export function isSnapshot(value: unknown): value is GameSnapshot {
  if (!plain(value) || !["chess", "go", "tic-tac-toe", "connect-four", "reversi", "pool", "basketball"].includes(value.kind as string) || typeof value.gameId !== "string" || value.gameId.length < 1 || value.gameId.length > 128 || value.gameId !== value.gameId.trim() || (value.resetEpoch !== undefined && !nonnegative(value.resetEpoch)) || !difficulty(value.difficulty) || !color(value.playerColor) || !color(value.turn) || (value.status !== "active" && value.status !== "finished") || (value.winner !== undefined && !color(value.winner) && value.winner !== "draw") || (value.finishReason !== undefined && (value.finishReason !== "ended" || value.status !== "finished")) || !Array.isArray(value.legalMoves) || !value.legalMoves.every(m => typeof m === "string") || !Array.isArray(value.moveHistory) || !value.moveHistory.every(recordExact) || (value.lastMove !== undefined && !recordExact(value.lastMove)) || !nonnegative(value.stateVersion) || typeof value.message !== "string") return false;
  if (value.kind === "chess") return exact(value, [...baseKeys, "board"]) && Array.isArray(value.board) && value.board.length === 64 && value.board.every(cell => plain(cell) && typeof cell.square === "string" && /^[a-h][1-8]$/.test(cell.square) && ((Object.keys(cell).length === 1) || (Object.keys(cell).length === 3 && color(cell.color) && ["p", "n", "b", "r", "q", "k"].includes(cell.piece as string))));
  const size = value.boardSize;
  if (value.kind === "go") { const captures = value.captures as Record<string, unknown>; const score = value.score as Record<string, unknown> | undefined; const validImportReview = value.initialPosition === undefined ? value.importReview === undefined : value.importReview === "pending" || value.importReview === "confirmed"; return exact(value, [...baseKeys, "board", "boardSize", "initialPosition", "importReview", "captures", "consecutivePasses", "score"]) && goBoardSize(size) && board(value.board, size, size) && (value.initialPosition === undefined || validGoPosition(value.initialPosition, size)) && validImportReview && exact(captures, ["black", "white"]) && nonnegative(captures.black) && nonnegative(captures.white) && nonnegative(value.consecutivePasses) && (score === undefined || (exact(score, ["black", "white", "komi"]) && typeof score.black === "number" && typeof score.white === "number" && score.komi === 6.5)); }
  if (value.kind === "tic-tac-toe") return exact(value, [...baseKeys, "board", "winningLine"]) && board(value.board, 3, 3) && value.legalMoves.every(move => coordinate(move, /^[A-C][1-3]$/)) && value.moveHistory.every(move => coordinate(move.notation, /^[A-C][1-3]$/)) && (value.lastMove === undefined || (plain(value.lastMove) && coordinate(value.lastMove.notation, /^[A-C][1-3]$/))) && (value.winningLine === undefined || Array.isArray(value.winningLine) && value.winningLine.length === 3 && value.winningLine.every(move => coordinate(move, /^[A-C][1-3]$/)));
  if (value.kind === "connect-four") return exact(value, [...baseKeys, "board", "winningLine"]) && board(value.board, 6, 7) && value.legalMoves.every(move => coordinate(move, /^[A-G]$/)) && value.moveHistory.every(move => coordinate(move.notation, /^[A-G]$/)) && (value.lastMove === undefined || (plain(value.lastMove) && coordinate(value.lastMove.notation, /^[A-G]$/))) && (value.winningLine === undefined || Array.isArray(value.winningLine) && value.winningLine.length === 4 && value.winningLine.every(move => coordinate(move, /^[A-G][1-6]$/)));
  if (value.kind === "reversi") { const score = value.score as Record<string, unknown>; return exact(value, [...baseKeys, "board", "score"]) && board(value.board, 8, 8) && value.legalMoves.every(move => coordinate(move, /^[A-H][1-8]$/)) && value.moveHistory.every(move => coordinate(move.notation, /^[A-H][1-8]$/)) && (value.lastMove === undefined || (plain(value.lastMove) && coordinate(value.lastMove.notation, /^[A-H][1-8]$/))) && exact(score, ["black", "white"]) && nonnegative(score.black) && nonnegative(score.white); }
  if (value.kind === "pool") {
    const cueBall = value.cueBall as Record<string, unknown>;
    const poolMove = (move: unknown) => coordinate(move, /^(?:POT:(?:[12389]|10|11):(?:TL|TM|TR|BL|BM|BR)|SAFE:(?:L|C|R|T|B))$/);
    const balls = value.balls;
    return exact(value, [...baseKeys, "cueBall", "balls"])
      && exact(cueBall, ["x", "y"])
      && boundedInteger(cueBall.x, 0, 100)
      && boundedInteger(cueBall.y, 0, 50)
      && Array.isArray(balls)
      && balls.length <= 7
      && balls.every((ball) => plain(ball) && exact(ball, ["id", "group", "x", "y"])
        && [1, 2, 3, 8, 9, 10, 11].includes(ball.id as number)
        && (([1, 2, 3].includes(ball.id as number) && ball.group === "solids") || (ball.id === 8 && ball.group === "eight") || ([9, 10, 11].includes(ball.id as number) && ball.group === "stripes"))
        && boundedInteger(ball.x, 0, 100) && boundedInteger(ball.y, 0, 50))
      && new Set(balls.map((ball) => (ball as { id: number }).id)).size === balls.length
      && value.legalMoves.every(poolMove)
      && value.moveHistory.every((move) => poolMove(move.notation))
      && (value.lastMove === undefined || (plain(value.lastMove) && poolMove(value.lastMove.notation)));
  }
  const basketballMove = (move: unknown) => move === "drive" || move === "pull-up" || move === "three";
  const sideCounts = (counts: unknown, maximum = Number.MAX_SAFE_INTEGER) => plain(counts) && exact(counts, ["black", "white"]) && boundedInteger(counts.black, 0, maximum) && boundedInteger(counts.white, 0, maximum);
  const structurallyValid = exact(value, [...baseKeys, "score", "energy", "streak", "attempts", "phase", "round", "shotOptions", "shotResults"])
    && value.legalMoves.every(basketballMove)
    && value.moveHistory.every((move) => basketballMove(move.notation))
    && (value.lastMove === undefined || (plain(value.lastMove) && basketballMove(value.lastMove.notation)))
    && sideCounts(value.score)
    && sideCounts(value.energy, 4)
    && sideCounts(value.streak, 8)
    && sideCounts(value.attempts, 8)
    && (value.phase === "regulation" || value.phase === "overtime")
    && boundedInteger(value.round, 1, 8)
    && Array.isArray(value.shotOptions)
    && value.shotOptions.length <= 3
    && value.shotOptions.every((option) => plain(option) && exact(option, ["move", "points", "energyCost", "accuracy"]) && basketballMove(option.move) && (option.points === 2 || option.points === 3) && [0, 1, 2].includes(option.energyCost as number) && boundedInteger(option.accuracy, 20, 92))
    && Array.isArray(value.shotResults)
    && value.shotResults.length <= 16
    && value.shotResults.every((shot) => plain(shot) && exact(shot, ["ply", "actor", "color", "move", "made", "points", "accuracy"]) && boundedInteger(shot.ply, 1, 16) && (shot.actor === "player" || shot.actor === "gpt") && color(shot.color) && basketballMove(shot.move) && typeof shot.made === "boolean" && [0, 2, 3].includes(shot.points as number) && boundedInteger(shot.accuracy, 20, 92));
  return structurallyValid && validBasketballSemantics(value as unknown as BasketballSnapshot);
}

function boundedInteger(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isInteger(value) && (value as number) >= minimum && (value as number) <= maximum;
}
