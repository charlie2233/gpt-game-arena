import { describe, expect, expectTypeOf, it } from "vitest";

import { GameRuleError } from "../src/domain/errors.js";
import { GameStore } from "../src/game-store.js";
import { ToolService } from "../src/tool-service.js";
import type { GameKind, StoneColor } from "../src/domain/types.js";

function expectRuleError(action: () => unknown, code: GameRuleError["code"]): void {
  let error: unknown;
  try {
    action();
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(GameRuleError);
  expect((error as GameRuleError).code).toBe(code);
}

describe("ToolService", () => {
  it("creates chess and Go games with distinct generated IDs", () => {
    const service = new ToolService(new GameStore());
    const chess = service.createGame({ game: "chess", playerColor: "white" });
    const go = service.createGame({ game: "go", playerColor: "black" });

    expect(chess.gameId).not.toBe(go.gameId);
    expect(chess.gameId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(go.gameId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(chess.kind).toBe("chess");
    expect(go.kind).toBe("go");
  });

  it("returns the authoritative current state and forwards move version checks", () => {
    const service = new ToolService(new GameStore());
    const created = service.createGame({ game: "chess", playerColor: "white" });

    const afterMove = service.playGameMove({
      gameId: created.gameId,
      actor: "player",
      move: "e2e4",
      expectedVersion: 0,
    });
    expect(service.getGameState({ gameId: created.gameId })).toEqual(afterMove);
    expectRuleError(() => service.playGameMove({
      gameId: created.gameId,
      actor: "gpt",
      move: "e7e5",
      expectedVersion: 0,
    }), "stale_version");
  });

  it("resets the same authoritative ID with its original kind and player color", () => {
    const service = new ToolService(new GameStore());
    const created = service.createGame({ game: "go", playerColor: "black" });
    service.playGameMove({ gameId: created.gameId, actor: "player", move: "A1", expectedVersion: 0 });

    const reset = service.resetGame({ gameId: created.gameId });
    expect(reset.gameId).toBe(created.gameId);
    expect(reset.kind).toBe("go");
    expect(reset.playerColor).toBe("black");
    expect(reset.stateVersion).toBe(0);
    expect(reset.moveHistory).toEqual([]);
    expect(service.getGameState({ gameId: created.gameId })).toEqual(reset);
  });

  it("returns not_found for unknown IDs", () => {
    const service = new ToolService(new GameStore());

    expectRuleError(() => service.getGameState({ gameId: "missing" }), "not_found");
    expectRuleError(() => service.playGameMove({
      gameId: "missing", actor: "player", move: "A1", expectedVersion: 0,
    }), "not_found");
    expectRuleError(() => service.resetGame({ gameId: "missing" }), "not_found");
  });

  it("exposes game kind and stone color as narrow TypeScript inputs", () => {
    expectTypeOf<GameKind>().toEqualTypeOf<"chess" | "go">();
    expectTypeOf<StoneColor>().toEqualTypeOf<"white" | "black">();
  });
});
