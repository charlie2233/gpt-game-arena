import { GameBridge } from "./bridge";
import type { GameSnapshot, GoBoardSize, ToolInput, ToolName } from "./types";

export class GameClient {
  constructor(private readonly bridge: GameBridge) {}
  create(input: ToolInput["create_game"]) { return this.call("create_game", input); }
  importGo(input: ToolInput["import_go_position"]) { return this.call("import_go_position", input); }
  confirmImportedGo(gameId: string, expectedVersion: number, expectedResetEpoch: number) { return this.call("confirm_imported_go_position", { gameId, expectedVersion, expectedResetEpoch }); }
  state(gameId: string) { return this.call("get_game_state", { gameId }); }
  play(gameId: string, actor: "player" | "gpt", move: string, expectedVersion: number, expectedResetEpoch?: number) { return this.call("play_game_move", { gameId, actor, move, expectedVersion, ...(expectedResetEpoch === undefined ? {} : { expectedResetEpoch }) }); }
  end(gameId: string, expectedVersion: number, expectedResetEpoch: number) { return this.call("end_game", { gameId, confirmed: true, expectedVersion, expectedResetEpoch }); }
  reset(gameId: string) { return this.call("reset_game", { gameId }); }
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
export function isSnapshot(value: unknown): value is GameSnapshot {
  if (!plain(value) || !["chess", "go", "tic-tac-toe", "connect-four", "reversi"].includes(value.kind as string) || typeof value.gameId !== "string" || value.gameId.length < 1 || value.gameId.length > 128 || value.gameId !== value.gameId.trim() || (value.resetEpoch !== undefined && !nonnegative(value.resetEpoch)) || !difficulty(value.difficulty) || !color(value.playerColor) || !color(value.turn) || (value.status !== "active" && value.status !== "finished") || (value.winner !== undefined && !color(value.winner) && value.winner !== "draw") || (value.finishReason !== undefined && (value.finishReason !== "ended" || value.status !== "finished")) || !Array.isArray(value.legalMoves) || !value.legalMoves.every(m => typeof m === "string") || !Array.isArray(value.moveHistory) || !value.moveHistory.every(recordExact) || (value.lastMove !== undefined && !recordExact(value.lastMove)) || !nonnegative(value.stateVersion) || typeof value.message !== "string") return false;
  if (value.kind === "chess") return exact(value, [...baseKeys, "board"]) && Array.isArray(value.board) && value.board.length === 64 && value.board.every(cell => plain(cell) && typeof cell.square === "string" && /^[a-h][1-8]$/.test(cell.square) && ((Object.keys(cell).length === 1) || (Object.keys(cell).length === 3 && color(cell.color) && ["p", "n", "b", "r", "q", "k"].includes(cell.piece as string))));
  const size = value.boardSize;
  if (value.kind === "go") { const captures = value.captures as Record<string, unknown>; const score = value.score as Record<string, unknown> | undefined; const validImportReview = value.initialPosition === undefined ? value.importReview === undefined : value.importReview === "pending" || value.importReview === "confirmed"; return exact(value, [...baseKeys, "board", "boardSize", "initialPosition", "importReview", "captures", "consecutivePasses", "score"]) && goBoardSize(size) && board(value.board, size, size) && (value.initialPosition === undefined || validGoPosition(value.initialPosition, size)) && validImportReview && exact(captures, ["black", "white"]) && nonnegative(captures.black) && nonnegative(captures.white) && nonnegative(value.consecutivePasses) && (score === undefined || (exact(score, ["black", "white", "komi"]) && typeof score.black === "number" && typeof score.white === "number" && score.komi === 6.5)); }
  if (value.kind === "tic-tac-toe") return exact(value, [...baseKeys, "board", "winningLine"]) && board(value.board, 3, 3) && value.legalMoves.every(move => coordinate(move, /^[A-C][1-3]$/)) && value.moveHistory.every(move => coordinate(move.notation, /^[A-C][1-3]$/)) && (value.lastMove === undefined || (plain(value.lastMove) && coordinate(value.lastMove.notation, /^[A-C][1-3]$/))) && (value.winningLine === undefined || Array.isArray(value.winningLine) && value.winningLine.length === 3 && value.winningLine.every(move => coordinate(move, /^[A-C][1-3]$/)));
  if (value.kind === "connect-four") return exact(value, [...baseKeys, "board", "winningLine"]) && board(value.board, 6, 7) && value.legalMoves.every(move => coordinate(move, /^[A-G]$/)) && value.moveHistory.every(move => coordinate(move.notation, /^[A-G]$/)) && (value.lastMove === undefined || (plain(value.lastMove) && coordinate(value.lastMove.notation, /^[A-G]$/))) && (value.winningLine === undefined || Array.isArray(value.winningLine) && value.winningLine.length === 4 && value.winningLine.every(move => coordinate(move, /^[A-G][1-6]$/)));
  const score = value.score as Record<string, unknown>; return exact(value, [...baseKeys, "board", "score"]) && board(value.board, 8, 8) && value.legalMoves.every(move => coordinate(move, /^[A-H][1-8]$/)) && value.moveHistory.every(move => coordinate(move.notation, /^[A-H][1-8]$/)) && (value.lastMove === undefined || (plain(value.lastMove) && coordinate(value.lastMove.notation, /^[A-H][1-8]$/))) && exact(score, ["black", "white"]) && nonnegative(score.black) && nonnegative(score.white);
}
