import { readFileSync } from "node:fs";

import { createHttpApp, type HttpAppOptions } from "../../src/http-app.js";
import { GameStore } from "../../src/game-store.js";
import { ToolService } from "../../src/tool-service.js";

const persistencePath = process.env.TURNPLAY_TEST_STORE_PATH;
const widgetPath = process.env.TURNPLAY_TEST_WIDGET_PATH;
const challengeToken = process.env.TURNPLAY_TEST_CHALLENGE_TOKEN;
const requestedPort = Number(process.env.TURNPLAY_TEST_PORT ?? "0");

if (!persistencePath || !widgetPath || !challengeToken || !Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65_535) {
  throw new Error("Production acceptance fixture configuration is invalid.");
}

const widget = readFileSync(widgetPath, "utf8");
const options: HttpAppOptions = {
  loadWidgetHtml: () => widget,
  openAiAppsChallengeToken: challengeToken,
};
const app = createHttpApp(new ToolService(new GameStore({ persistencePath })), options);
const server = app.listen(requestedPort, "127.0.0.1", () => {
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Fixture server did not expose a TCP port.");
  options.widgetDomain = `http://127.0.0.1:${address.port}`;
  process.send?.({ type: "ready", origin: options.widgetDomain, port: address.port });
});

let closing = false;
function close(): void {
  if (closing) return;
  closing = true;
  server.close(error => process.exit(error ? 1 : 0));
  server.closeAllConnections();
}

process.on("message", message => {
  if ((message as { type?: unknown } | null)?.type === "close") close();
});
process.on("SIGTERM", close);
