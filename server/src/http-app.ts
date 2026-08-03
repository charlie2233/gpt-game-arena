import express, { type NextFunction, type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ZodError } from "zod";

import { createMcpServer, defaultWidgetLoader, type WidgetLoader } from "./mcp-server.js";
import { executeTool, isGameRuleError, toolInputSchemas, type ToolName } from "./tool-contracts.js";
import { ToolService } from "./tool-service.js";

interface RateLimitOptions {
  limit?: number;
  windowMs?: number;
  maxBuckets?: number;
}

export interface HttpAppOptions {
  loadWidgetHtml?: WidgetLoader;
  now?: () => number;
  apiToolsRateLimit?: RateLimitOptions;
  mcpRateLimit?: RateLimitOptions;
}

interface RateBucket { windowStart: number; count: number }

export class FixedWindowLimiter {
  private readonly buckets = new Map<string, RateBucket>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly maxBuckets: number;
  private readonly now: () => number;

  constructor(options: RateLimitOptions, now: () => number) {
    this.limit = options.limit ?? 60;
    this.windowMs = options.windowMs ?? 60_000;
    this.maxBuckets = options.maxBuckets ?? 1_000;
    this.now = now;
  }

  consume(ip: string): { allowed: boolean; retryAfterSeconds: number } {
    const now = this.now();
    this.prune(now);
    const windowStart = Math.floor(now / this.windowMs) * this.windowMs;
    const current = this.buckets.get(ip);
    if (current && current.windowStart === windowStart) {
      if (current.count >= this.limit) return { allowed: false, retryAfterSeconds: retryAfter(windowStart, this.windowMs, now) };
      current.count += 1;
      return { allowed: true, retryAfterSeconds: 0 };
    }
    if (!current && this.buckets.size >= this.maxBuckets) {
      return { allowed: false, retryAfterSeconds: retryAfter(windowStart, this.windowMs, now) };
    }
    this.buckets.set(ip, { windowStart, count: 1 });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  bucketCount(): number {
    return this.buckets.size;
  }

  private prune(now: number): void {
    for (const [ip, bucket] of this.buckets) {
      if (now >= bucket.windowStart + this.windowMs) this.buckets.delete(ip);
    }
  }
}

export function createHttpApp(service: ToolService, options: HttpAppOptions = {}) {
  const app = express();
  const now = options.now ?? Date.now;
  const loadWidgetHtml = options.loadWidgetHtml ?? defaultWidgetLoader;
  const apiLimiter = new FixedWindowLimiter(options.apiToolsRateLimit ?? {}, now);
  const mcpLimiter = new FixedWindowLimiter({ limit: 120, ...options.mcpRateLimit }, now);

  app.disable("x-powered-by");
  app.use((_, response, next) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    );
    next();
  });
  app.use(express.json({ limit: "32kb" }));

  app.get("/health", (_, response) => response.status(200).json({ ok: true }));
  app.get("/preview", async (_, response) => {
    let html: string | undefined;
    try {
      html = await loadWidgetHtml();
    } catch {
      html = undefined;
    }
    if (html === undefined) {
      response.status(503).type("text/plain").send("Widget build is unavailable. Run npm run build --workspace web.");
      return;
    }
    response.status(200).type("html").send(html);
  });

  app.post("/api/tools/:name", (request, response) => {
    const limit = apiLimiter.consume(request.ip ?? "unknown");
    if (!limit.allowed) {
      response.setHeader("Retry-After", String(limit.retryAfterSeconds));
      response.status(429).json({ error: { code: "rate_limited", message: "Too many requests." } });
      return;
    }
    const name = request.params.name ?? "";
    if (!isToolName(name)) {
      response.status(404).json({ error: { code: "not_found", message: "Tool was not found." } });
      return;
    }
    try {
      const result = executeTool(service, name, request.body);
      response.status(200).json(result);
    } catch (error) {
      if (error instanceof ZodError) {
        response.status(400).json({ error: { code: "invalid_input", message: "Invalid tool input." } });
        return;
      }
      if (isGameRuleError(error)) {
        response.status(409).json({ error: { code: error.code, message: "The requested game operation could not be completed." } });
        return;
      }
      response.status(500).json({ error: { code: "internal_error", message: "Internal server error." } });
    }
  });

  app.all("/mcp", async (request, response) => {
    const limit = mcpLimiter.consume(request.ip ?? "unknown");
    if (!limit.allowed) {
      response.setHeader("Retry-After", String(limit.retryAfterSeconds));
      response.status(429).json({ jsonrpc: "2.0", id: null, error: { code: -32029, message: "Too many requests." } });
      return;
    }
    const server = createMcpServer(service, { loadWidgetHtml });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    const close = (): void => { void transport.close(); void server.close(); };
    response.once("close", close);
    try {
      await server.connect(transport);
      await transport.handleRequest(request, response, request.body);
    } catch {
      if (!response.headersSent) {
        response.status(500).json({ jsonrpc: "2.0", id: null, error: { code: -32603, message: "Internal server error." } });
      }
      close();
    }
  });

  app.use((error: unknown, request: Request, response: Response, next: NextFunction) => {
    if (response.headersSent) return next(error);
    if (request.path === "/mcp") {
      response.status(isPayloadTooLarge(error) ? 413 : 400).json({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error." },
      });
      return;
    }
    if (isPayloadTooLarge(error)) {
      response.status(413).json({ error: { code: "payload_too_large", message: "Request body is too large." } });
      return;
    }
    response.status(400).json({ error: { code: "invalid_json", message: "Invalid JSON request body." } });
  });

  return app;
}

function isToolName(name: string): name is ToolName {
  return Object.prototype.hasOwnProperty.call(toolInputSchemas, name);
}

function retryAfter(windowStart: number, windowMs: number, now: number): number {
  return Math.max(1, Math.ceil((windowStart + windowMs - now) / 1_000));
}

function isPayloadTooLarge(error: unknown): boolean {
  return typeof error === "object" && error !== null && "type" in error && error.type === "entity.too.large";
}
