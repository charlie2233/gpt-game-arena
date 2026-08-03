import { readFile } from "node:fs/promises";

import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AnySchema } from "@modelcontextprotocol/sdk/server/zod-compat.js";

import {
  executeTool,
  isGameRuleError,
  mcpGameSnapshotSchema,
  mcpToolInputSchemas,
  toolInputSchemas,
  toToolFailure,
} from "./tool-contracts.js";
import { ToolService } from "./tool-service.js";

export const WIDGET_RESOURCE_URI = "ui://gpt-game-arena/v2/widget.html";
export const WIDGET_DESCRIPTION = "An interactive chess, Tic-Tac-Toe, Connect Four, or 9x9, 13x13, or 19x19 Go board for playing turn by turn against GPT.";
export type WidgetLoader = () => string | undefined | Promise<string | undefined>;

export interface McpServerOptions {
  loadWidgetHtml?: WidgetLoader;
}

export function createMcpServer(service: ToolService, options: McpServerOptions = {}): McpServer {
  const server = new McpServer({ name: "gpt-game-arena", version: "0.1.0" });
  const loadWidgetHtml = options.loadWidgetHtml ?? defaultWidgetLoader;

  registerAppResource(server, "GPT Game Arena", WIDGET_RESOURCE_URI, { mimeType: RESOURCE_MIME_TYPE }, async () => ({
    contents: [{
      uri: WIDGET_RESOURCE_URI,
      mimeType: RESOURCE_MIME_TYPE,
      text: await loadWidgetHtmlSafely(loadWidgetHtml),
      _meta: {
        ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [] } },
        "openai/widgetDescription": WIDGET_DESCRIPTION,
      },
    }],
  }));

  registerTool(server, service, "create_game", "Create game", "Use this when starting chess, Tic-Tac-Toe, Connect Four, or Go. Set difficulty to easy, medium, or hard; an omitted difficulty defaults to medium. For Go, set boardSize to 9, 13, or 19; an omitted boardSize defaults to 9.", {
    readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: false,
  }, { ui: { visibility: ["model", "app"] } });
  registerTool(server, service, "get_game_state", "Get game state", "Use this when you need the authoritative current game state.", {
    readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true,
  }, { ui: { visibility: ["model", "app"] } });
  registerTool(server, service, "play_game_move", "Play game move", "Use this when a player or GPT makes the next legal move.", {
    readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: false,
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
    outputSchema: mcpGameSnapshotSchema as unknown as AnySchema,
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
      if (isGameRuleError(error)) return toToolFailure(error);
      return { isError: true, content: [{ type: "text" as const, text: "internal_error: Internal server error." }] };
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
