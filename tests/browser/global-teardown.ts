import { rmSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";

export default function globalTeardown(): void {
  const configured = process.env.TURNPLAY_PLAYWRIGHT_STORE_DIRECTORY;
  if (!configured) return;

  const directory = resolve(configured);
  const temporaryRoot = resolve(tmpdir());
  if (dirname(directory) !== temporaryRoot || !basename(directory).startsWith("turnplay-arena-playwright-")) {
    throw new Error("Refusing to remove an unexpected Playwright store directory.");
  }
  rmSync(directory, { recursive: true, force: true });
}
