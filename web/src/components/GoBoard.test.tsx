import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { GoBoardSize, GoSnapshot } from "../types";
import { GoBoard } from "./GoBoard";

function game(boardSize: GoBoardSize): GoSnapshot {
  return {
    gameId: `go-${boardSize}`,
    kind: "go",
    difficulty: "medium",
    playerColor: "black",
    turn: "black",
    status: "active",
    legalMoves: [`A${boardSize}`, "pass"],
    moveHistory: [],
    stateVersion: 0,
    message: "Black to move.",
    boardSize,
    board: Array.from({ length: boardSize }, () => Array<"black" | "white" | null>(boardSize).fill(null)),
    captures: { black: 0, white: 0 },
    consecutivePasses: 0,
  };
}

describe("GoBoard", () => {
  afterEach(cleanup);

  it.each([
    [9, 5],
    [13, 5],
    [19, 9],
  ] as const)("draws %i intersections with the correct line and star geometry", (boardSize, starCount) => {
    render(<GoBoard game={game(boardSize)} onMove={vi.fn()} disabled={false} />);

    const board = screen.getByRole("group", { name: `${boardSize} by ${boardSize} Go board` });
    const grid = board.querySelector("svg.go-grid");
    const lines = grid?.querySelectorAll("line");

    expect(grid).toHaveAttribute("viewBox", `0 0 ${boardSize} ${boardSize}`);
    expect(grid).toHaveAttribute("aria-hidden", "true");
    expect(lines).toHaveLength(boardSize * 2);
    expect(lines?.[0]).toHaveAttribute("x1", "0.5");
    expect(lines?.[0]).toHaveAttribute("y1", "0.5");
    expect(lines?.[0]).toHaveAttribute("x2", "0.5");
    expect(lines?.[0]).toHaveAttribute("y2", `${boardSize - 0.5}`);
    expect(lines?.[1]).toHaveAttribute("x1", "0.5");
    expect(lines?.[1]).toHaveAttribute("y1", "0.5");
    expect(lines?.[1]).toHaveAttribute("x2", `${boardSize - 0.5}`);
    expect(lines?.[1]).toHaveAttribute("y2", "0.5");
    expect(lines?.[(boardSize - 1) * 2]).toHaveAttribute("x1", `${boardSize - 0.5}`);
    expect(lines?.[(boardSize - 1) * 2]).toHaveAttribute("x2", `${boardSize - 0.5}`);
    expect(lines?.[(boardSize - 1) * 2 + 1]).toHaveAttribute("y1", `${boardSize - 0.5}`);
    expect(lines?.[(boardSize - 1) * 2 + 1]).toHaveAttribute("y2", `${boardSize - 0.5}`);
    expect(grid?.querySelectorAll("circle")).toHaveLength(starCount);
    expect(board.style.gridTemplateColumns).toBe(`repeat(${boardSize}, minmax(0, 1fr))`);
    expect(board.style.gridTemplateRows).toBe(`repeat(${boardSize}, minmax(0, 1fr))`);
    expect(board.querySelectorAll("button.go-point")).toHaveLength(boardSize * boardSize);
    expect(screen.getByRole("button", { name: `Play at A${boardSize}, empty, legal move` })).toBeEnabled();
  });
});
