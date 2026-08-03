import type { ToolInput, ToolName, ToolResult } from "./types";

type RpcResponse = { jsonrpc: "2.0"; id?: number; result?: unknown; error?: { message?: string } ; method?: string; params?: unknown };
type Pending = { resolve: (value: unknown) => void; reject: (reason: Error) => void; timer: number };
export type ToolNotification = (result: ToolResult) => void;

/** Minimal host bridge: it deliberately uses postMessage rather than the optional window.openai shortcut. */
export class GameBridge {
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private initialized = false;
  private capabilities: { serverTools?: unknown; message?: unknown } = {};
  private initPromise?: Promise<void>;
  private listeners = new Set<ToolNotification>();
  private readonly onMessage = (event: MessageEvent) => this.receive(event);
  readonly embedded: boolean;

  constructor(private readonly target: Window = window.parent, private readonly timeoutMs = 15_000) {
    this.embedded = target !== window;
    if (this.embedded) window.addEventListener("message", this.onMessage);
  }

  async initialize(): Promise<void> {
    if (!this.embedded || this.initialized) return;
    this.initPromise ??= this.request("ui/initialize", { protocolVersion: "2026-01-26", appInfo: { name: "gpt-game-arena", version: "0.1.0" }, appCapabilities: {} }).then((result) => {
      this.capabilities = (result as { hostCapabilities?: { serverTools?: unknown; message?: unknown } })?.hostCapabilities ?? {};
      this.initialized = true;
      this.notify("ui/notifications/initialized", {});
    });
    return this.initPromise;
  }

  async callTool<N extends ToolName>(name: N, input: ToolInput[N]): Promise<ToolResult> {
    if (!this.embedded) return this.rest(name, input);
    await this.initialize();
    if (this.capabilities.serverTools === undefined) throw new Error("This host does not support game tools.");
    return this.request("tools/call", { name, arguments: input }) as Promise<ToolResult>;
  }

  async sendMessage(text: string): Promise<void> {
    if (!this.embedded) return;
    await this.initialize();
    if (this.capabilities.message === undefined) throw new Error("This host does not support messages.");
    await this.request("ui/message", { role: "user", content: [{ type: "text", text }] });
  }

  onToolResult(listener: ToolNotification): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  dispose(): void { window.removeEventListener("message", this.onMessage); for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error("Bridge disposed.")); } this.pending.clear(); this.listeners.clear(); }

  private request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => { this.pending.delete(id); reject(new Error("Host request timed out.")); }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.target.postMessage({ jsonrpc: "2.0", id, method, params }, "*");
    });
  }
  private notify(method: string, params: unknown): void { this.target.postMessage({ jsonrpc: "2.0", method, params }, "*"); }
  private receive(event: MessageEvent): void {
    if (event.source !== this.target || !isRpc(event.data)) return;
    const data = event.data;
    if (data.method === "ui/notifications/tool-result") { for (const listener of this.listeners) listener((data.params as { result?: ToolResult })?.result ?? data.params as ToolResult); return; }
    if (typeof data.id !== "number") return;
    const pending = this.pending.get(data.id); if (!pending) return;
    this.pending.delete(data.id); clearTimeout(pending.timer);
    if (data.error) pending.reject(new Error(data.error.message || "Host request failed.")); else pending.resolve(data.result);
  }
  private async rest<N extends ToolName>(name: N, input: ToolInput[N]): Promise<ToolResult> {
    let response: Response;
    try { response = await fetch(`/api/tools/${name}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }); } catch { throw new Error("Could not reach the local game service."); }
    const body = await response.json().catch(() => undefined) as ToolResult & { error?: { message?: string } } | undefined;
    if (!response.ok || !body || body.isError) throw new Error(body?.error?.message || body?.content?.[0]?.text || "Game service request failed.");
    return body;
  }
}
function isRpc(value: unknown): value is RpcResponse { return typeof value === "object" && value !== null && (value as { jsonrpc?: unknown }).jsonrpc === "2.0"; }
