import type { ToolName } from "./tool-contracts.js";

export type ToolCallOutcome = "success" | "rejected" | "error";
export type HttpSurface = "health" | "ready" | "challenge" | "preview" | "rest-tools" | "mcp" | "other";
export type McpOperation = "initialize" | "tools/list" | "tools/call" | "resources/read" | "other";
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS" | "HEAD" | "OTHER";

export type OperationalEvent =
  | {
    event: "http_request";
    surface: HttpSurface;
    method: HttpMethod;
    status: number;
    durationMs: number;
    mcpOperation?: McpOperation;
  }
  | {
    event: "tool_call";
    transport: "mcp" | "rest";
    tool: ToolName;
    outcome: ToolCallOutcome;
    durationMs: number;
  }
  | {
    event: "server_lifecycle";
    phase: "started" | "stopping" | "stopped" | "error";
  };

export interface OperationalTelemetry {
  record(event: OperationalEvent): void;
}

export function createJsonLineTelemetry(
  write: (line: string) => void = line => console.log(line),
): OperationalTelemetry {
  return {
    record(event) {
      const safeEvent = event.event === "http_request"
        ? {
          schemaVersion: 1,
          event: event.event,
          surface: event.surface,
          method: event.method,
          status: event.status,
          durationMs: normalizeDuration(event.durationMs),
          ...(event.mcpOperation === undefined ? {} : { mcpOperation: event.mcpOperation }),
        }
        : event.event === "tool_call"
          ? {
            schemaVersion: 1,
            event: event.event,
            transport: event.transport,
            tool: event.tool,
            outcome: event.outcome,
            durationMs: normalizeDuration(event.durationMs),
          }
          : {
            schemaVersion: 1,
            event: event.event,
            phase: event.phase,
          };
      try {
        write(JSON.stringify(safeEvent));
      } catch {
        // Operational logging must never interrupt a game request.
      }
    },
  };
}

export function recordOperationalEvent(
  telemetry: OperationalTelemetry | undefined,
  event: OperationalEvent,
): void {
  try {
    telemetry?.record(event);
  } catch {
    // Custom telemetry adapters are also isolated from the request path.
  }
}

export function normalizeHttpMethod(method: string): HttpMethod {
  switch (method.toUpperCase()) {
    case "GET":
    case "POST":
    case "PUT":
    case "PATCH":
    case "DELETE":
    case "OPTIONS":
    case "HEAD":
      return method.toUpperCase() as HttpMethod;
    default:
      return "OTHER";
  }
}

export function elapsedMilliseconds(startedAt: number, now: number): number {
  return normalizeDuration(now - startedAt);
}

function normalizeDuration(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}
