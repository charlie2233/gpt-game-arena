import { defineConfig, devices } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

const port = Number(process.env.PLAYWRIGHT_PORT ?? "18181");
if (!Number.isInteger(port) || port < 1 || port > 65_535 || port === 8000) {
  throw new Error("PLAYWRIGHT_PORT must be an integer from 1 to 65535 and must not be the live port 8000.");
}

const baseURL = `http://127.0.0.1:${port}`;
const storeDirectory = join(tmpdir(), `turnplay-arena-playwright-${randomUUID()}`);
const storePath = join(storeDirectory, "game-sessions.json");
process.env.TURNPLAY_PLAYWRIGHT_STORE_DIRECTORY = storeDirectory;
const serverEnvironment = { ...process.env };
for (const name of [
  "PUBLIC_BASE_URL",
  "OPENAI_APPS_CHALLENGE_TOKEN",
  "TRUSTED_PROXY_CIDRS",
  "TRUST_PROXY_HOPS",
  "GAME_STORE_TTL_MS",
  "GAME_STORE_MAX_SESSIONS",
  "GAME_STORE_LEGACY_BACKUP_TTL_MS",
]) delete serverEnvironment[name];

export default defineConfig({
  testDir: "./tests/browser",
  globalTeardown: "./tests/browser/global-teardown.ts",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  failOnFlakyTests: Boolean(process.env.CI),
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? "line" : "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    locale: "en-US",
    contextOptions: { reducedMotion: "reduce" },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "off",
  },
  projects: [
    { name: "chromium", testIgnore: /mobile\.spec\.ts/ },
    { name: "mobile-chromium", testMatch: /mobile\.spec\.ts/, use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "node server/dist/index.js",
    url: `${baseURL}/ready`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      ...serverEnvironment,
      NODE_ENV: "test",
      PORT: String(port),
      GAME_STORE_PATH: storePath,
    },
  },
});
