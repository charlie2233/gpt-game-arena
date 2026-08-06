import { readFile } from "node:fs/promises";

import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AnySchema } from "@modelcontextprotocol/sdk/server/zod-compat.js";

import {
  executeTool,
  isGameRuleError,
  mcpGameSnapshotSummarySchema,
  mcpToolInputSchemas,
  toolInputSchemas,
  toToolFailure,
} from "./tool-contracts.js";
import { ToolService } from "./tool-service.js";

export const WIDGET_RESOURCE_URI = "ui://gpt-game-arena/v14/widget.html";
export const LEGACY_WIDGET_RESOURCE_URIS = ["ui://gpt-game-arena/v13/widget.html", "ui://gpt-game-arena/v12/widget.html", "ui://gpt-game-arena/v11/widget.html"] as const;
export const WIDGET_DESCRIPTION = "An interactive chess, Reversi, Tic-Tac-Toe, Connect Four, or 9x9, 13x13, or 19x19 Go board for playing turn by turn against GPT.";
export type WidgetLoader = () => string | undefined | Promise<string | undefined>;

export interface McpServerOptions {
  loadWidgetHtml?: WidgetLoader;
}

export function createMcpServer(service: ToolService, options: McpServerOptions = {}): McpServer {
  const server = new McpServer({ name: "gpt-game-arena", version: "0.1.0" });
  const loadWidgetHtml = options.loadWidgetHtml ?? defaultWidgetLoader;

  for (const resourceUri of [WIDGET_RESOURCE_URI, ...LEGACY_WIDGET_RESOURCE_URIS]) {
    registerWidgetResource(server, resourceUri, loadWidgetHtml);
  }

  registerTool(server, service, "create_game", "Create game", "Use this when starting chess, Reversi, Tic-Tac-Toe, Connect Four, or Go. Set difficulty to easy, medium, or hard; an omitted difficulty defaults to medium. For Go, set boardSize to 9, 13, or 19; an omitted boardSize defaults to 9.", {
    readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: false,
  }, { ui: { visibility: ["model", "app"] } });
  registerTool(server, service, "get_game_state", "Get game state", "Use this when you need the authoritative current game state.", {
    readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true,
  }, { ui: { visibility: ["model", "app"] } });
  registerTool(server, service, "play_game_move", "Play game move", "Use this when applying exactly one legal move with expectedResetEpoch and expectedVersion. Only claim that a move landed after a matching MOVE_CONFIRMED receipt. MOVE_NOT_APPLIED is definite; MOVE_CONFIRMATION_UNKNOWN requires a read-only state check and must never trigger a repeated mutation.", {
    readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: false,
  }, { ui: { visibility: ["model", "app"] } });
  registerTool(server, service, "end_game", "End game", "Use this when, and only when, the player explicitly confirms ending the active game. Supply confirmed true and the authoritative expectedResetEpoch and expectedVersion; only claim that it ended after a matching END_CONFIRMED receipt. END_NOT_APPLIED is definite; END_CONFIRMATION_UNKNOWN requires a read-only state check and must never trigger a repeated mutation.", {
    readOnlyHint: false, destructiveHint: true, openWorldHint: false, idempotentHint: false,
  }, { ui: { visibility: ["model", "app"] } });
  registerTool(server, service, "reset_game", "Reset game", "Use this when current game progress should be erased and reset.", {
    readOnlyHint: false, destructiveHint: true, openWorldHint: false, idempotentHint: false,
  }, { ui: { visibility: ["model", "app"] } });
  registerTool(server, service, "render_game", "Render game", "Use this when you need to display the current game board.", {
    readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true,
  }, {
    ui: { resourceUri: WIDGET_RESOURCE_URI, visibility: ["model"] },
    "openai/outputTemplate": WIDGET_RESOURCE_URI,
  });

  return server;
}

function registerWidgetResource(server: McpServer, resourceUri: string, loadWidgetHtml: WidgetLoader): void {
  registerAppResource(server, "GPT Game Arena", resourceUri, { mimeType: RESOURCE_MIME_TYPE }, async () => ({
    contents: [{
      uri: resourceUri,
      mimeType: RESOURCE_MIME_TYPE,
      text: await loadWidgetHtmlSafely(loadWidgetHtml),
      _meta: {
        ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [] } },
        "openai/widgetDescription": WIDGET_DESCRIPTION,
      },
    }],
  }));
}

function registerTool(
  server: McpServer,
  service: ToolService,
  name: keyof typeof toolInputSchemas,
  title: string,
  description: string,
  annotations: { readOnlyHint: boolean; destructiveHint: boolean; openWorldHint: boolean; idempotentHint: boolean },
  meta: Record<string, unknown>,
): void {
  registerAppTool(server, name, {
    title,
    description,
    inputSchema: mcpToolInputSchemas[name] as unknown as AnySchema,
    outputSchema: mcpGameSnapshotSummarySchema as unknown as AnySchema,
    annotations,
    _meta: {
      ...meta,
      "openai/toolInvocation/invoking": "Working…",
      "openai/toolInvocation/invoked": "Done.",
    },
  }, async (input: unknown) => {
    try {
      return executeTool(service, name, input);
    } catch (error) {
      const mutation = name === "play_game_move" ? "move" : name === "end_game" ? "end" : undefined;
      if (isGameRuleError(error)) return toToolFailure(error, mutation);
      const prefix = mutation === "move" ? "MOVE_CONFIRMATION_UNKNOWN " : mutation === "end" ? "END_CONFIRMATION_UNKNOWN " : "";
      return { isError: true, content: [{ type: "text" as const, text: `${prefix}internal_error: Internal server error.` }] };
    }
  });
}

export async function defaultWidgetLoader(): Promise<string | undefined> {
  try {
    return await readFile(new URL("../../web/dist/index.html", import.meta.url), "utf8");
  } catch {
    return undefined;
  }
}

export function missingWidgetHtml(): string {
  return "<!doctype html><html><body><p>Build the widget first with npm run build --workspace web.</p></body></html>";
}

async function loadWidgetHtmlSafely(loadWidgetHtml: WidgetLoader): Promise<string> {
  try {
    return (await loadWidgetHtml()) ?? missingWidgetHtml();
  } catch {
    return missingWidgetHtml();
  }
}
