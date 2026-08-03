import { afterEach, describe, expect, it, vi } from "vitest";
import { GameBridge } from "./bridge";

function host() { return { postMessage: vi.fn() } as unknown as Window; }
function reply(target: Window, id: number, result: unknown) { window.dispatchEvent(new MessageEvent("message", { source: target, data: { jsonrpc: "2.0", id, result } })); }
describe("GameBridge", () => {
  afterEach(() => vi.useRealTimers());
  it("initializes before sending a JSON-RPC tools/call envelope", async () => {
    const target = host(); const bridge = new GameBridge(target); const pending = bridge.callTool("get_game_state", { gameId: "g" });
    expect(target.postMessage).toHaveBeenCalledWith(expect.objectContaining({ jsonrpc: "2.0", id: 1, method: "ui/initialize", params: expect.objectContaining({ protocolVersion: "2026-01-26" }) }), "*");
    reply(target, 1, { hostCapabilities: { serverTools: {}, message: {} } }); await new Promise<void>(resolve => window.setTimeout(resolve, 0));
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
  it("uses the standalone REST fallback and never posts ui/message", async () => {
    const response = { ok: true, json: vi.fn().mockResolvedValue({ structuredContent: { gameId: "x" } }) }; vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    const bridge = new GameBridge(window); await expect(bridge.callTool("get_game_state", { gameId: "x" })).resolves.toEqual({ structuredContent: { gameId: "x" } });
    expect(fetch).toHaveBeenCalledWith("/api/tools/get_game_state", expect.objectContaining({ method: "POST" })); await bridge.sendMessage("never"); bridge.dispose();
  });
  it("applies host context and rejects message error acknowledgements", async () => {
    const target = host(); const bridge = new GameBridge(target); const sent = bridge.sendMessage("move"); reply(target, 1, { hostCapabilities: { serverTools: {}, message: {} }, hostContext: { theme: "light", styles: { variables: { "--color-text": "rgb(1,2,3)" } } } }); await new Promise<void>(resolve => window.setTimeout(resolve, 0)); reply(target, 2, { isError: true, content: [{ type: "text", text: "Denied" }] }); await expect(sent).rejects.toThrow("Denied"); expect(document.documentElement.dataset.theme).toBe("light"); expect(document.documentElement.style.getPropertyValue("--color-text")).toBe("rgb(1,2,3)"); window.dispatchEvent(new MessageEvent("message", { source: target, data: { jsonrpc: "2.0", method: "ui/notifications/host-context-changed", params: { theme: "dark", styles: { variables: { "--color-border": "red" } } } } })); expect(document.documentElement.dataset.theme).toBe("dark"); bridge.dispose();
  });
  it("rejects and clears pending requests on disposal", async () => { const target = host(); const bridge = new GameBridge(target); const pending = bridge.initialize(); bridge.dispose(); await expect(pending).rejects.toThrow("disposed"); });
});
