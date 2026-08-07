// @vitest-environment node

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const titleHiddenRanges = [...styles.matchAll(/@media \(min-width: (\d+)px\) and \(max-width: (\d+)px\) \{ h1 \{ display: none; \}/g)]
  .map((match) => ({ minimum: Number(match[1]), maximum: Number(match[2]) }));
const compactTableMaximum = Number(styles.match(/@media \(max-width: (\d+)px\) \{ \.table \{ grid-template-columns: 1fr;/)?.[1]);
const threeColumnTableMinimum = Number(styles.match(/@media \(min-width: ([\d.]+)px\) and \(max-width: 1150px\) \{ \.table:not/)?.[1]);

describe("responsive new-game picker", () => {
  it.each([681, 700])("keeps the non-shrinking title hidden at %dpx", (viewportWidth) => {
    expect(titleHiddenRanges.some(({ minimum, maximum }) => viewportWidth >= minimum && viewportWidth <= maximum)).toBe(true);
  });

  it.each([681, 700, 760])("keeps the table in its compact single-column layout at %dpx", (viewportWidth) => {
    expect(viewportWidth).toBeLessThanOrEqual(compactTableMaximum);
    expect(threeColumnTableMinimum).toBeGreaterThan(viewportWidth);
  });

  it("places short-landscape confirmations beside the board without showing roles", () => {
    expect(styles).toContain(".arena.action-confirming :is(.table-chess, .table-tic-tac-toe) .roles { display: none; }");
    expect(styles).toContain("grid-template-columns: 12rem minmax(0, 1fr)");
    expect(styles).toContain("> :is(.board-wrap, .small-board) { grid-column: 1; grid-row: 1 / span 2;");
    expect(styles).toContain("> .end-confirmation { grid-column: 2; grid-row: 1; margin-top: 0;");
    expect(styles).toContain("> .game-status { grid-column: 2; grid-row: 2;");
  });
});
