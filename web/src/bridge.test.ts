import { afterEach, describe, expect, it, vi } from "vitest";
import { GameBridge } from "./bridge";

function host() { return { postMessage: vi.fn() } as unknown as Window; }
function reply(target: Window, id: number, result: unknown) { window.dispatchEvent(new MessageEvent("message", { source: target, data: { jsonrpc: "2.0", id, result } })); }
function validInit(overrides: Record<string, unknown> = {}) {
  return { protocolVersion: "2026-01-26", hostInfo: { name: "test-host", version: "1.0.0" }, hostCapabilities: { serverTools: {}, message: {} }, hostContext: {}, ...overrides };
}
describe("GameBridge", () => {
  afterEach(() => { vi.useRealTimers(); Reflect.deleteProperty(window, "openai"); });
  it("initializes before sending a JSON-RPC tools/call envelope", async () => {
    const target = host(); const bridge = new GameBridge(target); const pending = bridge.callTool("get_game_state", { gameId: "g" });
    expect(target.postMessage).toHaveBeenCalledWith(expect.objectContaining({ jsonrpc: "2.0", id: 1, method: "ui/initialize", params: expect.objectContaining({ protocolVersion: "2026-01-26", appInfo: { name: "gpt-game-arena", version: "0.2.0" } }) }), "*");
    reply(target, 1, validInit()); await new Promise<void>(resolve => window.setTimeout(resolve, 0));
    expect(target.postMessage).toHaveBeenCalledWith(expect.objectContaining({ method: "ui/notifications/initialized" }), "*");
    expect(target.postMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 2, method: "tools/call", params: { name: "get_game_state", arguments: { gameId: "g" } } }), "*");
    reply(target, 2, { structuredContent: { kind: "chess" } }); await expect(pending).resolves.toEqual({ structuredContent: { kind: "chess" } }); bridge.dispose();
  });
  it("rejects foreign, malformed and late responses and cleans timeouts", async () => {
    vi.useFakeTimers(); const target = host(); const bridge = new GameBridge(target, 10); const request = bridge.initialize();
    window.dispatchEvent(new MessageEvent("message", { source: window, data: { jsonrpc: "2.0", id: 1, result: {} } }));
    window.dispatchEvent(new MessageEvent("message", { source: target, data: {} })); vi.advanceTimersByTime(10); await expect(request).rejects.toThrow("timed out");
    reply(target, 1, {}); bridge.dispose();
  });
  it("delivers tool-result notifications only from its parent", () => {
    const target = host(); const bridge = new GameBridge(target); const seen = vi.fn(); bridge.onToolResult(seen);
    window.dispatchEvent(new MessageEvent("message", { source: window, data: { jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { marker: "foreign" } } }));
    window.dispatchEvent(new MessageEvent("message", { source: target, data: { jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { marker: "accepted" } } }));
    expect(seen).toHaveBeenCalledWith({ marker: "accepted" }); bridge.dispose();
  });
  it("delivers exact parent tool input arguments and supports unsubscribe", () => {
    const target = host(); const bridge = new GameBridge(target); const seen = vi.fn(); const unsubscribe = bridge.onToolInput(seen);
    window.dispatchEvent(new MessageEvent("message", { source: window, data: { jsonrpc: "2.0", method: "ui/notifications/tool-input", params: { arguments: { gameId: "foreign" } } } }));
    const accepted = { gameId: "accepted", nested: { exact: true } };
    window.dispatchEvent(new MessageEvent("message", { source: target, data: { jsonrpc: "2.0", method: "ui/notifications/tool-input", params: { arguments: accepted } } }));
    expect(seen).toHaveBeenCalledTimes(1); expect(seen).toHaveBeenCalledWith(accepted);
    unsubscribe();
    window.dispatchEvent(new MessageEvent("message", { source: target, data: { jsonrpc: "2.0", method: "ui/notifications/tool-input", params: { arguments: { gameId: "late" } } } }));
    expect(seen).toHaveBeenCalledTimes(1); bridge.dispose();
  });
  it("delivers parent cancellation reasons, ignores foreign events, and clears listeners on dispose", () => {
    const target = host(); const bridge = new GameBridge(target); const seen = vi.fn(); bridge.onToolCancelled(seen);
    window.dispatchEvent(new MessageEvent("message", { source: window, data: { jsonrpc: "2.0", method: "ui/notifications/tool-cancelled", params: { reason: "foreign" } } }));
    window.dispatchEvent(new MessageEvent("message", { source: target, data: { jsonrpc: "2.0", method: "ui/notifications/tool-cancelled", params: { reason: "user action" } } }));
    window.dispatchEvent(new MessageEvent("message", { source: target, data: { jsonrpc: "2.0", method: "ui/notifications/tool-cancelled", params: {} } }));
    expect(seen.mock.calls).toEqual([["user action"], [undefined]]);
    bridge.dispose();
    window.dispatchEvent(new MessageEvent("message", { source: target, data: { jsonrpc: "2.0", method: "ui/notifications/tool-cancelled", params: { reason: "late" } } }));
    expect(seen).toHaveBeenCalledTimes(2);
  });
  it.each([
    {},
    { protocolVersion: "2025-11-21", hostInfo: { name: "host", version: "1" }, hostCapabilities: {}, hostContext: {} },
    { protocolVersion: "2026-01-26", hostInfo: {}, hostCapabilities: {}, hostContext: {} },
    { protocolVersion: "2026-01-26", hostInfo: { name: "host", version: "1" }, hostCapabilities: null, hostContext: {} },
    { protocolVersion: "2026-01-26", hostInfo: { name: "host", version: "1" }, hostCapabilities: {}, hostContext: null },
  ])("rejects malformed initialization without announcing initialized %#", async (result) => {
    const target = host(); const bridge = new GameBridge(target); const pending = bridge.initialize(); reply(target, 1, result);
    await expect(pending).rejects.toThrow("invalid initialization");
    expect(target.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ method: "ui/notifications/initialized" }), "*");
    bridge.dispose();
  });
  it("uses the standalone REST fallback and never posts ui/message", async () => {
    const response = { ok: true, json: vi.fn().mockResolvedValue({ structuredContent: { gameId: "x" } }) }; vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    const bridge = new GameBridge(window); await expect(bridge.callTool("get_game_state", { gameId: "x" })).resolves.toEqual({ structuredContent: { gameId: "x" } });
    expect(fetch).toHaveBeenCalledWith("/api/tools/get_game_state", expect.objectContaining({ method: "POST" })); await bridge.sendMessage("never"); bridge.dispose();
  });
  it("applies host context and rejects message error acknowledgements", async () => {
    const target = host(); const bridge = new GameBridge(target); const sent = bridge.sendMessage("move"); reply(target, 1, validInit({ hostContext: { theme: "light", styles: { variables: { "--color-text": "rgb(1,2,3)" } } } })); await new Promise<void>(resolve => window.setTimeout(resolve, 0)); reply(target, 2, { isError: true, content: [{ type: "text", text: "Denied" }] }); await expect(sent).rejects.toThrow("Denied"); expect(document.documentElement.dataset.theme).toBe("light"); expect(document.documentElement.style.getPropertyValue("--color-text")).toBe("rgb(1,2,3)"); window.dispatchEvent(new MessageEvent("message", { source: target, data: { jsonrpc: "2.0", method: "ui/notifications/host-context-changed", params: { theme: "dark", styles: { variables: { "--color-border": "red" } } } } })); expect(document.documentElement.dataset.theme).toBe("dark"); bridge.dispose();
  });
  it("uses ChatGPT's no-scroll follow-up without also posting ui/message", async () => {
    const sendFollowUpMessage = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, "openai", { configurable: true, value: { sendFollowUpMessage } });
    const target = host(); const bridge = new GameBridge(target); const sent = bridge.sendMessage("move quickly");
    reply(target, 1, validInit());
    await expect(sent).resolves.toBeUndefined();
    expect(sendFollowUpMessage).toHaveBeenCalledWith({ prompt: "move quickly", scrollToBottom: false });
    const messageCalls = (target.postMessage as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(([request]) => (request as { method?: string }).method === "ui/message");
    expect(messageCalls).toHaveLength(0);
    bridge.dispose();
  });
  it("does not duplicate a rejected ChatGPT follow-up through ui/message", async () => {
    const sendFollowUpMessage = vi.fn().mockRejectedValue(new Error("host rejected"));
    Object.defineProperty(window, "openai", { configurable: true, value: { sendFollowUpMessage } });
    const target = host(); const bridge = new GameBridge(target); const sent = bridge.sendMessage("once");
    reply(target, 1, validInit());
    await expect(sent).rejects.toThrow("host rejected");
    expect((target.postMessage as unknown as ReturnType<typeof vi.fn>).mock.calls.some(([request]) => (request as { method?: string }).method === "ui/message")).toBe(false);
    bridge.dispose();
  });
  it("rejects and clears pending requests on disposal", async () => { const target = host(); const bridge = new GameBridge(target); const pending = bridge.initialize(); bridge.dispose(); await expect(pending).rejects.toThrow("disposed"); });
  it("retries failed initialization and ignores method-bearing id collisions", async () => { const target = host(); const bridge = new GameBridge(target); const first = bridge.initialize(); window.dispatchEvent(new MessageEvent("message", { source: target, data: { jsonrpc: "2.0", id: 1, error: { message: "no" } } })); await expect(first).rejects.toThrow("no"); const retry = bridge.initialize(); expect(target.postMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 2, method: "ui/initialize" }), "*"); window.dispatchEvent(new MessageEvent("message", { source: target, data: { jsonrpc: "2.0", id: 2, method: "host/request", result: {} } })); bridge.dispose(); await expect(retry).rejects.toThrow("disposed"); const count = (target.postMessage as unknown as ReturnType<typeof vi.fn>).mock.calls.length; await expect(bridge.initialize()).rejects.toThrow("disposed"); expect((target.postMessage as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(count); });
});
