import express, { type NextFunction, type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ZodError } from "zod";

import { createMcpServer, defaultWidgetLoader, type WidgetLoader } from "./mcp-server.js";
import { executeTool, isGameRuleError, isToolOutputError, toolInputSchemas, type ToolName } from "./tool-contracts.js";
import { ToolService } from "./tool-service.js";

interface RateLimitOptions {
  limit?: number;
  windowMs?: number;
  maxBuckets?: number;
}

export interface HttpAppOptions {
  loadWidgetHtml?: WidgetLoader;
  widgetDomain?: string;
  openAiAppsChallengeToken?: string;
  now?: () => number;
  apiToolsRateLimit?: RateLimitOptions;
  mcpRateLimit?: RateLimitOptions;
}

interface RateBucket { windowStart: number; count: number }

const UNSUPPORTED_MEDIA_ERROR_CODE = -32015;

export class FixedWindowLimiter {
  private readonly buckets = new Map<string, RateBucket>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly maxBuckets: number;
  private readonly now: () => number;

  constructor(options: RateLimitOptions, now: () => number) {
    this.limit = positiveSafeInteger(options.limit ?? 60, "limit");
    this.windowMs = positiveSafeInteger(options.windowMs ?? 60_000, "windowMs");
    this.maxBuckets = positiveSafeInteger(options.maxBuckets ?? 1_000, "maxBuckets");
    this.now = now;
  }

  consume(ip: string): { allowed: boolean; retryAfterSeconds: number } {
    const now = nonnegativeSafeInteger(this.now(), "clock");
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
  app.use("/api/tools", rateLimitMiddleware(apiLimiter, "rest"));
  app.use("/mcp", rateLimitMiddleware(mcpLimiter, "mcp"));
  app.use(express.json({ limit: "32kb" }));

  app.get("/health", (_, response) => response.status(200).json({ ok: true }));
  app.get("/ready", async (_, response) => {
    try {
      const html = await loadWidgetHtml();
      if (html === undefined) throw new Error("Widget build unavailable.");
      response.status(200).json({ ready: true });
    } catch {
      response.status(503).json({ ready: false });
    }
  });
  app.get("/.well-known/openai-apps-challenge", (_, response) => {
    if (options.openAiAppsChallengeToken === undefined) {
      response.status(404).type("text/plain").send("Not found.");
      return;
    }
    response.setHeader("Cache-Control", "no-store");
    response.status(200).type("text/plain").send(options.openAiAppsChallengeToken);
  });
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
    const name = request.params.name ?? "";
    if (!isToolName(name)) {
      response.status(404).json({ error: { code: "not_found", message: "Tool was not found." } });
      return;
    }
    try {
      const result = executeTool(service, name, request.body);
      response.status(200).json(result);
    } catch (error) {
      if (isToolOutputError(error)) {
        response.status(500).json({ error: { code: "internal_error", message: "Internal server error." } });
        return;
      }
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
    const server = createMcpServer(service, { loadWidgetHtml, widgetDomain: options.widgetDomain });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    let cleanupPromise: Promise<void> | undefined;
    const close = (): Promise<void> => cleanupPromise ??= Promise.allSettled([transport.close(), server.close()]).then(() => undefined);
    response.once("close", () => { void close(); });
    try {
      await server.connect(transport);
      await transport.handleRequest(request, response, request.body);
    } catch {
      if (!response.headersSent) {
        response.status(500).json({ jsonrpc: "2.0", id: null, error: { code: -32603, message: "Internal server error." } });
      }
      await close();
    }
  });

  app.use((error: unknown, request: Request, response: Response, next: NextFunction) => {
    if (response.headersSent) return next(error);
    if (isUnsupportedMediaError(error)) {
      if (request.path === "/mcp") {
        response.status(415).json({
          jsonrpc: "2.0",
          id: null,
          error: { code: UNSUPPORTED_MEDIA_ERROR_CODE, message: "Unsupported JSON media type." },
        });
        return;
      }
      response.status(415).json({ error: { code: "unsupported_media_type", message: "Unsupported JSON media type." } });
      return;
    }
    if (request.path === "/mcp" && (isPayloadTooLarge(error) || isJsonParseError(error))) {
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
    if (isJsonParseError(error)) {
      response.status(400).json({ error: { code: "invalid_json", message: "Invalid JSON request body." } });
      return;
    }
    if (request.path === "/mcp") {
      response.status(500).json({ jsonrpc: "2.0", id: null, error: { code: -32603, message: "Internal server error." } });
      return;
    }
    response.status(500).json({ error: { code: "internal_error", message: "Internal server error." } });
  });

  return app;
}

function isToolName(name: string): name is ToolName {
  return Object.prototype.hasOwnProperty.call(toolInputSchemas, name);
}

function retryAfter(windowStart: number, windowMs: number, now: number): number {
  return Math.max(1, Math.ceil((windowStart + windowMs - now) / 1_000));
}

function rateLimitMiddleware(limiter: FixedWindowLimiter, kind: "rest" | "mcp") {
  return (request: Request, response: Response, next: NextFunction): void => {
    // Use the direct peer IP. Deployments behind proxies must configure an explicit trusted-proxy policy.
    const limit = limiter.consume(request.ip ?? "unknown");
    if (limit.allowed) return next();
    response.setHeader("Retry-After", String(limit.retryAfterSeconds));
    if (kind === "mcp") {
      response.status(429).json({ jsonrpc: "2.0", id: null, error: { code: -32029, message: "Too many requests." } });
      return;
    }
    response.status(429).json({ error: { code: "rate_limited", message: "Too many requests." } });
  };
}

function positiveSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive safe integer.`);
  return value;
}

function nonnegativeSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} must be a nonnegative safe integer.`);
  return value;
}

function isPayloadTooLarge(error: unknown): boolean {
  return typeof error === "object" && error !== null && "type" in error && error.type === "entity.too.large";
}

function isJsonParseError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "type" in error && error.type === "entity.parse.failed";
}

function isUnsupportedMediaError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "type" in error
    && "status" in error
    && error.status === 415
    && (error.type === "charset.unsupported" || error.type === "encoding.unsupported");
}
