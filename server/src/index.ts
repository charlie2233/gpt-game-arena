import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createHttpApp } from "./http-app.js";
import { GameStore } from "./game-store.js";
import { ToolService } from "./tool-service.js";

function portFromEnvironment(value: string | undefined): number {
  if (value === undefined) return 8000;
  if (!/^\d+$/.test(value)) throw new Error("PORT must be an integer between 1 and 65535.");
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("PORT must be an integer between 1 and 65535.");
  return port;
}

try {
  const port = portFromEnvironment(process.env.PORT);
  const defaultStorePath = fileURLToPath(new URL("../../.data/game-sessions.json", import.meta.url));
  const configuredStorePath = process.env.GAME_STORE_PATH;
  const storePath = configuredStorePath === undefined ? defaultStorePath : resolve(configuredStorePath);
  const app = createHttpApp(new ToolService(new GameStore({ persistencePath: storePath })));
  const listener = app.listen(port, "0.0.0.0", () => {
    console.log(`Preview: http://localhost:${port}/preview`);
    console.log(`MCP: http://localhost:${port}/mcp`);
  });
  listener.on("error", () => {
    console.error("Server could not start.");
    process.exitCode = 1;
  });
} catch {
  console.error("Server could not start.");
  process.exitCode = 1;
}
