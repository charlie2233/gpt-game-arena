import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";

import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";

import { createMcpServer, WIDGET_DESCRIPTION, WIDGET_RESOURCE_URI } from "../src/mcp-server.js";
import { gameSnapshotSchema } from "../src/tool-contracts.js";
import { GameStore } from "../src/game-store.js";
import { ToolService } from "../src/tool-service.js";

describe("MCP game arena server", () => {
  it("registers five game tools and the widget resource", async () => {
    const server = createMcpServer(new ToolService(new GameStore()), {
      loadWidgetHtml: () => "<!doctype html><title>fixture</title>",
    });
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
      "create_game", "get_game_state", "play_game_move", "render_game", "reset_game",
    ]);
    const expectedAnnotations = {
      create_game: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: false },
      get_game_state: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
      play_game_move: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: false },
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
    expect(rendered?._meta).toMatchObject({ ui: { resourceUri: WIDGET_RESOURCE_URI } });
    expect(tools.tools.filter((tool) => tool.name !== "render_game").every((tool) => {
      return (tool._meta as { ui?: { resourceUri?: string } } | undefined)?.ui?.resourceUri === undefined;
    })).toBe(true);

    const created = await client.callTool({ name: "create_game", arguments: { game: "chess", playerColor: "white" } });
    expect(created.isError, JSON.stringify(created)).not.toBe(true);
    const snapshot = created.structuredContent as { gameId: string; kind: string };
    expect(snapshot.kind).toBe("chess");
    expect(gameSnapshotSchema.safeParse(snapshot).success).toBe(true);
    const render = await client.callTool({ name: "render_game", arguments: { gameId: snapshot.gameId } });
    expect(render.structuredContent).toEqual(snapshot);
    const played = await client.callTool({ name: "play_game_move", arguments: {
      gameId: snapshot.gameId, actor: "player", move: "e2e4", expectedVersion: 0,
    } });
    expect(played.isError).not.toBe(true);
    const state = await client.callTool({ name: "get_game_state", arguments: { gameId: snapshot.gameId } });
    expect(state.structuredContent).toEqual(played.structuredContent);
    const stale = await client.callTool({ name: "play_game_move", arguments: {
      gameId: snapshot.gameId, actor: "gpt", move: "e7e5", expectedVersion: 0,
    } });
    expect(stale).toMatchObject({ isError: true, content: [{ text: expect.stringContaining("stale_version") }] });
    const missing = await client.callTool({ name: "get_game_state", arguments: { gameId: "missing" } });
    expect(missing).toMatchObject({ isError: true, content: [{ text: expect.stringContaining("not_found") }] });
    const reset = await client.callTool({ name: "reset_game", arguments: { gameId: snapshot.gameId } });
    expect(reset.structuredContent).toMatchObject({ gameId: snapshot.gameId, stateVersion: 0, moveHistory: [] });
    const invalid = await client.callTool({ name: "get_game_state", arguments: { gameId: "" } });
    expect(invalid.isError).toBe(true);

    const resource = await client.readResource({ uri: WIDGET_RESOURCE_URI });
    expect(resource.contents[0]).toMatchObject({
      uri: WIDGET_RESOURCE_URI,
      mimeType: RESOURCE_MIME_TYPE,
      text: "<!doctype html><title>fixture</title>",
      _meta: {
        ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [] } },
        "openai/widgetDescription": WIDGET_DESCRIPTION,
      },
    });

    await Promise.all([client.close(), server.close()]);
  });
});
