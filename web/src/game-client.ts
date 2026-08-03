import { GameBridge } from "./bridge";
import type { GameSnapshot, GoBoardSize, ToolInput, ToolName } from "./types";

export class GameClient {
  constructor(private readonly bridge: GameBridge) {}
  create(input: ToolInput["create_game"]) { return this.call("create_game", input); }
  state(gameId: string) { return this.call("get_game_state", { gameId }); }
  play(gameId: string, actor: "player" | "gpt", move: string, expectedVersion: number) { return this.call("play_game_move", { gameId, actor, move, expectedVersion }); }
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
export function isSnapshot(value: unknown): value is GameSnapshot {
  if (!plain(value) || !["chess", "go", "tic-tac-toe", "connect-four", "reversi"].includes(value.kind as string) || typeof value.gameId !== "string" || !difficulty(value.difficulty) || !color(value.playerColor) || !color(value.turn) || (value.status !== "active" && value.status !== "finished") || (value.winner !== undefined && !color(value.winner) && value.winner !== "draw") || !Array.isArray(value.legalMoves) || !value.legalMoves.every(m => typeof m === "string") || !Array.isArray(value.moveHistory) || !value.moveHistory.every(record) || (value.lastMove !== undefined && !record(value.lastMove)) || !nonnegative(value.stateVersion) || typeof value.message !== "string") return false;
  if (value.kind === "chess") return Array.isArray(value.board) && value.board.length === 64 && value.board.every(cell => plain(cell) && typeof cell.square === "string" && /^[a-h][1-8]$/.test(cell.square) && ((Object.keys(cell).length === 1) || (Object.keys(cell).length === 3 && color(cell.color) && ["p", "n", "b", "r", "q", "k"].includes(cell.piece as string))));
  const size = value.boardSize;
  if (value.kind === "go") return goBoardSize(size) && board(value.board, size, size) && plain(value.captures) && nonnegative(value.captures.black) && nonnegative(value.captures.white) && nonnegative(value.consecutivePasses) && (value.score === undefined || (plain(value.score) && typeof value.score.black === "number" && typeof value.score.white === "number" && value.score.komi === 6.5));
  if (value.kind === "tic-tac-toe") return board(value.board, 3, 3) && value.legalMoves.every(move => coordinate(move, /^[A-C][1-3]$/)) && (value.winningLine === undefined || Array.isArray(value.winningLine) && value.winningLine.length === 3 && value.winningLine.every(move => coordinate(move, /^[A-C][1-3]$/)));
  if (value.kind === "connect-four") return board(value.board, 6, 7) && value.legalMoves.every(move => coordinate(move, /^[A-G]$/)) && (value.winningLine === undefined || Array.isArray(value.winningLine) && value.winningLine.length === 4 && value.winningLine.every(move => coordinate(move, /^[A-G][1-6]$/)));
  return board(value.board, 8, 8) && value.legalMoves.every(move => coordinate(move, /^[A-H][1-8]$/)) && value.moveHistory.every(move => coordinate(move.notation, /^[A-H][1-8]$/)) && (value.lastMove === undefined || (plain(value.lastMove) && coordinate(value.lastMove.notation, /^[A-H][1-8]$/))) && plain(value.score) && nonnegative(value.score.black) && nonnegative(value.score.white);
}
