import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Ajv } from "ajv";
import { describe, expect, it, vi } from "vitest";

import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";

import { createMcpServer, LEGACY_WIDGET_RESOURCE_URIS, WIDGET_DESCRIPTION, WIDGET_RESOURCE_URI } from "../src/mcp-server.js";
import { gameSnapshotSchema, toolInputSchemas } from "../src/tool-contracts.js";
import { GameStore } from "../src/game-store.js";
import { ToolService } from "../src/tool-service.js";

describe("MCP game arena server", () => {
  it("registers six game tools and the widget resource", async () => {
    expect(WIDGET_RESOURCE_URI).toBe("ui://gpt-game-arena/v12/widget.html");
    expect(WIDGET_DESCRIPTION).toContain("chess");
    expect(WIDGET_DESCRIPTION).toContain("Reversi");
    expect(WIDGET_DESCRIPTION).toContain("Tic-Tac-Toe");
    expect(WIDGET_DESCRIPTION).toContain("Connect Four");
    expect(WIDGET_DESCRIPTION).toContain("9x9, 13x13, or 19x19 Go");
    const server = createMcpServer(new ToolService(new GameStore()), {
      loadWidgetHtml: () => "<!doctype html><title>fixture</title>",
    });
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
      "create_game", "end_game", "get_game_state", "play_game_move", "render_game", "reset_game",
    ]);
    const expectedAnnotations = {
      create_game: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: false },
      get_game_state: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
      play_game_move: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: false },
      end_game: { readOnlyHint: false, destructiveHint: true, openWorldHint: false, idempotentHint: false },
      reset_game: { readOnlyHint: false, destructiveHint: true, openWorldHint: false, idempotentHint: false },
      render_game: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
    } as const;
    for (const tool of tools.tools) {
      expect(tool.description).toMatch(/^Use this when/);
      expect(tool.annotations).toMatchObject(expectedAnnotations[tool.name as keyof typeof expectedAnnotations]);
      expect(tool._meta).toMatchObject({
        "openai/toolInvocation/invoking": "Working…",
        "openai/toolInvocation/invoked": "Done.",
      });
    }
    const rendered = tools.tools.find((tool) => tool.name === "render_game");
    expect(rendered).toMatchObject({
      title: "Render game",
      _meta: { ui: { resourceUri: WIDGET_RESOURCE_URI, visibility: ["model"] }, "openai/outputTemplate": WIDGET_RESOURCE_URI },
    });
    expect(tools.tools.find((tool) => tool.name === "create_game")?.title).toBe("Create game");
    expect(tools.tools.find((tool) => tool.name === "get_game_state")?.title).toBe("Get game state");
    expect(tools.tools.find((tool) => tool.name === "play_game_move")?.title).toBe("Play game move");
    expect(tools.tools.find((tool) => tool.name === "play_game_move")?.description).toContain("MOVE_CONFIRMED");
    expect(tools.tools.find((tool) => tool.name === "end_game")?.title).toBe("End game");
    expect(tools.tools.find((tool) => tool.name === "end_game")?.description).toContain("explicitly confirms");
    expect(tools.tools.find((tool) => tool.name === "end_game")?.description).toContain("END_CONFIRMED");
    expect(tools.tools.find((tool) => tool.name === "reset_game")?.title).toBe("Reset game");
    const createTool = tools.tools.find((tool) => tool.name === "create_game");
    for (const game of ["chess", "Reversi", "Tic-Tac-Toe", "Connect Four", "Go"]) {
      expect(createTool?.description).toContain(game);
    }
    expect(createTool?.description).toContain("omitted difficulty defaults to medium");
    expect(createTool?.inputSchema).toMatchObject({
      properties: {
        game: { enum: ["chess", "go", "tic-tac-toe", "connect-four", "reversi"] },
        boardSize: { enum: [9, 13, 19] },
        difficulty: { enum: ["easy", "medium", "hard"], default: "medium" },
      },
    });
    expect((createTool?.inputSchema as { required?: string[] }).required).not.toContain("difficulty");
    const validateCreateInput = new Ajv({ strict: false }).compile(createTool?.inputSchema as object);
    expect(toolInputSchemas.create_game.shape.game.options).toEqual(["chess", "go", "tic-tac-toe", "connect-four", "reversi"]);
    expect(toolInputSchemas.create_game.safeParse({ game: "tic-tac-toe", playerColor: "black" }).success).toBe(true);
    expect(toolInputSchemas.create_game.safeParse({ game: "connect-four", playerColor: "black" }).success).toBe(true);
    expect(validateCreateInput({ game: "go", playerColor: "black" })).toBe(true);
    expect(validateCreateInput({ game: "tic-tac-toe", playerColor: "black" })).toBe(true);
    for (const difficulty of ["easy", "medium", "hard"]) {
      expect(validateCreateInput({ game: "chess", playerColor: "white", difficulty })).toBe(true);
    }
    for (const boardSize of [9, 13, 19]) {
      expect(validateCreateInput({ game: "go", playerColor: "black", boardSize })).toBe(true);
    }
    for (const difficulty of ["Medium", "expert", "", 1, null]) {
      expect(validateCreateInput({ game: "chess", playerColor: "white", difficulty })).toBe(false);
    }
    expect(validateCreateInput({ game: "go", playerColor: "black", boardSize: 10 })).toBe(false);
    expect(validateCreateInput({ game: "connect-four", playerColor: "black" })).toBe(true);
    expect(validateCreateInput({ game: "reversi", playerColor: "black" })).toBe(true);
    expect(validateCreateInput({ game: "go", playerColor: "black", boardSize: 19, secret: "SECRET" })).toBe(false);
    expect(tools.tools.filter((tool) => tool.name !== "render_game").every((tool) => {
      const meta = tool._meta as { ui?: { resourceUri?: string; visibility?: string[] }; "openai/outputTemplate"?: string } | undefined;
      return meta?.ui?.resourceUri === undefined
        && meta?.["openai/outputTemplate"] === undefined
        && JSON.stringify(meta?.ui?.visibility) === JSON.stringify(["model", "app"]);
    })).toBe(true);
    expect(JSON.stringify(tools.tools).length).toBeLessThan(15_000);
    for (const tool of tools.tools) {
      const outputSchema = tool.outputSchema as { type?: string; properties?: Record<string, unknown>; required?: string[] };
      expect(outputSchema).toMatchObject({ type: "object", properties: { gameId: expect.any(Object), kind: expect.any(Object), difficulty: expect.any(Object), stateVersion: expect.any(Object), legalMoves: expect.any(Object) } });
      expect(outputSchema.required).toEqual(expect.arrayContaining(["gameId", "kind", "difficulty", "playerColor", "turn", "status", "stateVersion", "legalMoves", "message"]));
      expect(outputSchema.required).not.toContain("resetEpoch");
      expect(outputSchema.properties).not.toHaveProperty("board");
      expect(JSON.stringify(outputSchema)).not.toContain("boardSize");
    }
    const playTool = tools.tools.find((tool) => tool.name === "play_game_move");
    expect(playTool?.inputSchema).toMatchObject({ properties: { expectedResetEpoch: { type: "integer", minimum: 0 } } });
    expect((playTool?.inputSchema as { required?: string[] }).required).not.toContain("expectedResetEpoch");
    const endTool = tools.tools.find((tool) => tool.name === "end_game");
    expect(endTool?.inputSchema).toMatchObject({
      properties: {
        confirmed: { const: true },
        expectedVersion: { type: "integer", minimum: 0 },
        expectedResetEpoch: { type: "integer", minimum: 0 },
      },
      required: expect.arrayContaining(["gameId", "confirmed", "expectedVersion", "expectedResetEpoch"]),
    });
    expect((endTool?.inputSchema as { properties?: Record<string, unknown> }).properties).not.toHaveProperty("actor");
    expect(toolInputSchemas.end_game.safeParse({ gameId: "game", confirmed: true, expectedVersion: 0, expectedResetEpoch: 0 }).success).toBe(true);
    expect(toolInputSchemas.end_game.safeParse({ gameId: "game", confirmed: false, expectedVersion: 0, expectedResetEpoch: 0 }).success).toBe(false);
    expect(toolInputSchemas.end_game.safeParse({ gameId: "game", confirmed: true, expectedVersion: 0 }).success).toBe(false);

    const created = await client.callTool({ name: "create_game", arguments: { game: "chess", playerColor: "white" } });
    expect(created.isError, JSON.stringify(created)).not.toBe(true);
    const snapshot = created.structuredContent as {
      gameId: string;
      kind: string;
      difficulty: string;
      resetEpoch: number;
    };
    expect(snapshot.kind).toBe("chess");
    expect(snapshot.difficulty).toBe("medium");
    expect(snapshot.resetEpoch).toBe(0);
    expect(gameSnapshotSchema.safeParse(snapshot).success).toBe(true);
    const goCreated = await client.callTool({ name: "create_game", arguments: { game: "go", playerColor: "black", boardSize: 19, difficulty: "hard" } });
    const goSnapshot = goCreated.structuredContent as Record<string, unknown>;
    expect(goSnapshot.kind).toBe("go");
    expect(goSnapshot.difficulty).toBe("hard");
    expect(goSnapshot.boardSize).toBe(19);
    expect(goSnapshot.board).toHaveLength(19);
    const goBoard = goSnapshot.board as unknown[][];
    const ticTacToeCreated = await client.callTool({ name: "create_game", arguments: { game: "tic-tac-toe", playerColor: "black" } });
    const ticTacToeSnapshot = ticTacToeCreated.structuredContent as Record<string, unknown>;
    expect(ticTacToeSnapshot).toMatchObject({ kind: "tic-tac-toe", difficulty: "medium" });
    expect(gameSnapshotSchema.safeParse({ ...ticTacToeSnapshot, legalMoves: ["a1"] }).success).toBe(false);
    expect(gameSnapshotSchema.safeParse({ ...ticTacToeSnapshot, legalMoves: ["D1"] }).success).toBe(false);
    const ticMove = { actor: "player", color: "black", notation: "A1", ply: 1 };
    expect(gameSnapshotSchema.safeParse({ ...ticTacToeSnapshot, moveHistory: [ticMove], lastMove: ticMove }).success).toBe(true);
    expect(gameSnapshotSchema.safeParse({ ...ticTacToeSnapshot, moveHistory: [{ ...ticMove, notation: "a1" }] }).success).toBe(false);
    expect(gameSnapshotSchema.safeParse({ ...ticTacToeSnapshot, lastMove: { ...ticMove, notation: "D1" } }).success).toBe(false);
    const connectFourCreated = await client.callTool({ name: "create_game", arguments: { game: "connect-four", playerColor: "black" } });
    const connectFourSnapshot = connectFourCreated.structuredContent as Record<string, unknown>;
    expect(connectFourSnapshot).toMatchObject({ kind: "connect-four", difficulty: "medium" });
    expect(gameSnapshotSchema.safeParse({ ...connectFourSnapshot, legalMoves: ["a"] }).success).toBe(false);
    expect(gameSnapshotSchema.safeParse({ ...connectFourSnapshot, board: [] }).success).toBe(false);
    expect(gameSnapshotSchema.safeParse({ ...connectFourSnapshot, winningLine: ["A1", "B1", "C1"] }).success).toBe(false);
    const connectMove = { actor: "player", color: "black", notation: "A", ply: 1 };
    expect(gameSnapshotSchema.safeParse({ ...connectFourSnapshot, moveHistory: [connectMove], lastMove: connectMove }).success).toBe(true);
    expect(gameSnapshotSchema.safeParse({ ...connectFourSnapshot, moveHistory: [{ ...connectMove, notation: "a" }] }).success).toBe(false);
    expect(gameSnapshotSchema.safeParse({ ...connectFourSnapshot, lastMove: { ...connectMove, notation: "H" } }).success).toBe(false);
    const reversiCreated = await client.callTool({ name: "create_game", arguments: { game: "reversi", playerColor: "black" } });
    const reversiSnapshot = reversiCreated.structuredContent as Record<string, unknown>;
    expect(reversiCreated.isError, JSON.stringify(reversiCreated)).not.toBe(true);
    expect(reversiSnapshot).toMatchObject({ kind: "reversi", score: { black: 2, white: 2 }, legalMoves: ["C4", "D3", "E6", "F5"] });
    const ajv = new Ajv({ strict: false });
    for (const tool of tools.tools) {
      const validate = ajv.compile(tool.outputSchema as object);
      expect(validate(snapshot), JSON.stringify(validate.errors)).toBe(true);
      expect(validate(goSnapshot), JSON.stringify(validate.errors)).toBe(true);
      expect(validate(ticTacToeSnapshot), JSON.stringify(validate.errors)).toBe(true);
      expect(validate(connectFourSnapshot), JSON.stringify(validate.errors)).toBe(true);
      expect(validate(reversiSnapshot), JSON.stringify(validate.errors)).toBe(true);
      // The published schema is intentionally only the compact common contract;
      // success() below still enforces the complete strict game union.
      expect(validate({ ...ticTacToeSnapshot, legalMoves: ["a1"] }), JSON.stringify(validate.errors)).toBe(true);
      expect(validate({ ...snapshot, kind: "secret" }), JSON.stringify(validate.errors)).toBe(false);
      expect(validate({ ...snapshot, internalSecret: "SECRET" }), JSON.stringify(validate.errors)).toBe(true);
      expect(validate({ ...snapshot, difficulty: undefined }), JSON.stringify(validate.errors)).toBe(false);
      expect(validate({ ...snapshot, difficulty: "expert" }), JSON.stringify(validate.errors)).toBe(false);
      expect(validate({ ...snapshot, resetEpoch: -1 }), JSON.stringify(validate.errors)).toBe(false);
      expect(validate({ ...snapshot, resetEpoch: 1.5 }), JSON.stringify(validate.errors)).toBe(false);
      expect(validate({ ...snapshot, stateVersion: -1 }), JSON.stringify(validate.errors)).toBe(false);
      const missingGameId = { ...snapshot };
      delete (missingGameId as { gameId?: unknown }).gameId;
      expect(validate(missingGameId), JSON.stringify(validate.errors)).toBe(false);
    }
    expect(gameSnapshotSchema.safeParse({ ...goSnapshot, captures: { ...(goSnapshot.captures as object), secret: "SECRET" } }).success).toBe(false);
    expect(gameSnapshotSchema.safeParse({ ...goSnapshot, difficulty: undefined }).success).toBe(false);
    expect(gameSnapshotSchema.safeParse({ ...goSnapshot, difficulty: "expert" }).success).toBe(false);
    expect(gameSnapshotSchema.safeParse({ ...goSnapshot, resetEpoch: -1 }).success).toBe(false);
    expect(gameSnapshotSchema.safeParse({ ...goSnapshot, resetEpoch: 1.5 }).success).toBe(false);
    expect(gameSnapshotSchema.safeParse({ ...goSnapshot, board: goBoard.slice(1) }).success).toBe(false);
    expect(gameSnapshotSchema.safeParse({ ...goSnapshot, board: goBoard.map((row, index) => index === 0 ? row.slice(1) : row) }).success).toBe(false);
    expect(gameSnapshotSchema.safeParse({ ...goSnapshot, boardSize: 13 }).success).toBe(false);
    expect(gameSnapshotSchema.safeParse({ ...reversiSnapshot, moveHistory: [{ actor: "player", color: "black", notation: "", ply: 1 }] }).success).toBe(false);
    const paddedTicMove = await client.callTool({ name: "play_game_move", arguments: {
      gameId: ticTacToeSnapshot.gameId, actor: "player", move: " A1 ", expectedVersion: 0,
    } });
    expect(paddedTicMove.isError).toBe(true);
    expect(JSON.stringify(paddedTicMove)).not.toContain(" A1 ");
    const exactTicMove = await client.callTool({ name: "play_game_move", arguments: {
      gameId: ticTacToeSnapshot.gameId, actor: "player", move: "A1", expectedVersion: 0,
    } });
    expect(exactTicMove.structuredContent).toMatchObject({ stateVersion: 1, moveHistory: [{ notation: "A1" }] });
    const invalidBoardSize = await client.callTool({ name: "create_game", arguments: {
      game: "go", playerColor: "black", boardSize: 10,
    } });
    expect(invalidBoardSize.isError).toBe(true);
    expect(JSON.stringify(invalidBoardSize)).not.toContain("10");
    const secretBoardSize = await client.callTool({ name: "create_game", arguments: {
      game: "go", playerColor: "black", boardSize: "SECRET_BOARD_SIZE",
    } });
    expect(secretBoardSize.isError).toBe(true);
    expect(JSON.stringify(secretBoardSize)).not.toContain("SECRET_BOARD_SIZE");
    const secretDifficulty = await client.callTool({ name: "create_game", arguments: {
      game: "chess", playerColor: "white", difficulty: "SECRET_DIFFICULTY",
    } });
    expect(secretDifficulty.isError).toBe(true);
    expect(JSON.stringify(secretDifficulty)).not.toContain("SECRET_DIFFICULTY");
    const render = await client.callTool({ name: "render_game", arguments: { gameId: snapshot.gameId } });
    expect(render.structuredContent).toEqual(snapshot);
    const played = await client.callTool({ name: "play_game_move", arguments: {
      gameId: snapshot.gameId, actor: "player", move: "e2e4", expectedVersion: 0, expectedResetEpoch: 0,
    } });
    expect(played.isError).not.toBe(true);
    expect(played.content).toEqual([{ type: "text", text: `MOVE_CONFIRMED ${JSON.stringify({ gameId: snapshot.gameId, resetEpoch: 0, actor: "player", move: "e2e4", previousVersion: 0, stateVersion: 1 })}` }]);
    const state = await client.callTool({ name: "get_game_state", arguments: { gameId: snapshot.gameId } });
    expect(state.structuredContent).toEqual(played.structuredContent);
    const stale = await client.callTool({ name: "play_game_move", arguments: {
      gameId: snapshot.gameId, actor: "gpt", move: "e7e5", expectedVersion: 0, expectedResetEpoch: 0,
    } });
    expect(stale).toMatchObject({ isError: true, content: [{ text: expect.stringMatching(/^MOVE_NOT_APPLIED stale_version:/) }] });
    expect(JSON.stringify(stale)).not.toContain("MOVE_CONFIRMED");
    const ended = await client.callTool({ name: "end_game", arguments: {
      gameId: snapshot.gameId, confirmed: true, expectedVersion: 1, expectedResetEpoch: 0,
    } });
    expect(ended.isError).not.toBe(true);
    expect(ended.structuredContent).toMatchObject({
      gameId: snapshot.gameId,
      status: "finished",
      finishReason: "ended",
      stateVersion: 2,
      legalMoves: [],
      message: "Game ended.",
    });
    expect(ended.content).toEqual([{ type: "text", text: `END_CONFIRMED ${JSON.stringify({
      gameId: snapshot.gameId,
      resetEpoch: 0,
      finishReason: "ended",
      previousVersion: 1,
      stateVersion: 2,
    })}` }]);
    const repeatedEnd = await client.callTool({ name: "end_game", arguments: {
      gameId: snapshot.gameId, confirmed: true, expectedVersion: 2, expectedResetEpoch: 0,
    } });
    expect(repeatedEnd).toMatchObject({ isError: true, content: [{ text: expect.stringMatching(/^END_NOT_APPLIED game_finished:/) }] });
    const missing = await client.callTool({ name: "get_game_state", arguments: { gameId: "missing" } });
    expect(missing).toMatchObject({ isError: true, content: [{ text: expect.stringContaining("not_found") }] });
    const reset = await client.callTool({ name: "reset_game", arguments: { gameId: snapshot.gameId } });
    expect(reset.structuredContent).toMatchObject({
      gameId: snapshot.gameId,
      difficulty: "medium",
      stateVersion: 0,
      resetEpoch: 1,
      moveHistory: [],
    });
    const omittedEpochAfterReset = await client.callTool({ name: "play_game_move", arguments: {
      gameId: snapshot.gameId, actor: "player", move: "e2e4", expectedVersion: 0,
    } });
    expect(omittedEpochAfterReset).toMatchObject({ isError: true, content: [{ text: expect.stringMatching(/^MOVE_NOT_APPLIED stale_version:/) }] });
    const stateAfterRejectedResetMove = await client.callTool({ name: "get_game_state", arguments: { gameId: snapshot.gameId } });
    expect(stateAfterRejectedResetMove.structuredContent).toMatchObject({ resetEpoch: 1, stateVersion: 0, moveHistory: [] });
    const invalid = await client.callTool({ name: "get_game_state", arguments: { gameId: "" } });
    expect(invalid.isError).toBe(true);

    const resource = await client.readResource({ uri: WIDGET_RESOURCE_URI });
    expect(resource.contents[0]).toMatchObject({ uri: WIDGET_RESOURCE_URI, mimeType: RESOURCE_MIME_TYPE, text: "<!doctype html><title>fixture</title>" });
    expect((resource.contents[0] as { _meta?: unknown })._meta).toEqual({
      ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [] } },
      "openai/widgetDescription": WIDGET_DESCRIPTION,
    });
    const legacyResource = await client.readResource({ uri: LEGACY_WIDGET_RESOURCE_URIS[0] });
    expect(legacyResource.contents[0]).toMatchObject({
      uri: LEGACY_WIDGET_RESOURCE_URIS[0],
      mimeType: RESOURCE_MIME_TYPE,
      text: "<!doctype html><title>fixture</title>",
    });

    await Promise.all([client.close(), server.close()]);
  });

  it("never exposes widget loader failures through resource reads", async () => {
    const server = createMcpServer(new ToolService(new GameStore()), {
      loadWidgetHtml: () => { throw new Error("SECRET_LOADER_VALUE"); },
    });
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const resource = await client.readResource({ uri: WIDGET_RESOURCE_URI });
    expect(JSON.stringify(resource)).not.toContain("SECRET_LOADER_VALUE");
    expect(resource.contents[0]).toMatchObject({ text: expect.stringContaining("npm run build --workspace web") });
    await Promise.all([client.close(), server.close()]);
  });

  it("returns a safe MCP error for unexpected tool-service failures", async () => {
    const service = new ToolService(new GameStore());
    vi.spyOn(service, "createGame").mockImplementation(() => { throw new Error("SECRET_SERVICE_VALUE"); });
    const server = createMcpServer(service);
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const result = await client.callTool({ name: "create_game", arguments: { game: "chess", playerColor: "white" } });
    expect(result).toEqual({ isError: true, content: [{ type: "text", text: "internal_error: Internal server error." }] });
    expect(JSON.stringify(result)).not.toContain("SECRET_SERVICE_VALUE");
    await Promise.all([client.close(), server.close()]);
  });

  it("marks unexpected play failures as unconfirmed without leaking details", async () => {
    const service = new ToolService(new GameStore());
    const created = service.createGame({ game: "chess", playerColor: "white" });
    vi.spyOn(service, "playGameMove").mockImplementation(() => { throw new Error("SECRET_PLAY_FAILURE"); });
    const server = createMcpServer(service);
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const result = await client.callTool({ name: "play_game_move", arguments: {
      gameId: created.gameId, actor: "player", move: "e2e4", expectedVersion: 0, expectedResetEpoch: 0,
    } });
    expect(result).toEqual({ isError: true, content: [{ type: "text", text: "MOVE_CONFIRMATION_UNKNOWN internal_error: Internal server error." }] });
    expect(JSON.stringify(result)).not.toContain("SECRET_PLAY_FAILURE");
    expect(service.getGameState({ gameId: created.gameId })).toMatchObject({ stateVersion: 0, moveHistory: [] });
    await Promise.all([client.close(), server.close()]);
  });

  it("marks unexpected end failures as unconfirmed without leaking details", async () => {
    const service = new ToolService(new GameStore());
    const created = service.createGame({ game: "chess", playerColor: "white" });
    vi.spyOn(service, "endGame").mockImplementation(() => { throw new Error("SECRET_END_FAILURE"); });
    const server = createMcpServer(service);
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const result = await client.callTool({ name: "end_game", arguments: {
      gameId: created.gameId, confirmed: true, expectedVersion: 0, expectedResetEpoch: 0,
    } });
    expect(result).toEqual({ isError: true, content: [{ type: "text", text: "END_CONFIRMATION_UNKNOWN internal_error: Internal server error." }] });
    expect(JSON.stringify(result)).not.toContain("SECRET_END_FAILURE");
    expect(service.getGameState({ gameId: created.gameId })).toMatchObject({ status: "active", stateVersion: 0 });
    await Promise.all([client.close(), server.close()]);
  });

  it("uses an unconfirmed marker if output validation fails after a move committed", async () => {
    const service = new ToolService(new GameStore());
    const created = service.createGame({ game: "chess", playerColor: "white" });
    const play = service.playGameMove.bind(service);
    vi.spyOn(service, "playGameMove").mockImplementation(input => ({ ...play(input), internalSecret: "SECRET_POST_COMMIT" } as unknown as ReturnType<ToolService["playGameMove"]>));
    const server = createMcpServer(service);
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const result = await client.callTool({ name: "play_game_move", arguments: {
      gameId: created.gameId, actor: "player", move: "e2e4", expectedVersion: 0, expectedResetEpoch: 0,
    } });
    expect(result).toEqual({ isError: true, content: [{ type: "text", text: "MOVE_CONFIRMATION_UNKNOWN internal_error: Internal server error." }] });
    expect(JSON.stringify(result)).not.toContain("SECRET_POST_COMMIT");
    expect(service.getGameState({ gameId: created.gameId })).toMatchObject({ stateVersion: 1, moveHistory: [{ notation: "e2e4" }] });
    await Promise.all([client.close(), server.close()]);
  });

  it("rejects unexpected extra fields in service snapshots", async () => {
    const service = new ToolService(new GameStore());
    const valid = service.createGame({ game: "chess", playerColor: "white" });
    vi.spyOn(service, "createGame").mockReturnValue({ ...valid, internalSecret: "SECRET" } as unknown as typeof valid);
    const server = createMcpServer(service);
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const result = await client.callTool({ name: "create_game", arguments: { game: "chess", playerColor: "white" } });
    expect(result).toEqual({ isError: true, content: [{ type: "text", text: "internal_error: Internal server error." }] });
    expect(JSON.stringify(result)).not.toContain("SECRET");
    await Promise.all([client.close(), server.close()]);
  });

  it("rejects unexpected tool arguments before executing the handler", async () => {
    const service = new ToolService(new GameStore());
    const create = vi.spyOn(service, "createGame");
    const server = createMcpServer(service);
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const rejected = await client.callTool({ name: "create_game", arguments: { game: "chess", playerColor: "white", unexpected: "SECRET" } });
    expect(rejected.isError).toBe(true);
    expect(create).not.toHaveBeenCalled();
    expect(JSON.stringify(rejected)).not.toContain("SECRET");
    const valid = await client.callTool({ name: "create_game", arguments: { game: "chess", playerColor: "white" } });
    expect(valid.isError).not.toBe(true);
    expect(JSON.stringify(valid)).not.toContain("unexpected");
    await Promise.all([client.close(), server.close()]);
  });
});
