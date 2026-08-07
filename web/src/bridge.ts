import type { ToolInput, ToolName, ToolResult } from "./types";

type RpcResponse = { jsonrpc: "2.0"; id?: number; result?: unknown; error?: { message?: string } ; method?: string; params?: unknown };
type Pending = { resolve: (value: unknown) => void; reject: (reason: Error) => void; timer: number };
export type ToolNotification = (result: ToolResult) => void;
export type HostContextNotification = (context: unknown) => void;
type ChatGptFollowUpHost = { sendFollowUpMessage?: (input: { prompt: string; scrollToBottom?: boolean }) => void | Promise<void> };

/** Minimal portable bridge, with ChatGPT's optional no-scroll follow-up extension. */
export class GameBridge {
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private initialized = false;
  private disposed = false;
  private listening = false;
  private capabilities: { serverTools?: unknown; message?: unknown } = {};
  private initPromise?: Promise<void>;
  private listeners = new Set<ToolNotification>();
  private contextListeners = new Set<HostContextNotification>();
  private readonly onMessage = (event: MessageEvent) => this.receive(event);
  readonly embedded: boolean;

  constructor(private readonly target: Window = window.parent, private readonly timeoutMs = 15_000) {
    this.embedded = target !== window;
  }

  async initialize(): Promise<void> {
    if (!this.embedded || this.initialized) return;
    if (this.disposed) throw new Error("Bridge disposed.");
    this.ensureListening();
    this.initPromise ??= this.request("ui/initialize", { protocolVersion: "2026-01-26", appInfo: { name: "gpt-game-arena", version: "0.2.0" }, appCapabilities: {} }).then((result) => {
      const host = result as { hostCapabilities?: { serverTools?: unknown; message?: unknown }; hostContext?: unknown };
      this.capabilities = host?.hostCapabilities ?? {}; this.applyHostContext(host?.hostContext);
      this.initialized = true;
      this.notify("ui/notifications/initialized", {});
    }).catch((error: unknown) => { this.initPromise = undefined; throw error; });
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
    const openai = (window as Window & { openai?: ChatGptFollowUpHost }).openai;
    if (typeof openai?.sendFollowUpMessage === "function") {
      await openai.sendFollowUpMessage({ prompt: text, scrollToBottom: false });
      return;
    }
    if (this.capabilities.message === undefined) throw new Error("This host does not support messages.");
    const acknowledgement = await this.request("ui/message", { role: "user", content: [{ type: "text", text }] }) as ToolResult;
    if (acknowledgement?.isError) throw new Error(acknowledgement.content?.[0]?.text || "The host could not send the message.");
  }

  onToolResult(listener: ToolNotification): () => void { this.ensureListening(); this.listeners.add(listener); return () => this.listeners.delete(listener); }
  onHostContext(listener: HostContextNotification): () => void { this.ensureListening(); this.contextListeners.add(listener); return () => this.contextListeners.delete(listener); }
  dispose(): void { this.disposed = true; if (this.listening) window.removeEventListener("message", this.onMessage); this.listening = false; for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error("Bridge disposed.")); } this.pending.clear(); this.listeners.clear(); this.contextListeners.clear(); }

  private request(method: string, params: unknown): Promise<unknown> {
    if (this.disposed) return Promise.reject(new Error("Bridge disposed."));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => { this.pending.delete(id); reject(new Error("Host request timed out.")); }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.target.postMessage({ jsonrpc: "2.0", id, method, params }, "*");
    });
  }
  private ensureListening(): void { if (this.embedded && !this.disposed && !this.listening) { window.addEventListener("message", this.onMessage); this.listening = true; } }
  private notify(method: string, params: unknown): void { this.target.postMessage({ jsonrpc: "2.0", method, params }, "*"); }
  private receive(event: MessageEvent): void {
    if (event.source !== this.target || !isRpc(event.data)) return;
    const data = event.data;
    if (data.method === "ui/notifications/tool-result") { for (const listener of this.listeners) listener((data.params as { result?: ToolResult })?.result ?? data.params as ToolResult); return; }
    if (data.method === "ui/notifications/host-context-changed") { this.applyHostContext(data.params); return; }
    if (data.method !== undefined || typeof data.id !== "number") return;
    const pending = this.pending.get(data.id); if (!pending) return;
    this.pending.delete(data.id); clearTimeout(pending.timer);
    if (data.error) pending.reject(new Error(data.error.message || "Host request failed.")); else pending.resolve(data.result);
  }
  private applyHostContext(context: unknown): void { const c = context as { theme?: unknown; styles?: { variables?: Record<string, unknown> }; style?: Record<string, unknown> }; const theme = c?.theme; if (theme === "light" || theme === "dark") { document.documentElement.dataset.theme = theme; document.documentElement.style.colorScheme = theme; } const variables = c?.styles?.variables ?? c?.style; if (variables && typeof variables === "object") for (const [key, value] of Object.entries(variables)) if (/^--[a-z0-9-]+$/i.test(key) && typeof value === "string") document.documentElement.style.setProperty(key, value); for (const listener of this.contextListeners) listener(context); }
  private async rest<N extends ToolName>(name: N, input: ToolInput[N]): Promise<ToolResult> {
    let response: Response;
    try { response = await fetch(`/api/tools/${name}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }); } catch { throw new Error("Could not reach the local game service."); }
    const body = await response.json().catch(() => undefined) as ToolResult & { error?: { code?: string; message?: string } } | undefined;
    if (!response.ok || !body || body.isError) {
      const message = body?.error?.message || body?.content?.[0]?.text || "Game service request failed.";
      throw new Error(body?.error?.code ? `${body.error.code}: ${message}` : message);
    }
    return body;
  }
}
function isRpc(value: unknown): value is RpcResponse { return typeof value === "object" && value !== null && (value as { jsonrpc?: unknown }).jsonrpc === "2.0"; }
