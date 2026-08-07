// @vitest-environment node

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const titleHiddenRanges = [...styles.matchAll(/@media \(min-width: (\d+)px\) and \(max-width: (\d+)px\) \{ h1 \{ display: none; \}/g)]
  .map((match) => ({ minimum: Number(match[1]), maximum: Number(match[2]) }));

describe("responsive new-game picker", () => {
  it.each([681, 700])("keeps the non-shrinking title hidden at %dpx", (viewportWidth) => {
    expect(titleHiddenRanges.some(({ minimum, maximum }) => viewportWidth >= minimum && viewportWidth <= maximum)).toBe(true);
  });
});
