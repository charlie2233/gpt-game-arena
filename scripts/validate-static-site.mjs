import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const site = join(root, "site");
const htmlFiles = readdirSync(site).filter(name => extname(name) === ".html").sort();
const failures = [];

function fail(message) {
  failures.push(message);
}

function validatePositiveWorkflows(testCases, knownTools) {
  let createWorkflowCount = 0;
  let importWorkflowCount = 0;

  for (const [index, testCase] of testCases.entries()) {
    const label = `submission positive case ${index + 1}`;
    const toolsTriggered = testCase?.tools_triggered;
    if (typeof toolsTriggered !== "string" || toolsTriggered.trim().length === 0) {
      fail(`${label}: tools_triggered must be a nonempty string`);
      continue;
    }

    const rawSegments = toolsTriggered.split(",");
    if (rawSegments.some(segment => segment.trim().length === 0)) {
      fail(`${label}: tools_triggered contains a blank tool segment`);
      continue;
    }
    const workflow = rawSegments.map(segment => segment.trim());

    for (const tool of workflow) {
      if (!knownTools.has(tool)) fail(`${label}: unknown tool token ${tool}`);
    }
    const seen = new Set();
    for (const tool of workflow) {
      if (seen.has(tool)) fail(`${label}: duplicate tool token ${tool}`);
      seen.add(tool);
    }

    const createCount = workflow.filter(tool => tool === "create_game").length;
    const renderCount = workflow.filter(tool => tool === "render_game").length;
    const hasCreate = createCount > 0;
    const hasImport = workflow.includes("import_go_position");
    if (!hasCreate && !hasImport) fail(`${label}: workflow must start from create_game or import_go_position`);

    if (hasCreate) {
      createWorkflowCount += 1;
      if (createCount !== 1) fail(`${label}: create_game must appear exactly once`);
      if (renderCount !== 1) fail(`${label}: render_game must appear exactly once`);
      if (workflow.indexOf("render_game") !== workflow.indexOf("create_game") + 1) fail(`${label}: render_game must appear immediately after create_game`);
      if (typeof testCase?.expected_output !== "string" || !testCase.expected_output.includes("interactive board renders from the same gameId")) {
        fail(`${label}: expected output must confirm the interactive board uses the same gameId`);
      }
    }

    if (hasImport) {
      importWorkflowCount += 1;
      if (renderCount !== 0) fail(`${label}: import_go_position must not include render_game`);
      if (workflow.length !== 1 || workflow[0] !== "import_go_position") fail(`${label}: import workflow must contain only import_go_position`);
    }
  }

  if (createWorkflowCount !== 4) fail("submission must contain exactly four create_game workflows");
  if (importWorkflowCount !== 1) fail("submission must contain exactly one import_go_position workflow");
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
for (const required of ["30 days", "Formspree", "local storage", ".v1.bak", "raw address"]) {
  if (!privacy.includes(required)) fail(`privacy page is missing ${required}`);
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
if (positiveCases.length !== 5) fail("submission must contain exactly five positive cases");
if (negativeCases.length !== 3) fail("submission must contain exactly three negative cases");
validatePositiveWorkflows(positiveCases, new Set(Object.keys(submission.tools ?? {})));
for (const [index, testCase] of negativeCases.entries()) {
  if (testCase?.tools_triggered !== null) fail(`submission negative case ${index + 1}: tools_triggered must remain null`);
}

if (failures.length > 0) {
  console.error(failures.map(message => `- ${message}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Validated ${htmlFiles.length} static pages, local links, policy disclosures, branding, and reviewer-case counts.`);
}
