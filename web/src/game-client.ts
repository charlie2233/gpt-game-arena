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
export function isSnapshot(value: unknown): value is GameSnapshot { const v = value as Partial<GameSnapshot>; return !!v && typeof v === "object" && (v.kind === "chess" || v.kind === "go") && typeof v.gameId === "string" && Array.isArray(v.legalMoves) && Array.isArray(v.moveHistory) && Number.isInteger(v.stateVersion); }
