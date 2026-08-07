import { describe, expect, it } from "vitest";

import {
  createJsonLineTelemetry,
  elapsedMilliseconds,
  normalizeHttpMethod,
  recordOperationalEvent,
  type OperationalEvent,
} from "../src/telemetry.js";

describe("operational telemetry", () => {
  it("serializes only the allowlisted request and tool fields", () => {
    const lines: string[] = [];
    const telemetry = createJsonLineTelemetry(line => lines.push(line));

    telemetry.record({
      event: "http_request",
      surface: "mcp",
      method: "POST",
      status: 200,
      durationMs: 12.6,
      mcpOperation: "tools/call",
      gameId: "SECRET_GAME_ID",
      requestBody: "SECRET_REQUEST_BODY",
    } as unknown as OperationalEvent);
    telemetry.record({
      event: "tool_call",
      transport: "rest",
      tool: "play_game_move",
      outcome: "rejected",
      durationMs: Number.POSITIVE_INFINITY,
      move: "SECRET_MOVE",
      error: "SECRET_ERROR",
    } as unknown as OperationalEvent);

    expect(lines.map(line => JSON.parse(line))).toEqual([
      {
        schemaVersion: 1,
        event: "http_request",
        surface: "mcp",
        method: "POST",
        status: 200,
        durationMs: 13,
        mcpOperation: "tools/call",
      },
      {
        schemaVersion: 1,
        event: "tool_call",
        transport: "rest",
        tool: "play_game_move",
        outcome: "rejected",
        durationMs: 0,
      },
    ]);
    expect(lines.join("\n")).not.toContain("SECRET");
  });

  it("bounds methods and durations to low-cardinality safe values", () => {
    expect(normalizeHttpMethod("get")).toBe("GET");
    expect(normalizeHttpMethod("POST")).toBe("POST");
    expect(normalizeHttpMethod("SECRET_METHOD")).toBe("OTHER");
    expect(elapsedMilliseconds(10, 17.7)).toBe(8);
    expect(elapsedMilliseconds(20, 10)).toBe(0);
    expect(elapsedMilliseconds(0, Number.NaN)).toBe(0);
  });

  it("never lets a logging adapter failure interrupt the caller", () => {
    const event: OperationalEvent = { event: "server_lifecycle", phase: "started" };
    expect(() => createJsonLineTelemetry(() => { throw new Error("writer unavailable"); }).record(event)).not.toThrow();
    expect(() => recordOperationalEvent({ record: () => { throw new Error("adapter unavailable"); } }, event)).not.toThrow();
  });
});
