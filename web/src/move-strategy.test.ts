import { describe, expect, it } from "vitest";
import { Chess, type Square } from "chess.js";
import { chooseStandaloneMove, embeddedMoveCandidates, embeddedMoveDecision, embeddedMovePrompt } from "./move-strategy";
import type { BasketballSnapshot, Board, ChessCell, ChessSnapshot, ConnectFourSnapshot, GameDifficulty, GoBoardSize, GoSnapshot, PoolSnapshot, ReversiSnapshot, TicTacToeSnapshot } from "./types";

const emptyChessBoard = (): ChessCell[] => Array.from({ length: 8 }, (_, row) => Array.from({ length: 8 }, (_, column) => ({ square: `${"abcdefgh"[column]}${8 - row}` as ChessCell["square"] }))).flat();
function chess(difficulty: GameDifficulty, legalMoves: string[], pieces: Array<{ square: string; color: "white" | "black"; piece: "p" | "n" | "b" | "r" | "q" | "k" }> = []): ChessSnapshot {
  const occupied = new Map(pieces.map((piece) => [piece.square, piece]));
  const board = emptyChessBoard().map((cell) => occupied.get(cell.square) ?? cell) as ChessSnapshot["board"];
  return { gameId: "chess-strategy", kind: "chess", difficulty, playerColor: "white", turn: "black", status: "active", legalMoves, moveHistory: [], stateVersion: 4, message: "Black to move.", board };
}
const tic = (difficulty: GameDifficulty, legalMoves: TicTacToeSnapshot["legalMoves"], board = Array.from({ length: 3 }, () => Array<"white" | "black" | null>(3).fill(null)) as Board<3, 3>): TicTacToeSnapshot => ({ gameId: "tic", kind: "tic-tac-toe", difficulty, playerColor: "white", turn: "black", status: "active", legalMoves, moveHistory: [], stateVersion: 0, message: "", board });
const connect = (difficulty: GameDifficulty, legalMoves: ConnectFourSnapshot["legalMoves"], board = Array.from({ length: 6 }, () => Array<"white" | "black" | null>(7).fill(null)) as Board<6, 7>): ConnectFourSnapshot => ({ gameId: "four", kind: "connect-four", difficulty, playerColor: "white", turn: "black", status: "active", legalMoves, moveHistory: [], stateVersion: 0, message: "", board });
const reversi = (difficulty: GameDifficulty, legalMoves: ReversiSnapshot["legalMoves"], board = Array.from({ length: 8 }, () => Array<"white" | "black" | null>(8).fill(null)) as Board<8, 8>): ReversiSnapshot => ({ gameId: "rev", kind: "reversi", difficulty, playerColor: "white", turn: "black", status: "active", legalMoves, moveHistory: [], stateVersion: 0, message: "", board, score: { black: 2, white: 2 } });
const pool = (difficulty: GameDifficulty): PoolSnapshot => ({ gameId: "pool-strategy", kind: "pool", difficulty, playerColor: "white", turn: "black", status: "active", legalMoves: ["POT:1:TM", "POT:1:TR", "POT:2:TM", "POT:2:BM", "POT:3:BM", "POT:3:BR", "SAFE:L", "SAFE:C", "SAFE:R", "SAFE:T", "SAFE:B"], moveHistory: [], stateVersion: 0, message: "", cueBall: { x: 12, y: 25 }, balls: [{ id: 1, group: "solids", x: 32, y: 9 }, { id: 2, group: "solids", x: 36, y: 20 }, { id: 3, group: "solids", x: 34, y: 34 }, { id: 9, group: "stripes", x: 53, y: 13 }, { id: 10, group: "stripes", x: 54, y: 29 }, { id: 11, group: "stripes", x: 72, y: 18 }, { id: 8, group: "eight", x: 76, y: 35 }] });
const basketball = (difficulty: GameDifficulty): BasketballSnapshot => ({ gameId: "court-strategy", kind: "basketball", difficulty, playerColor: "white", turn: "black", status: "active", legalMoves: ["drive", "pull-up", "three"], moveHistory: [], stateVersion: 0, message: "", score: { black: 0, white: 0 }, energy: { black: 4, white: 4 }, streak: { black: 0, white: 0 }, attempts: { black: 0, white: 0 }, phase: "regulation", round: 1, shotOptions: [{ move: "drive", points: 2, energyCost: 2, accuracy: 82 }, { move: "pull-up", points: 2, energyCost: 1, accuracy: 66 }, { move: "three", points: 3, energyCost: 0, accuracy: 48 }], shotResults: [] });
function go(difficulty: GameDifficulty, legalMoves: string[], boardSize: GoBoardSize = 9): GoSnapshot {
  return { gameId: "go-strategy", kind: "go", difficulty, playerColor: "white", turn: "black", status: "active", legalMoves, moveHistory: [], stateVersion: 4, message: "Black to move.", boardSize, board: Array.from({ length: boardSize }, () => Array<"white" | "black" | null>(boardSize).fill(null)), captures: { black: 0, white: 0 }, consecutivePasses: 0 };
}

