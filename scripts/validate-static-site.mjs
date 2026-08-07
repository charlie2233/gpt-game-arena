import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join, resolve } from "node:path";

import { validateNegativeWorkflows, validatePositiveWorkflows } from "./submission-workflow-validation.mjs";

const root = resolve(import.meta.dirname, "..");
const site = join(root, "site");
const htmlFiles = readdirSync(site).filter(name => extname(name) === ".html").sort();
const failures = [];

function fail(message) {
  failures.push(message);
}

function localTargetExists(sourceFile, target) {
  if (/^(?:https?:|mailto:|tel:|#)/.test(target)) return true;
  const withoutFragment = target.split("#", 1)[0]?.split("?", 1)[0] ?? "";
  if (withoutFragment.length === 0) return true;
  return existsSync(resolve(site, sourceFile === "index.html" ? "." : ".", withoutFragment));
}

if (htmlFiles.length !== 4) fail(`expected 4 HTML pages, found ${htmlFiles.length}`);

for (const file of htmlFiles) {
  const source = readFileSync(join(site, file), "utf8");
  if (!source.includes('<html lang="en">')) fail(`${file}: missing language`);
  if (!source.includes("Content-Security-Policy")) fail(`${file}: missing CSP`);
  if (!source.includes('<main id="main">')) fail(`${file}: missing main landmark`);
  if (!source.includes('href="styles.css"')) fail(`${file}: missing shared stylesheet`);
  if (/GPT Game Arena/i.test(source)) fail(`${file}: contains retired public product name`);

  for (const match of source.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const target = match[1];
    if (target !== undefined && !localTargetExists(file, target)) fail(`${file}: missing local target ${target}`);
  }
}

const support = readFileSync(join(site, "support.html"), "utf8");
if (!support.includes('action="https://formspree.io/f/mbdzrwbo"')) fail("support form endpoint changed");
if (!support.includes("Never send:")) fail("support page is missing secret-safe guidance");

const privacy = readFileSync(join(site, "privacy.html"), "utf8");
for (const required of [
  "30 days",
  "Formspree",
  "local storage",
  ".v1.bak",
  "raw address",
  "Current v2 writes persist only the active game ID and draft game, difficulty, and side selectors",
  "Current v2 writes never persist the board, legal moves, move history, message, reset epoch, or state version.",
  "The authoritative game state remains on the Turnplay Arena server.",
  "Earlier v1 builds could persist a full validated game snapshot",
  "A legacy v1 snapshot may remain until a compatible card opens and successfully replaces it with v2 state, or the user clears it",
  "An older v1 save may still contain a full snapshot until a compatible preview opens and successfully migrates it.",
  "A failed or blocked local storage overwrite can leave the legacy standalone copy in place until the user clears site data.",
]) {
  if (!privacy.includes(required)) fail(`privacy page is missing ${required}`);
}
for (const staleDisclosure of [
  "the current validated game snapshot, including its game ID and board/history, is written",
  "the browser stores the latest validated game snapshot in local storage until",
]) {
  if (privacy.includes(staleDisclosure)) fail(`privacy page contains stale snapshot disclosure: ${staleDisclosure}`);
}

const logo = readFileSync(join(site, "assets", "turnplay-mark.svg"), "utf8");
if (!logo.includes('viewBox="0 0 512 512"')) fail("logo is not authored on a 512-square canvas");
if (/openai|chatgpt|\bgpt\b/i.test(logo)) fail("logo contains a restricted brand reference");

for (const relativePath of [
  "site/assets/logo-512.png",
  "site/assets/composer-icon-512.png",
  "submission/screenshots/01-medium-chess.png",
  "submission/screenshots/02-hard-go-9.png",
  "submission/screenshots/03-imported-go-19.png",
]) {
  const png = readFileSync(join(root, relativePath));
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (relativePath.includes("assets/") && (width !== 512 || height !== 512)) fail(`${relativePath}: expected 512x512`);
  if (relativePath.includes("screenshots/") && (width !== 706 || height < 400 || height > 860)) {
    fail(`${relativePath}: expected width 706 and height 400-860, found ${width}x${height}`);
  }
}

const submission = JSON.parse(readFileSync(join(root, "chatgpt-app-submission.json"), "utf8"));
if (submission.$schema !== "https://developers.openai.com/plugins/schemas/chatgpt-app-submission.v1.json") fail("submission schema URL is not canonical");
if (submission.app_info?.display_name !== "Turnplay Arena") fail("submission display name is not Turnplay Arena");
const positiveCases = Array.isArray(submission.test_cases) ? submission.test_cases : [];
const negativeCases = Array.isArray(submission.negative_test_cases) ? submission.negative_test_cases : [];
for (const error of validatePositiveWorkflows(positiveCases, new Set(Object.keys(submission.tools ?? {})))) fail(error);
for (const error of validateNegativeWorkflows(negativeCases)) fail(error);

if (failures.length > 0) {
  console.error(failures.map(message => `- ${message}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Validated ${htmlFiles.length} static pages, local links, policy disclosures, branding, and reviewer-case counts.`);
}
