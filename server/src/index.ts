import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createHttpApp } from "./http-app.js";
import { GameStore } from "./game-store.js";
import {
  gameStoreRuntimeOptionsFromEnvironment,
  publicAppRuntimeOptionsFromEnvironment,
} from "./runtime-config.js";
import { createJsonLineTelemetry, recordOperationalEvent } from "./telemetry.js";
import { ToolService } from "./tool-service.js";

function portFromEnvironment(value: string | undefined): number {
  if (value === undefined) return 8000;
  if (!/^\d+$/.test(value)) throw new Error("PORT must be an integer between 1 and 65535.");
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("PORT must be an integer between 1 and 65535.");
  return port;
}

const telemetry = process.env.NODE_ENV === "production" ? createJsonLineTelemetry() : undefined;

try {
  const port = portFromEnvironment(process.env.PORT);
  const defaultStorePath = fileURLToPath(new URL("../../.data/game-sessions.json", import.meta.url));
  const configuredStorePath = process.env.GAME_STORE_PATH;
  const storePath = configuredStorePath === undefined ? defaultStorePath : resolve(configuredStorePath);
  const runtimeOptions = gameStoreRuntimeOptionsFromEnvironment(process.env);
  const publicAppOptions = publicAppRuntimeOptionsFromEnvironment(process.env);
  const service = new ToolService(new GameStore({ persistencePath: storePath, ...runtimeOptions }));
  const app = createHttpApp(
    service,
    { ...publicAppOptions, telemetry },
  );
  const listener = app.listen(port, "0.0.0.0", () => {
    if (telemetry === undefined) {
      console.log(`Preview: http://localhost:${port}/preview`);
      console.log(`MCP: http://localhost:${port}/mcp`);
    } else {
      recordOperationalEvent(telemetry, { event: "server_lifecycle", phase: "started" });
    }
  });
  listener.on("error", () => {
    if (telemetry === undefined) console.error("Server could not start.");
    else recordOperationalEvent(telemetry, { event: "server_lifecycle", phase: "error" });
    process.exitCode = 1;
  });
  const sweepTimer = setInterval(() => {
    try {
      service.sweepExpired();
    } catch {
      if (telemetry === undefined) console.error("Expired game cleanup could not complete.");
      else recordOperationalEvent(telemetry, { event: "server_lifecycle", phase: "error" });
    }
  }, 15 * 60 * 1_000);
  sweepTimer.unref();
  let shuttingDown = false;
  const shutdown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(sweepTimer);
    recordOperationalEvent(telemetry, { event: "server_lifecycle", phase: "stopping" });
    const timeout = setTimeout(() => process.exit(1), 10_000);
    timeout.unref();
    listener.close((error) => {
      clearTimeout(timeout);
      recordOperationalEvent(telemetry, {
        event: "server_lifecycle",
        phase: error === undefined ? "stopped" : "error",
      });
      process.exit(error === undefined ? 0 : 1);
    });
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
} catch {
  if (telemetry === undefined) console.error("Server could not start.");
  else recordOperationalEvent(telemetry, { event: "server_lifecycle", phase: "error" });
  process.exitCode = 1;
}
