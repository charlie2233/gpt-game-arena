import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createHttpApp, FixedWindowLimiter } from "../src/http-app.js";
import { toolInputSchemas } from "../src/tool-contracts.js";
import { GameStore } from "../src/game-store.js";
import { ToolService } from "../src/tool-service.js";

class ExplodingToolService extends ToolService {
  override createGame(): never {
    throw new Error("SECRET_SERVICE_VALUE");
  }

  override getGameState(): never {
    throw new Error("SECRET_SERVICE_VALUE");
  }
}

class LeakySnapshotToolService extends ToolService {
  override createGame(input: { game: "chess" | "go"; playerColor: "white" | "black" }) {
    return { ...super.createGame(input), internalSecret: "SECRET" };
  }
}

describe("HTTP game arena app", () => {
  it("serves health and a fixture preview", async () => {
    const app = createHttpApp(new ToolService(new GameStore()), {
      loadWidgetHtml: () => "<!doctype html><title>fixture</title>",
    });
    const health = await request(app).get("/health");
    expect(health.body).toEqual({ ok: true });
    expect(health.headers["x-content-type-options"]).toBe("nosniff");
    expect(health.headers["referrer-policy"]).toBe("no-referrer");
    expect(health.headers["content-security-policy"]).toContain("default-src 'none'");
    const preview = await request(app).get("/preview");
    expect(preview.status).toBe(200);
    expect(preview.text).toContain("fixture");
  });

  it("returns a clear preview build error and dispatches the standalone game flow", async () => {
    const service = new ToolService(new GameStore());
    const app = createHttpApp(service, { loadWidgetHtml: () => undefined });
    const unavailable = await request(app).get("/preview");
    expect(unavailable.status).toBe(503);
    expect(unavailable.text).toContain("npm run build --workspace web");
    expect(unavailable.text).not.toContain("/Users/");

    const created = await request(app).post("/api/tools/create_game").send({ game: "chess", playerColor: "white" });
    expect(created.status).toBe(200);
    const gameId = created.body.structuredContent.gameId as string;
    const played = await request(app).post("/api/tools/play_game_move").send({
      gameId, actor: "player", move: "e2e4", expectedVersion: 0,
    });
    expect(played.status).toBe(200);
    const state = await request(app).post("/api/tools/get_game_state").send({ gameId });
    expect(state.body.structuredContent).toEqual(played.body.structuredContent);
    const reset = await request(app).post("/api/tools/reset_game").send({ gameId });
    expect(reset.body.structuredContent).toMatchObject({ gameId, stateVersion: 0, moveHistory: [] });
  });

  it("accepts supported Go board sizes through REST and rejects invalid sizes", async () => {
    const service = new ToolService(new GameStore());
    const create = vi.spyOn(service, "createGame");
    const app = createHttpApp(service);

    const defaultResponse = await request(app).post("/api/tools/create_game").send({ game: "go", playerColor: "black" });
    expect(defaultResponse.status).toBe(200);
    expect(defaultResponse.body.structuredContent).toMatchObject({ kind: "go", boardSize: 9 });

    for (const [boardSize, expectedMoves] of [[9, 82], [13, 170], [19, 362]] as const) {
      const response = await request(app).post("/api/tools/create_game").send({
        game: "go", playerColor: "black", boardSize,
      });
      expect(response.status).toBe(200);
      expect(response.body.structuredContent).toMatchObject({ kind: "go", boardSize });
      expect(response.body.structuredContent.board).toHaveLength(boardSize);
      expect(response.body.structuredContent.legalMoves).toHaveLength(expectedMoves);
    }

    for (const boardSize of [7, 10, 20, "19", null]) {
      const response = await request(app).post("/api/tools/create_game").send({
        game: "go", playerColor: "black", boardSize,
      });
      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: { code: "invalid_input", message: "Invalid tool input." } });
    }
    expect(create).toHaveBeenCalledTimes(4);
  });

  it("maps validation, domain, unknown-tool, rate-limit, and body-size failures safely", async () => {
    let now = 0;
    const app = createHttpApp(new ToolService(new GameStore()), {
      now: () => now,
      apiToolsRateLimit: { limit: 2, windowMs: 1_000, maxBuckets: 2 },
    });
    const invalid = await request(app).post("/api/tools/get_game_state").send({ gameId: "" });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error).toEqual({ code: "invalid_input", message: "Invalid tool input." });
    const missing = await request(app).post("/api/tools/get_game_state").send({ gameId: "missing" });
    expect(missing.status).toBe(409);
    expect(missing.body).toEqual({ error: { code: "not_found", message: "The requested game operation could not be completed." } });
    const unknown = await request(app).post("/api/tools/nope").send({});
    expect(unknown.status).toBe(429);
    expect(unknown.headers["retry-after"]).toBe("1");
    now = 1_000;
    const afterWindow = await request(app).post("/api/tools/nope").send({});
    expect(afterWindow.status).toBe(404);
    const oversized = await request(app)
      .post("/api/tools/get_game_state")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ gameId: "x".repeat(33 * 1024) }));
    expect(oversized.status).toBe(413);
    expect(oversized.body).toEqual({ error: { code: "payload_too_large", message: "Request body is too large." } });
  });

  it("rejects unexpected fields in every tool input without invoking service methods", async () => {
    const validInputs = {
      create_game: { game: "chess", playerColor: "white" },
      get_game_state: { gameId: "game" },
      play_game_move: { gameId: "game", actor: "player", move: "e2e4", expectedVersion: 0 },
      reset_game: { gameId: "game" },
      render_game: { gameId: "game" },
    } as const;
    for (const [name, schema] of Object.entries(toolInputSchemas)) {
      expect(schema.safeParse({ ...validInputs[name as keyof typeof validInputs], unexpected: "SECRET" }).success).toBe(false);
    }

    const service = new ToolService(new GameStore());
    const create = vi.spyOn(service, "createGame");
    const app = createHttpApp(service);
    const rest = await request(app).post("/api/tools/create_game").send({ ...validInputs.create_game, unexpected: "SECRET" });
    expect(rest.status).toBe(400);
    expect(rest.body).toEqual({ error: { code: "invalid_input", message: "Invalid tool input." } });
    expect(create).not.toHaveBeenCalled();
  });

  it("serves stateless MCP initialize, list, and tool-call requests", async () => {
    const app = createHttpApp(new ToolService(new GameStore()), { loadWidgetHtml: () => "<!doctype html>" });
    const initialize = await request(app).post("/mcp").set("Accept", "application/json, text/event-stream").send({
      jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } },
    });
    expect(initialize.status).toBe(200);
    expect(initialize.body.result.serverInfo.name).toBe("gpt-game-arena");
    const list = await request(app).post("/mcp").set("Accept", "application/json, text/event-stream").send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    expect(list.status).toBe(200);
    expect(list.body.result.tools).toHaveLength(5);
    const call = await request(app).post("/mcp").set("Accept", "application/json, text/event-stream").send({
      jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "create_game", arguments: { game: "go", playerColor: "black", boardSize: 13 } },
    });
    expect(call.status).toBe(200);
    expect(call.body.result.structuredContent.kind).toBe("go");
    expect(call.body.result.structuredContent.boardSize).toBe(13);

    const rejected = await request(app).post("/mcp").set("Accept", "application/json, text/event-stream").send({
      jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "create_game", arguments: { game: "go", playerColor: "black", boardSize: 10 } },
    });
    expect(rejected.status).toBe(200);
    expect(rejected.body.result.isError).toBe(true);
    expect(JSON.stringify(rejected.body.result)).not.toContain("10");
  });

  it("rate-limits MCP requests with a JSON-RPC-safe response", async () => {
    const app = createHttpApp(new ToolService(new GameStore()), { mcpRateLimit: { limit: 1, windowMs: 60_000 } });
    const first = await request(app).post("/mcp").set("Accept", "application/json, text/event-stream").send({
      jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } },
    });
    expect(first.status).toBe(200);
    const limited = await request(app).post("/mcp").set("Accept", "application/json, text/event-stream").send({
      jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } },
    });
    expect(limited.status).toBe(429);
    expect(limited.headers["retry-after"]).toBeDefined();
    expect(limited.body).toEqual({ jsonrpc: "2.0", id: null, error: { code: -32029, message: "Too many requests." } });
  });

  it("uses protocol-specific safe parse and size error envelopes", async () => {
    const app = createHttpApp(new ToolService(new GameStore()));
    const restMalformed = await request(app).post("/api/tools/get_game_state").set("Content-Type", "application/json").send("{");
    expect(restMalformed.status).toBe(400);
    expect(restMalformed.body).toEqual({ error: { code: "invalid_json", message: "Invalid JSON request body." } });
    const mcpMalformed = await request(app).post("/mcp").set("Accept", "application/json, text/event-stream").set("Content-Type", "application/json").send("{");
    expect(mcpMalformed.status).toBe(400);
    expect(mcpMalformed.body).toEqual({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error." } });
    const mcpOversized = await request(app).post("/mcp").set("Accept", "application/json, text/event-stream").set("Content-Type", "application/json").send(JSON.stringify({ payload: "x".repeat(33 * 1024) }));
    expect(mcpOversized.status).toBe(413);
    expect(mcpOversized.body).toEqual({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error." } });
  });

  it("counts malformed and oversized requests before parsing their bodies", async () => {
    const rest = createHttpApp(new ToolService(new GameStore()), { apiToolsRateLimit: { limit: 1 } });
    expect((await request(rest).post("/api/tools/get_game_state").set("Content-Type", "application/json").send("{")).status).toBe(400);
    const restLimited = await request(rest).post("/api/tools/get_game_state").set("Content-Type", "application/json").send(JSON.stringify({ payload: "x".repeat(33 * 1024) }));
    expect(restLimited.status).toBe(429);

    const mcp = createHttpApp(new ToolService(new GameStore()), { mcpRateLimit: { limit: 1 } });
    expect((await request(mcp).post("/mcp").set("Content-Type", "application/json").send("{")).status).toBe(400);
    const mcpLimited = await request(mcp).post("/mcp").set("Accept", "application/json, text/event-stream").set("Content-Type", "application/json").send(JSON.stringify({ payload: "x".repeat(33 * 1024) }));
    expect(mcpLimited.status).toBe(429);
    expect(mcpLimited.body).toEqual({ jsonrpc: "2.0", id: null, error: { code: -32029, message: "Too many requests." } });
  });

  it("treats unsupported media as safe client errors that consume quota", async () => {
    const media = createHttpApp(new ToolService(new GameStore()));
    const restEncoding = await request(media).post("/api/tools/create_game").set("Content-Type", "application/json").set("Content-Encoding", "x-secret").send("{}");
    expect(restEncoding.status).toBe(415);
    expect(restEncoding.body).toEqual({ error: { code: "unsupported_media_type", message: "Unsupported JSON media type." } });
    const mcpCharset = await request(media).post("/mcp").set("Accept", "application/json, text/event-stream").set("Content-Type", "application/json; charset=x-secret").send("{}");
    expect(mcpCharset.status).toBe(415);
    expect(mcpCharset.body).toEqual({ jsonrpc: "2.0", id: null, error: { code: -32015, message: "Unsupported JSON media type." } });

    const rest = createHttpApp(new ToolService(new GameStore()), { apiToolsRateLimit: { limit: 1 } });
    const restCharset = await request(rest).post("/api/tools/create_game").set("Content-Type", "application/json; charset=x-secret").send("{}");
    expect(restCharset.status).toBe(415);
    expect(restCharset.body).toEqual({ error: { code: "unsupported_media_type", message: "Unsupported JSON media type." } });
    const restLimited = await request(rest).post("/api/tools/create_game").set("Content-Type", "application/json").set("Content-Encoding", "x-secret").send("{}");
    expect(restLimited.status).toBe(429);

    const mcp = createHttpApp(new ToolService(new GameStore()), { mcpRateLimit: { limit: 1 } });
    const mcpEncoding = await request(mcp).post("/mcp").set("Accept", "application/json, text/event-stream").set("Content-Type", "application/json").set("Content-Encoding", "x-secret").send("{}");
    expect(mcpEncoding.status).toBe(415);
    expect(mcpEncoding.body).toEqual({ jsonrpc: "2.0", id: null, error: { code: -32015, message: "Unsupported JSON media type." } });
    expect(mcpEncoding.text).not.toContain("x-secret");
    const mcpLimited = await request(mcp).post("/mcp").set("Accept", "application/json, text/event-stream").set("Content-Type", "application/json; charset=x-secret").send("{}");
    expect(mcpLimited.status).toBe(429);
  });

  it("keeps generic REST failures and MCP resource loader errors secret-safe", async () => {
    const failingApp = createHttpApp(new ExplodingToolService(new GameStore()));
    const generic = await request(failingApp).post("/api/tools/get_game_state").send({ gameId: "game" });
    expect(generic.status).toBe(500);
    expect(generic.body).toEqual({ error: { code: "internal_error", message: "Internal server error." } });
    expect(generic.text).not.toContain("SECRET_SERVICE_VALUE");

    const app = createHttpApp(new ExplodingToolService(new GameStore()), {
      loadWidgetHtml: () => { throw new Error("SECRET_LOADER_VALUE"); },
    });
    const resource = await request(app).post("/mcp").set("Accept", "application/json, text/event-stream").send({
      jsonrpc: "2.0", id: 4, method: "resources/read", params: { uri: "ui://gpt-game-arena/v1/widget.html" },
    });
    expect(resource.status).toBe(200);
    expect(resource.text).not.toContain("SECRET_LOADER_VALUE");
    expect(resource.body.result.contents[0].text).toContain("npm run build --workspace web");

    const mcpTool = await request(app).post("/mcp").set("Accept", "application/json, text/event-stream").send({
      jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "create_game", arguments: { game: "chess", playerColor: "white" } },
    });
    expect(mcpTool.status).toBe(200);
    expect(mcpTool.body.result).toEqual({ isError: true, content: [{ type: "text", text: "internal_error: Internal server error." }] });
    expect(mcpTool.text).not.toContain("SECRET_SERVICE_VALUE");
  });

  it("bounds limiter buckets and releases expired capacity", () => {
    let now = 0;
    const limiter = new FixedWindowLimiter({ limit: 1, windowMs: 1_000, maxBuckets: 2 }, () => now);
    expect(limiter.consume("a").allowed).toBe(true);
    expect(limiter.consume("b").allowed).toBe(true);
    expect(limiter.bucketCount()).toBe(2);
    expect(limiter.consume("c").allowed).toBe(false);
    now = 1_000;
    expect(limiter.consume("c").allowed).toBe(true);
    expect(limiter.bucketCount()).toBe(1);
  });

  it("rejects invalid limiter settings and clocks without mutating buckets", () => {
    for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => new FixedWindowLimiter({ limit: value }, () => 0)).toThrow(RangeError);
      expect(() => new FixedWindowLimiter({ windowMs: value }, () => 0)).toThrow(RangeError);
      expect(() => new FixedWindowLimiter({ maxBuckets: value }, () => 0)).toThrow(RangeError);
    }
    let now = Number.NaN;
    const limiter = new FixedWindowLimiter({}, () => now);
    expect(() => limiter.consume("ip")).toThrow(RangeError);
    expect(limiter.bucketCount()).toBe(0);
    now = 0;
    expect(limiter.consume("ip").allowed).toBe(true);
    for (const invalidNow of [-1, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      now = invalidNow;
      expect(() => limiter.consume("another")).toThrow(RangeError);
      expect(limiter.bucketCount()).toBe(1);
    }
    expect(() => createHttpApp(new ToolService(new GameStore()), { apiToolsRateLimit: { limit: 0 } })).toThrow(RangeError);
  });

  it("turns unexpected service output into safe REST and MCP failures", async () => {
    const app = createHttpApp(new LeakySnapshotToolService(new GameStore()));
    const rest = await request(app).post("/api/tools/create_game").send({ game: "chess", playerColor: "white" });
    expect(rest.status).toBe(500);
    expect(rest.body).toEqual({ error: { code: "internal_error", message: "Internal server error." } });
    expect(rest.text).not.toContain("SECRET");
    const mcp = await request(app).post("/mcp").set("Accept", "application/json, text/event-stream").send({
      jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "create_game", arguments: { game: "chess", playerColor: "white" } },
    });
    expect(mcp.body.result).toEqual({ isError: true, content: [{ type: "text", text: "internal_error: Internal server error." }] });
    expect(JSON.stringify(mcp.body.result)).not.toContain("SECRET");
  });
});
