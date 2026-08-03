import { GameBridge } from "./bridge";
import type { GameSnapshot, ToolInput, ToolName } from "./types";

export class GameClient {
  constructor(private readonly bridge: GameBridge) {}
  create(game: "chess" | "go", playerColor: "white" | "black" = "white") { return this.call("create_game", { game, playerColor }); }
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
const record = (v: unknown): boolean => !!v && typeof v === "object" && (v as { actor?: unknown }).actor !== undefined && (["player", "gpt"].includes((v as { actor: string }).actor)) && color((v as { color: unknown }).color) && typeof (v as { notation?: unknown }).notation === "string" && nonnegative((v as { ply?: unknown }).ply);
const nonnegative = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;
const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
export function isSnapshot(value: unknown): value is GameSnapshot {
  if (!plain(value) || (value.kind !== "chess" && value.kind !== "go") || typeof value.gameId !== "string" || !color(value.playerColor) || !color(value.turn) || (value.status !== "active" && value.status !== "finished") || (value.winner !== undefined && !color(value.winner) && value.winner !== "draw") || !Array.isArray(value.legalMoves) || !value.legalMoves.every(m => typeof m === "string") || !Array.isArray(value.moveHistory) || !value.moveHistory.every(record) || (value.lastMove !== undefined && !record(value.lastMove)) || !nonnegative(value.stateVersion) || typeof value.message !== "string") return false;
  if (value.kind === "chess") return Array.isArray(value.board) && value.board.length === 64 && value.board.every(cell => plain(cell) && typeof cell.square === "string" && /^[a-h][1-8]$/.test(cell.square) && ((Object.keys(cell).length === 1) || (Object.keys(cell).length === 3 && color(cell.color) && ["p", "n", "b", "r", "q", "k"].includes(cell.piece as string))));
  return value.boardSize === 9 && Array.isArray(value.board) && value.board.length === 9 && value.board.every(row => Array.isArray(row) && row.length === 9 && row.every(stone => stone === null || color(stone))) && plain(value.captures) && nonnegative(value.captures.black) && nonnegative(value.captures.white) && nonnegative(value.consecutivePasses) && (value.score === undefined || (plain(value.score) && typeof value.score.black === "number" && typeof value.score.white === "number" && value.score.komi === 6.5));
}
