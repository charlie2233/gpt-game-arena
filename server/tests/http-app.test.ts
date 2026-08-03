import request from "supertest";
import { describe, expect, it } from "vitest";

import { createHttpApp } from "../src/http-app.js";
import { GameStore } from "../src/game-store.js";
import { ToolService } from "../src/tool-service.js";

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
      jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "create_game", arguments: { game: "go", playerColor: "black" } },
    });
    expect(call.status).toBe(200);
    expect(call.body.result.structuredContent.kind).toBe("go");
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
});