const goColumns = "ABCDEFGHJKLMNOPQRST";
const allGoMoves = (size: GoBoardSize): string[] => Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, column) => `${goColumns[column]}${size - row}`)).flat();
function playQuietGo(game: GoSnapshot, move: string, color: "white" | "black"): void {
  const column = goColumns.indexOf(move[0]);
  const row = game.boardSize - Number(move.slice(1));
  game.board[row][column] = color;
  game.legalMoves = game.legalMoves.filter((candidate) => candidate !== move);
  game.turn = color === "black" ? "white" : "black";
  game.stateVersion += 1;
}

function chessFromMoves(difficulty: GameDifficulty, moves: string[]): ChessSnapshot {
  const engine = new Chess();
  const moveHistory: ChessSnapshot["moveHistory"] = [];
  for (const [index, notation] of moves.entries()) {
    const color = engine.turn() === "w" ? "white" : "black";
    engine.move({ from: notation.slice(0, 2), to: notation.slice(2, 4), ...(notation[4] ? { promotion: notation[4] as "q" | "r" | "b" | "n" } : {}) });
    moveHistory.push({ actor: color === "white" ? "player" : "gpt", color, notation, ply: index + 1 });
  }
  const board: ChessSnapshot["board"] = [];
  for (let rank = 8; rank >= 1; rank -= 1) for (const file of "abcdefgh") {
    const square = `${file}${rank}` as Square;
    const piece = engine.get(square);
    board.push(piece ? { square, color: piece.color === "w" ? "white" : "black", piece: piece.type } : { square });
  }
  const turn = engine.turn() === "w" ? "white" : "black";
  return {
    gameId: "chess-search",
    kind: "chess",
    difficulty,
    playerColor: "white",
    turn,
    status: "active",
    legalMoves: engine.moves({ verbose: true }).map((move) => `${move.from}${move.to}${move.promotion ?? ""}`).sort(),
    moveHistory,
    lastMove: moveHistory.at(-1),
    stateVersion: moves.length,
    message: `${turn} to move.`,
    board,
  };
}

