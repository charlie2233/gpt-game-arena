import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PoolBoard } from "./SportsBoards";
import type { PoolSnapshot } from "../types";

afterEach(cleanup);

function pool(overrides: Partial<PoolSnapshot> = {}): PoolSnapshot {
  return {
    gameId: "pool-1",
    kind: "pool",
    difficulty: "medium",
    playerColor: "black",
    turn: "black",
    status: "active",
    legalMoves: ["POT:1:TM", "POT:1:TR", "POT:2:BM", "SAFE:L", "SAFE:C", "SAFE:R", "SAFE:T", "SAFE:B"],
    moveHistory: [],
    stateVersion: 0,
    resetEpoch: 0,
    message: "Black (solids) to shoot.",
    cueBall: { x: 12, y: 25 },
    balls: [
      { id: 1, group: "solids", x: 32, y: 9 },
      { id: 2, group: "solids", x: 36, y: 20 },
      { id: 8, group: "eight", x: 76, y: 35 },
    ],
    ...overrides,
  };
}

describe("PoolBoard accessibility", () => {
  it("moves keyboard focus from the selected ball directly to its first legal pocket and announces the instruction", async () => {
    const user = userEvent.setup();
    render(<PoolBoard game={pool()} onMove={vi.fn()} disabled={false}/>);

    const ball = screen.getByRole("button", { name: "Ball 1, solids, 2 legal pockets" });
    ball.focus();
    await user.keyboard("{Enter}");

    expect(screen.getByText("Ball 1: choose a pocket")).toHaveAttribute("aria-live", "polite");
    expect(screen.getByText("Ball 1: choose a pocket")).toHaveAttribute("aria-atomic", "true");
    expect(ball).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Pot ball 1 in the top middle pocket" })).toHaveFocus();
  });

  it("clears a pending ball selection whenever the authoritative position changes", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<PoolBoard game={pool()} onMove={vi.fn()} disabled={false}/>);
    await user.click(screen.getByRole("button", { name: "Ball 1, solids, 2 legal pockets" }));
    expect(screen.getByText("Ball 1: choose a pocket")).toBeVisible();

    rerender(<PoolBoard game={pool({ stateVersion: 1 })} onMove={vi.fn()} disabled={false}/>);

    expect(await screen.findByText("Choose a ball or play safe")).toBeVisible();
    expect(screen.getByRole("button", { name: "Ball 1, solids, 2 legal pockets" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("button", { name: /Pot ball 1 in the/ })).not.toBeInTheDocument();
  });

  it("clears a pending selection across a reset even when the same ball remains legal", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<PoolBoard game={pool()} onMove={vi.fn()} disabled={false}/>);
    await user.click(screen.getByRole("button", { name: "Ball 1, solids, 2 legal pockets" }));

    rerender(<PoolBoard game={pool({ resetEpoch: 1 })} onMove={vi.fn()} disabled={false}/>);

    expect(await screen.findByText("Choose a ball or play safe")).toBeVisible();
    expect(screen.getByRole("button", { name: "Ball 1, solids, 2 legal pockets" })).toHaveAttribute("aria-pressed", "false");
  });

  it("does not carry a pending selection into a newly created Pool game", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<PoolBoard game={pool()} onMove={vi.fn()} disabled={false}/>);
    await user.click(screen.getByRole("button", { name: "Ball 1, solids, 2 legal pockets" }));

    rerender(<PoolBoard game={pool({ gameId: "pool-2" })} onMove={vi.fn()} disabled={false}/>);

    expect(await screen.findByText("Choose a ball or play safe")).toBeVisible();
    expect(screen.getByRole("button", { name: "Ball 1, solids, 2 legal pockets" })).toHaveAttribute("aria-pressed", "false");
  });
});
