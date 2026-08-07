import { expect, test } from "@playwright/test";

test("Chess remains playable with mobile Chromium touch and device metrics", async ({ page }) => {
  const runtimeErrors: string[] = [];
  page.on("pageerror", error => runtimeErrors.push(`page: ${error.message}`));
  page.on("console", message => {
    if (message.type() === "error") runtimeErrors.push(`console: ${message.text()}`);
  });

  await page.goto("/preview");
  await expect(page.getByRole("group", { name: "Chess board" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start game" })).toBeEnabled();

  await page.getByRole("button", { name: /^white pawn on e2.*movable source$/ }).tap();
  const destination = page.getByRole("button", { name: /^empty e4, legal destination$/ });
  await expect(destination).toBeEnabled();
  await destination.tap();
  await expect.poll(() => page.evaluate(() => {
    const render = (window as Window & { render_game_to_text?: () => string }).render_game_to_text;
    if (typeof render !== "function") return "missing";
    const state = JSON.parse(render()) as { busy?: boolean; game?: { stateVersion?: number } };
    return `${state.game?.stateVersion}:${state.busy}`;
  })).toBe("2:false");

  const metrics = await page.evaluate(() => {
    const board = document.querySelector<HTMLElement>(".chess-board")?.getBoundingClientRect();
    const controls = document.querySelector<HTMLElement>(".controls-chess")?.getBoundingClientRect();
    const status = document.querySelector<HTMLElement>(".board-chess .game-status")?.getBoundingClientRect();
    if (!board || !controls || !status) throw new Error("Mobile game surface was incomplete.");
    const inside = (rect: DOMRect) => rect.left >= -1 && rect.right <= window.innerWidth + 1 && rect.top >= -1 && rect.bottom <= window.innerHeight + 1;
    return {
      devicePixelRatio: window.devicePixelRatio,
      maxTouchPoints: navigator.maxTouchPoints,
      mobileUserAgent: /Android|Mobile/i.test(navigator.userAgent),
      noHorizontalOverflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <= window.innerWidth + 1,
      essentialSurfaceInsideViewport: [board, controls, status].every(inside),
      scrollY: window.scrollY,
    };
  });

  expect(metrics.devicePixelRatio).toBeGreaterThan(1);
  expect(metrics.maxTouchPoints).toBeGreaterThan(0);
  expect(metrics.mobileUserAgent).toBe(true);
  expect(metrics.noHorizontalOverflow).toBe(true);
  expect(metrics.essentialSurfaceInsideViewport).toBe(true);
  expect(metrics.scrollY).toBe(0);
  expect(runtimeErrors).toEqual([]);
});
