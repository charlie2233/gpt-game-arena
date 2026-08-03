import { describe, expect, it } from "vitest";
import { chooseStandaloneMove, embeddedMovePrompt } from "./move-strategy";
import type { ChessCell, ChessSnapshot, GameDifficulty, GoBoardSize, GoSnapshot } from "./types";

const emptyChessBoard = (): ChessCell[] => Array.from({ length: 8 }, (_, row) => Array.from({ length: 8 }, (_, column) => ({ square: `${"abcdefgh"[column]}${8 - row}` as ChessCell["square"] }))).flat();
function chess(difficulty: GameDifficulty, legalMoves: string[], pieces: Array<{ square: string; color: "white" | "black"; piece: "p" | "n" | "b" | "r" | "q" | "k" }> = []): ChessSnapshot {
  const occupied = new Map(pieces.map((piece) => [piece.square, piece]));
  const board = emptyChessBoard().map((cell) => occupied.get(cell.square) ?? cell) as ChessSnapshot["board"];
  return { gameId: "chess-strategy", kind: "chess", difficulty, playerColor: "white", turn: "black", status: "active", legalMoves, moveHistory: [], stateVersion: 4, message: "Black to move.", board };
}
function go(difficulty: GameDifficulty, legalMoves: string[], boardSize: GoBoardSize = 9): GoSnapshot {
  return { gameId: "go-strategy", kind: "go", difficulty, playerColor: "white", turn: "black", status: "active", legalMoves, moveHistory: [], stateVersion: 4, message: "Black to move.", boardSize, board: Array.from({ length: boardSize }, () => Array<"white" | "black" | null>(boardSize).fill(null)), captures: { black: 0, white: 0 }, consecutivePasses: 0 };
}

describe("standalone move strategy", () => {
  it("keeps Medium's stable sorted-middle behavior and prefers a move over pass", () => {
    expect(chooseStandaloneMove(go("medium", ["C3", "pass", "A1", "B2"]))).toBe("B2");
    expect(chooseStandaloneMove(go("medium", ["pass"]))).toBe("pass");
    expect(chooseStandaloneMove(go("medium", []))).toBeUndefined();
  });

  it("makes Easy casual but repeatable and always returns an exact legal move", () => {
    const game = chess("easy", ["a7a5", "a7a6", "b7b6", "pass"]);
    const first = chooseStandaloneMove(game);
    expect(chooseStandaloneMove(game)).toBe(first);
    expect(game.legalMoves).toContain(first);
    expect(first).not.toBe("pass");
  });

  it("makes Hard chess prefer a valuable one-ply capture over the stable middle", () => {
    const game = chess("hard", ["a8a1", "a8b8"], [
      { square: "a8", color: "black", piece: "r" },
      { square: "a1", color: "white", piece: "q" },
      { square: "h8", color: "black", piece: "k" },
      { square: "h1", color: "white", piece: "k" },
    ]);
    expect(chooseStandaloneMove(game)).toBe("a8a1");
  });

  it("makes Hard Go simulate liberties and take an immediate capture", () => {
    const game = go("hard", ["A9", "C2", "pass"]);
    game.board[6][1] = "black";
    game.board[7][0] = "black";
    game.board[7][1] = "white";
    game.board[8][1] = "black";
    expect(chooseStandaloneMove(game)).toBe("C2");
  });

  it("allows an ordinary two-pass Go finish only when no tactical continuation remains", () => {
    for (const difficulty of ["easy", "medium", "hard"] as const) {
      const game = go(difficulty, ["A1", "B1", "pass"]);
      game.consecutivePasses = 1;
      for (let row = 0; row < 4; row += 1) game.board[row].fill("black");
      expect(chooseStandaloneMove(game)).toBe("pass");

      const opening = go(difficulty, ["E5", "pass"]);
      opening.consecutivePasses = 1;
      expect(chooseStandaloneMove(opening)).toBe("E5");
    }
  });

  it("scores a dense Hard 19×19 position within a bounded CPU budget", () => {
    const legalMoves: string[] = [];
    const game = go("hard", legalMoves, 19);
    for (let row = 0; row < 10; row += 1) game.board[row].fill("black");
    for (let row = 10; row < 19; row += 1) {
      const rank = 19 - row;
      for (let column = 0; column < 19; column += 1) legalMoves.push(`${"ABCDEFGHJKLMNOPQRST"[column]}${rank}`);
    }
    const started = performance.now();
    for (let run = 0; run < 3; run += 1) expect(legalMoves).toContain(chooseStandaloneMove(game));
    expect(performance.now() - started).toBeLessThan(500);
  });

  it("builds enum-controlled embedded instructions around a freshly fetched version", () => {
    const prompt = embeddedMovePrompt(chess("hard", ["a8a7"]));
    expect(prompt).toContain("HARD difficulty");
    expect(prompt).toContain("get_game_state");
    expect(prompt).toContain("exactly one string");
    expect(prompt).toContain("expectedVersion from that same freshly fetched snapshot");
    expect(prompt).toContain("Do not call create_game or reset_game");
  });
});