describe("standalone move strategy", () => {
  it("makes Medium use Go-aware scoring and still prefers a move over pass", () => {
    expect(chooseStandaloneMove(go("medium", ["C3", "pass", "A1", "B2"]))).toBe("C3");
    expect(chooseStandaloneMove(go("medium", ["pass"]))).toBe("pass");
    expect(chooseStandaloneMove(go("medium", []))).toBeUndefined();
  });

  it("opens 19×19 Go in separate corners instead of building the screenshot's edge ladder", () => {
    for (const difficulty of ["medium", "hard"] as const) {
      const game = go(difficulty, [...allGoMoves(19), "pass"], 19);
      game.turn = "black";
      const corners = new Set(["D16", "Q16", "D4", "Q4"]);
      const replies: string[] = [];
      for (const playerMove of ["K10", "C10", "R10"]) {
        playQuietGo(game, playerMove, "white");
        const reply = chooseStandaloneMove(game);
        expect(reply).toBeDefined();
        expect(corners.has(reply as string)).toBe(true);
        expect(replies).not.toContain(reply);
        replies.push(reply as string);
        playQuietGo(game, reply as string, "black");
      }
    }
  });

  it("keeps Medium and Hard Go opening shortlists off the first two lines", () => {
    for (const difficulty of ["medium", "hard"] as const) {
      const game = go(difficulty, [...allGoMoves(19), "pass"], 19);
      const candidates = embeddedMoveCandidates(game);
      expect(candidates.length).toBe(difficulty === "medium" ? 16 : 32);
      expect(candidates.every((move) => {
        const column = goColumns.indexOf(move[0]);
        const rank = Number(move.slice(1));
        const row = 19 - rank;
        return Math.min(row, column, 18 - row, 18 - column) >= 2;
      })).toBe(true);
    }
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

  it("uses real Chess search to find forced checkmate", () => {
    const game = chessFromMoves("hard", ["f2f3", "e7e5", "g2g4"]);
    expect(chooseStandaloneMove(game)).toBe("d8h4");
  });

  it("keeps Hard Chess opening search inside the fast-turn budget", () => {
    const game = chessFromMoves("hard", ["e2e4"]);
    const started = performance.now();
    expect(game.legalMoves).toContain(chooseStandaloneMove(game));
    expect(performance.now() - started).toBeLessThan(2_000);
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

  it("builds a direct-play prompt from the authoritative compact turn", () => {
    const prompt = embeddedMovePrompt(chess("hard", ["a8a7"]));
    expect(prompt).toContain("FAST_TURN");
    expect(prompt).toContain('"difficulty":"hard"');
    expect(prompt).toContain('"expectedResetEpoch":0');
    expect(prompt).toContain('"expectedVersion":4');
    expect(prompt).toContain('"candidateMoves":["a8a7"]');
    expect(prompt).not.toContain("Call get_game_state");
    expect(prompt).toContain("Do not call get_game_state");
    expect(prompt).toContain("MOVE_CONFIRMED");
    expect(prompt).toContain("MOVE_NOT_APPLIED means it did not land");
    expect(prompt).toContain("move is not confirmed");
    expect(prompt).toContain("get_game_state once to reconcile");
    expect(prompt).toContain("think silently and briefly");
    expect(prompt).toContain("order as a verdict");
    expect(prompt).not.toContain("first is the app's difficulty-aware recommendation");
    expect(prompt).not.toContain("then immediately call");
  });

  it("gives each game its own private reasoning priorities", () => {
    expect(embeddedMovePrompt(chess("hard", ["a8a7"]))).toContain("Chess priorities: mate and checks");
    expect(embeddedMovePrompt(go("hard", ["D4"]))).toContain("Go priorities: capture or rescue urgent groups");
    expect(embeddedMovePrompt(tic("hard", ["A1"]))).toContain("create or stop a fork");
    expect(embeddedMovePrompt(connect("hard", ["D"]))).toContain("create or stop double threats");
    expect(embeddedMovePrompt(reversi("hard", ["D3"]))).toContain("limit opponent mobility");
    expect(embeddedMovePrompt(pool("hard"))).toContain("extend a runout");
    expect(embeddedMovePrompt(basketball("hard"))).toContain("never try to predict");
  });

  it("keeps large-board decision state bounded, legal, unique, and spatially varied", () => {
    const legalMoves = Array.from({ length: 19 }, (_, row) => Array.from({ length: 19 }, (_, column) => `${"ABCDEFGHJKLMNOPQRST"[column]}${19 - row}`)).flat();
    for (const difficulty of ["easy", "medium", "hard"] as const) {
      const game = go(difficulty, [...legalMoves, "pass"], 19);
      const decision = embeddedMoveDecision(game);
      const expectedLimit = difficulty === "easy" ? 8 : difficulty === "medium" ? 16 : 32;
      expect(decision.candidateMoves.length).toBeLessThanOrEqual(expectedLimit);
      expect(new Set(decision.candidateMoves).size).toBe(decision.candidateMoves.length);
      expect(decision.candidateMoves.every((move) => game.legalMoves.includes(move))).toBe(true);
      expect(decision.candidateMoves).toContain(chooseStandaloneMove(game));
      expect(decision.candidateMoves).not.toContain("pass");
      expect(new Set(decision.candidateMoves.map((move) => move[0])).size).toBeGreaterThan(2);
      expect(new TextEncoder().encode(JSON.stringify(decision)).byteLength).toBeLessThanOrEqual(2_048);
      expect(decision.position.split("/")).toHaveLength(19);
      expect(decision).toMatchObject({ legalMoveCount: 362, candidatesTruncated: true, expectedResetEpoch: 0, expectedVersion: 4 });
    }
  });

  it("keeps a tactical Go capture in the compact Hard candidate set", () => {
    const game = go("hard", ["A9", "C2", "D4", "E5", "F6", "G7", "H8", "J9", "pass"]);
    game.board[6][1] = "black";
    game.board[7][0] = "black";
    game.board[7][1] = "white";
    game.board[8][1] = "black";
    expect(embeddedMoveCandidates(game)[0]).toBe("C2");
  });
  it("makes Hard Tic-Tac-Toe take a win then block a forced loss", () => {
    const win = tic("hard", ["C3", "C1"]); win.board[0][0] = "black"; win.board[0][1] = "black";
    expect(chooseStandaloneMove(win)).toBe("C3");
    const block = tic("hard", ["C3", "C1"]); block.board[2][0] = "white"; block.board[2][1] = "white";
    expect(chooseStandaloneMove(block)).toBe("C1");
  });
  it("makes Hard Tic-Tac-Toe solve a fork defense with full minimax", () => {
    const game = tic("hard", ["A1", "A2", "B1", "B3", "C2", "C3"]);
    game.board[0][0] = "white";
    game.board[1][1] = "black";
    game.board[2][2] = "white";
    expect(chooseStandaloneMove(game)).toBe("B3");
  });
  it("makes Hard Connect Four win, block, and prefer the central column", () => {
    const win = connect("hard", ["A", "D"]); win.board[5][0] = win.board[5][1] = win.board[5][2] = "black";
    expect(chooseStandaloneMove(win)).toBe("D");
    const block = connect("hard", ["A", "D"]); block.board[5][0] = block.board[5][1] = block.board[5][2] = "white";
    expect(chooseStandaloneMove(block)).toBe("D");
    expect(chooseStandaloneMove(connect("hard", ["A", "C", "D", "G"]))).toBe("D");
  });
  it("makes Hard Connect Four reject a support blunder visible on the next reply", () => {
    const game = connect("hard", ["A", "B", "C", "D", "E", "F", "G"]);
    game.board[5][0] = game.board[5][2] = "black";
    game.board[5][1] = "white";
    game.board[4][0] = game.board[4][1] = game.board[4][2] = "white";
    expect(chooseStandaloneMove(game)).not.toBe("D");
  });
  it("makes Hard Reversi prefer a corner, then a larger safe flip", () => {
    expect(chooseStandaloneMove(reversi("hard", ["A8", "D3"]))).toBe("A8");
    const board = Array.from({ length: 8 }, () => Array<"white" | "black" | null>(8).fill(null)) as Board<8, 8>;
    board[3][4] = "white"; board[3][5] = "white"; board[3][6] = "black"; board[4][3] = "white"; board[4][4] = "black";
    expect(chooseStandaloneMove(reversi("hard", ["D5", "C4", "B1"], board))).toBe("D5");
  });
  it("makes Hard Reversi extend safely from an owned corner", () => {
    const game = reversi("hard", ["A7", "D3"]);
    game.board[0][0] = game.board[3][0] = game.board[3][3] = "black";
    game.board[2][0] = game.board[4][3] = "white";
    expect(chooseStandaloneMove(game)).toBe("A7");
  });
  it("searches forced-pass Reversi endgames to the true terminal result", () => {
    const rows = [
      "B..BWWWW",
      "BWWWBBWW",
      "BWWWWWWW",
      "BBBWWBWW",
      "BWBWBWBW",
      "BWWBWBWW",
      "B.WWWWWW",
      "B.WWWB..",
    ];
    const board = rows.map((row) => [...row].map((cell) => cell === "B" ? "black" : cell === "W" ? "white" : null)) as Board<8, 8>;
    const game = reversi("hard", ["B8", "C8", "B2", "B1", "G1", "H1"], board);
    expect(chooseStandaloneMove(game)).toBe("B8");
  });
  it("keeps every difficulty exact-legal and deterministic for the new kinds", () => {
    for (const difficulty of ["easy", "medium", "hard"] as const) for (const game of [tic(difficulty, ["A1", "B2", "C3"]), connect(difficulty, ["A", "D", "G"]), reversi(difficulty, ["C4", "D3", "F5"]), pool(difficulty), basketball(difficulty)]) {
      const move = chooseStandaloneMove(game); expect(game.legalMoves).toContain(move); expect(chooseStandaloneMove(game)).toBe(move);
    }
  });

  it("makes Medium and Hard Pool finish a legal 8-ball runout", () => {
    for (const difficulty of ["medium", "hard"] as const) {
      const game = pool(difficulty);
      game.cueBall = { x: 34, y: 34 };
      game.balls = game.balls.filter((ball) => ball.group !== "solids");
      game.legalMoves = ["POT:8:TR", "SAFE:L", "SAFE:C", "SAFE:R", "SAFE:T", "SAFE:B"];
      expect(chooseStandaloneMove(game)).toBe("POT:8:TR");
      const decision = embeddedMoveDecision(game);
      expect(decision.position).toContain("8E@76,35");
      expect(decision.positionFormat).toContain("100x50 table");
    }
  });

  it("uses public Court Duel odds and compact score state without exposing a roll", () => {
    for (const difficulty of ["medium", "hard"] as const) {
      const game = basketball(difficulty);
      expect(game.legalMoves).toContain(chooseStandaloneMove(game));
      const decision = embeddedMoveDecision(game);
      expect(decision).toMatchObject({ score: { black: 0, white: 0 }, energy: { black: 4, white: 4 }, attempts: { black: 0, white: 0 }, phase: "regulation", round: 1 });
      expect(decision.position).toContain("drive/2pt/2e/82%");
      expect(JSON.stringify(decision)).not.toContain("roll");
    }
  });

  it("makes Medium use game-aware tactics instead of arbitrary sorted midpoints", () => {
    const chessGame = chess("medium", ["a8a1", "a8b8", "h8g8"], [
      { square: "a8", color: "black", piece: "r" },
      { square: "a1", color: "white", piece: "q" },
      { square: "h8", color: "black", piece: "k" },
      { square: "h1", color: "white", piece: "k" },
    ]);
    expect(chooseStandaloneMove(chessGame)).toBe("a8a1");

    const ticGame = tic("medium", ["A1", "B1", "C3"]);
    ticGame.board[0][0] = ticGame.board[0][1] = "black";
    expect(chooseStandaloneMove(ticGame)).toBe("C3");

    const connectGame = connect("medium", ["A", "B", "C", "D", "E", "F", "G"]);
    connectGame.board[5][6] = connectGame.board[4][6] = connectGame.board[3][6] = "black";
    expect(chooseStandaloneMove(connectGame)).toBe("G");

    expect(chooseStandaloneMove(reversi("medium", ["A8", "C4", "D3", "F5"]))).toBe("A8");
  });
});
