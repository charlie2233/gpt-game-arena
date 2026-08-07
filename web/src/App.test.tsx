import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { GameBridge } from "./bridge";
import { isSnapshot } from "./game-client";
import { loadStandaloneGame, saveStandaloneGame } from "./game-save";
import { chooseStandaloneMove } from "./move-strategy";
import type { BasketballSnapshot, Board, ChessSnapshot, GameDifficulty, GoBoardSize, GoSnapshot, ChessSquare, TicTacToeSnapshot, ConnectFourSnapshot, PoolSnapshot, ReversiCoordinate, ReversiSnapshot } from "./types";
const chess = (version = 0, difficulty: GameDifficulty = "medium"): ChessSnapshot => ({ gameId: "chess-1", kind: "chess", difficulty, playerColor: "white", turn: "white", status: "active", legalMoves: ["e2e4"], moveHistory: [], stateVersion: version, message: "White to move.", board: Array.from({ length: 8 }, (_, r) => Array.from({ length: 8 }, (_, c) => ({ square: `${"abcdefgh"[c]}${8-r}` as ChessSquare, ...(r === 6 && c === 4 ? { color: "white" as const, piece: "p" as const } : {}) }))).flat() as ChessSnapshot["board"] });
function chessAdvance(previous: ChessSnapshot, actor: "player" | "gpt", notation: string, turn: "white" | "black", legalMoves: string[], message: string): ChessSnapshot {
  const move = { actor, color: previous.turn, notation, ply: previous.moveHistory.length + 1 } as const;
  return { ...previous, turn, legalMoves, moveHistory: [...previous.moveHistory, move], lastMove: move, stateVersion: previous.stateVersion + 1, message };
}
const go = (boardSize: GoBoardSize = 9, difficulty: GameDifficulty = "medium"): GoSnapshot => ({ gameId: `go-${boardSize}`, kind: "go", difficulty, playerColor: "black", turn: "black", status: "active", legalMoves: [`A${boardSize}`, "pass"], moveHistory: [], stateVersion: 0, message: "Black to move.", boardSize, board: Array.from({ length: boardSize }, () => Array<"white" | "black" | null>(boardSize).fill(null)), captures: { black: 0, white: 0 }, consecutivePasses: 0 });
const importedGo = (playerColor: "white" | "black" = "white", turn: "white" | "black" = "white", resetEpoch = 0, importReview: "pending" | "confirmed" = "pending"): GoSnapshot => {
  const snapshot = { ...go(9, "hard"), gameId: "imported-go", resetEpoch, playerColor, turn, importReview, legalMoves: importReview === "pending" ? [] : [`A9`, "pass"], message: importReview === "pending" ? "Imported position awaiting confirmation." : `Imported position. ${turn === "white" ? "White" : "Black"} to move.`, initialPosition: { source: "imported" as const, blackStones: ["D4"], whiteStones: ["E4"], turn, captures: { black: 0, white: 0 } } };
  snapshot.board[5][3] = "black";
  snapshot.board[5][4] = "white";
  return snapshot;
};
const tic = (): TicTacToeSnapshot => ({ gameId: "tic", kind: "tic-tac-toe", difficulty: "hard", playerColor: "black", turn: "black", status: "active", legalMoves: ["A1", "A2", "A3", "B1", "B2", "B3", "C1", "C2", "C3"], moveHistory: [], stateVersion: 0, message: "Black to move.", board: Array.from({ length: 3 }, () => Array<"white" | "black" | null>(3).fill(null)) as Board<3, 3> });
const four = (): ConnectFourSnapshot => ({ gameId: "four", kind: "connect-four", difficulty: "hard", playerColor: "black", turn: "black", status: "active", legalMoves: ["A", "B", "C", "D", "E", "F", "G"], moveHistory: [], stateVersion: 0, message: "Black to move.", board: Array.from({ length: 6 }, () => Array<"white" | "black" | null>(7).fill(null)) as Board<6, 7> });
const reversi = (): ReversiSnapshot => ({ gameId: "rev", kind: "reversi", difficulty: "hard", playerColor: "black", turn: "black", status: "active", legalMoves: ["C4", "D3", "E6", "F5"], moveHistory: [], stateVersion: 0, message: "Black to move.", board: [[null, null, null, null, null, null, null, null], [null, null, null, null, null, null, null, null], [null, null, null, null, null, null, null, null], [null, null, null, "black", "white", null, null, null], [null, null, null, "white", "black", null, null, null], [null, null, null, null, null, null, null, null], [null, null, null, null, null, null, null, null], [null, null, null, null, null, null, null, null]], score: { black: 2, white: 2 } });
const pool = (): PoolSnapshot => ({ gameId: "pool", kind: "pool", difficulty: "hard", playerColor: "black", turn: "black", status: "active", legalMoves: ["POT:1:TM", "POT:1:TR", "POT:2:TM", "POT:2:BM", "POT:3:BM", "POT:3:BR", "SAFE:L", "SAFE:C", "SAFE:R", "SAFE:T", "SAFE:B"], moveHistory: [], stateVersion: 0, message: "Black (solids) to shoot.", cueBall: { x: 12, y: 25 }, balls: [{ id: 1, group: "solids", x: 32, y: 9 }, { id: 2, group: "solids", x: 36, y: 20 }, { id: 3, group: "solids", x: 34, y: 34 }, { id: 9, group: "stripes", x: 53, y: 13 }, { id: 10, group: "stripes", x: 54, y: 29 }, { id: 11, group: "stripes", x: 72, y: 18 }, { id: 8, group: "eight", x: 76, y: 35 }] });
const basketball = (): BasketballSnapshot => ({ gameId: "court", kind: "basketball", difficulty: "hard", playerColor: "black", turn: "black", status: "active", legalMoves: ["drive", "pull-up", "three"], moveHistory: [], stateVersion: 0, message: "Black to shoot in round 1. Score 0-0.", score: { black: 0, white: 0 }, energy: { black: 4, white: 4 }, streak: { black: 0, white: 0 }, attempts: { black: 0, white: 0 }, phase: "regulation", round: 1, shotOptions: [{ move: "drive", points: 2, energyCost: 2, accuracy: 82 }, { move: "pull-up", points: 2, energyCost: 1, accuracy: 66 }, { move: "three", points: 3, energyCost: 0, accuracy: 48 }], shotResults: [] });
const reversiDirections = [-1, 0, 1].flatMap(row => [-1, 0, 1].map(column => [row, column] as const)).filter(([row, column]) => row || column);
function reversiFixturePlay(game: ReversiSnapshot, move: ReversiCoordinate): ReversiSnapshot {
  const board = game.board.map(row => [...row]) as Board<8, 8>; const row = 8 - Number(move[1]); const column = move.charCodeAt(0) - 65; const opponent = game.turn === "black" ? "white" : "black";
  for (const [dy, dx] of reversiDirections) { const line: Array<readonly [number, number]> = []; let y = row + dy, x = column + dx; while (board[y]?.[x] === opponent) { line.push([y, x]); y += dy; x += dx; } if (line.length && board[y]?.[x] === game.turn) for (const [fy, fx] of line) board[fy][fx] = game.turn; }
  board[row][column] = game.turn;
  const legalFor = (color: "black" | "white") => { const enemy = color === "black" ? "white" : "black"; const legal: ReversiCoordinate[] = []; for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (board[y][x] === null && reversiDirections.some(([dy, dx]) => { let cy = y + dy, cx = x + dx, count = 0; while (board[cy]?.[cx] === enemy) { count++; cy += dy; cx += dx; } return count > 0 && board[cy]?.[cx] === color; })) legal.push(`${"ABCDEFGH"[x]}${8-y}` as ReversiCoordinate); return legal.sort(); };
  const opponentMoves = legalFor(opponent); const ownMoves = legalFor(game.turn); const nextTurn = opponentMoves.length ? opponent : game.turn; const legalMoves = opponentMoves.length ? opponentMoves : ownMoves; const notation = move; const record = { actor: game.turn === game.playerColor ? "player" as const : "gpt" as const, color: game.turn, notation, ply: game.moveHistory.length + 1 }; let black = 0, white = 0; for (const line of board) for (const cell of line) cell === "black" ? black++ : cell === "white" ? white++ : undefined;
  return { ...game, board, turn: nextTurn, legalMoves, moveHistory: [...game.moveHistory, record], lastMove: record, stateVersion: game.stateVersion + 1, message: opponentMoves.length ? `${nextTurn === "black" ? "Black" : "White"} to move.` : `${opponent === "black" ? "Black" : "White"} has no legal move; ${game.turn === "black" ? "Black" : "White"} moves again.`, score: { black, white } };
}
describe("App", () => {
  it("uses the submission-safe public product name", () => {
    render(<App initialGame={chess()}/>);
    expect(screen.getByRole("heading", { name: "Turnplay Arena" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: /GPT Game Arena/i })).not.toBeInTheDocument();
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); window.localStorage.clear(); Reflect.deleteProperty(window, "openai"); });
  beforeEach(() => { window.localStorage.clear(); vi.stubGlobal("fetch", vi.fn()); });
  it("selects a legal chess destination then plays a deterministic standalone GPT reply", async () => {
    const reply: ChessSnapshot = { ...chess(1), turn: "black", legalMoves: ["a7a5", "a7a6"] }; const gpt = { ...chess(2), turn: "white", legalMoves: ["d2d4"] };
    const gptMove = chooseStandaloneMove(reply);
    expect(gptMove).toBe("a7a5");
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ structuredContent: chess() }) } as Response).mockResolvedValueOnce({ ok: true, json: async () => ({ structuredContent: reply }) } as Response).mockResolvedValueOnce({ ok: true, json: async () => ({ structuredContent: gpt }) } as Response);
    render(<App />); await screen.findByRole("button", { name: /white pawn on e2, movable source/i }); const user = userEvent.setup(); await user.click(screen.getByRole("button", { name: /white pawn on e2, movable source/i })); await user.click(screen.getByRole("button", { name: /empty e4, legal destination/i }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3)); expect(fetch).toHaveBeenLastCalledWith("/api/tools/play_game_move", expect.objectContaining({ body: expect.stringContaining(gptMove as string) }));
  });
  it("saves each authoritative standalone update and restores the exact game before creating a fallback", async () => {
    const start = { ...chess(), gameId: "standalone-saved" };
    const afterPlayer = chessAdvance(start, "player", "e2e4", "black", ["a7a5", "a7a6"], "Black to move.");
    const gptMove = chooseStandaloneMove(afterPlayer)!;
    const afterGpt = chessAdvance(afterPlayer, "gpt", gptMove, "white", ["d2d4"], "Saved GPT reply.");
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ structuredContent: start }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ structuredContent: afterPlayer }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ structuredContent: afterGpt }) } as Response);

    const firstMount = render(<App />);
    const pawn = await screen.findByRole("button", { name: /white pawn on e2, movable source/i });
    await waitFor(() => expect(pawn).toBeEnabled());
    await waitFor(() => expect(loadStandaloneGame()).toEqual(start));
    const user = userEvent.setup();
    await user.click(pawn);
    await user.click(screen.getByRole("button", { name: /empty e4, legal destination/i }));
    await waitFor(() => expect(loadStandaloneGame()).toEqual(afterGpt));
    firstMount.unmount();

    fetchMock.mockReset().mockResolvedValueOnce({ ok: true, json: async () => ({ structuredContent: afterGpt }) } as Response);
    render(<App />);

    expect(screen.getByText("Saved GPT reply.")).toBeVisible();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith("/api/tools/get_game_state", expect.objectContaining({ body: '{"gameId":"standalone-saved"}' }));
    expect(fetchMock.mock.calls.some(([url]) => url === "/api/tools/create_game")).toBe(false);
    await waitFor(() => expect(screen.getByRole("button", { name: /refresh/i })).toBeEnabled());
    expect(JSON.parse(window.render_game_to_text!()).game).toMatchObject({ gameId: "standalone-saved", stateVersion: 2 });
  });
  it("keeps standalone play working when browser storage writes fail", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("quota exceeded"); });
    const reply: ChessSnapshot = { ...chess(1), turn: "black", legalMoves: ["a7a5"] };
    const gpt = { ...chess(2), turn: "white", legalMoves: ["d2d4"], message: "Storage-independent reply." };
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ structuredContent: chess() }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ structuredContent: reply }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ structuredContent: gpt }) } as Response);

    render(<App />);
    const user = userEvent.setup();
    const pawn = await screen.findByRole("button", { name: /white pawn on e2, movable source/i });
    await waitFor(() => expect(pawn).toBeEnabled());
    await user.click(pawn);
    await user.click(screen.getByRole("button", { name: /empty e4, legal destination/i }));

    expect(await screen.findByText("Storage-independent reply.")).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it("renders Go legal coordinates and Pass", async () => { vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ structuredContent: chess() }) } as Response).mockResolvedValueOnce({ ok: true, json: async () => ({ structuredContent: go() }) } as Response); render(<App />); const user = userEvent.setup(); const picker = await screen.findByRole("combobox", { name: "NEW GAME" }); await user.selectOptions(picker, "go-9"); await user.click(screen.getByRole("button", { name: "Start game" })); expect(await screen.findByRole("button", { name: /Play at A9, empty, legal move/i })).toBeEnabled(); expect(fetch).toHaveBeenLastCalledWith("/api/tools/create_game", expect.objectContaining({ body: '{"game":"go","playerColor":"black","difficulty":"medium"}' })); expect(screen.getByRole("button", { name: /pass/i })).toBeEnabled(); });
  it("starts standard 19x19 Go from the game chooser", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ structuredContent: chess() }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ structuredContent: go(19) }) } as Response);
    render(<App />);
    const user = userEvent.setup();
    const picker = await screen.findByRole("combobox", { name: "NEW GAME" });
    expect(within(picker).getAllByRole("option").map(option => option.textContent)).toEqual(["Chess", "Mini 8-Ball", "Court Duel", "Tic-Tac-Toe", "Connect Four", "Reversi", "Quick Go · 9×9", "Go · 13×13", "Real Go · 19×19"]);
    expect(picker).toHaveValue("chess");
    await screen.findByRole("group", { name: "Chess board" });
    await user.selectOptions(picker, "go-19");
    expect(screen.getByRole("group", { name: "Chess board" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Start game" }));
    expect(await screen.findByRole("group", { name: "19 by 19 Go board" })).toBeVisible();
    expect(screen.queryByRole("region", { name: "19 by 19 Go board viewport" })).not.toBeInTheDocument();
    expect(screen.queryByText("Scroll to explore the full 19×19 board.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play at A19, empty, legal move" })).toBeEnabled();
    expect(picker).toHaveValue("go-19");
    expect(fetch).toHaveBeenLastCalledWith("/api/tools/create_game", expect.objectContaining({ body: '{"game":"go","playerColor":"black","difficulty":"medium","boardSize":19}' }));
  });
  it("keeps the current game until submit and locks the chooser while starting", async () => {
    let resolveStart!: (response: Response) => void;
    vi.mocked(fetch).mockReturnValueOnce(new Promise<Response>(resolve => { resolveStart = resolve; }));
    render(<App initialGame={chess()}/>);
    const user = userEvent.setup();
    const picker = screen.getByRole("combobox", { name: "NEW GAME" });
    const difficulty = screen.getByRole("combobox", { name: "DIFFICULTY" });
    expect(within(difficulty).getAllByRole("option").map(option => option.textContent)).toEqual(["Easy", "Medium", "Hard"]);
    await user.selectOptions(picker, "go-13");
    await user.selectOptions(difficulty, "hard");
    expect(screen.getByRole("group", { name: "Chess board" })).toBeVisible();
    expect(screen.getByText("Medium difficulty")).toBeVisible();
    expect(fetch).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Start game" }));
    expect(picker).toBeDisabled();
    expect(difficulty).toBeDisabled();
    expect(screen.getByRole("button", { name: "Starting…" })).toBeDisabled();
    expect(screen.getByRole("group", { name: "Chess board" })).toBeVisible();
    resolveStart({ ok: true, json: async () => ({ structuredContent: go(13, "hard") }) } as Response);
    expect(await screen.findByRole("group", { name: "13 by 13 Go board" })).toBeVisible();
    expect(screen.getByText("Hard difficulty")).toBeVisible();
    await waitFor(() => expect(screen.getByRole("button", { name: "Start game" })).toBeEnabled());
    expect(fetch).toHaveBeenCalledWith("/api/tools/create_game", expect.objectContaining({ body: '{"game":"go","playerColor":"black","difficulty":"hard","boardSize":13}' }));
  });
  it("maps large Go columns through T while skipping I", () => { const start = { ...go(19), legalMoves: ["J19", "T1", "pass"] }; render(<App initialGame={start}/>); expect(screen.getByRole("button", { name: "Play at J19, empty, legal move" })).toBeEnabled(); expect(screen.getByRole("button", { name: "Play at T1, empty, legal move" })).toBeEnabled(); expect(screen.queryByRole("button", { name: / I19/i })).not.toBeInTheDocument(); });
  it("shows and gates a photo-import review before the player can continue", async () => {
    const user = userEvent.setup();
    const pending = importedGo("white", "white");
    const confirmed = { ...importedGo("white", "white", 0, "confirmed"), stateVersion: 1 };
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ structuredContent: confirmed }) } as Response);
    render(<App initialGame={pending}/>);

    const review = screen.getByRole("region", { name: "Imported Go position review" });
    expect(within(review).getByText("Imported Go position")).toBeVisible();
    expect(within(review).getByText("9×9 · 1 Black · 1 White")).toBeVisible();
    expect(within(review).getByText("You: White · Next: White (you)")).toBeVisible();
    expect(screen.getByRole("button", { name: "black stone at D4" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "white stone at E4" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Empty A9" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /pass/i })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Review the imported stones");
    expect(JSON.parse(window.render_game_to_text!()).importReview).toEqual({ required: true, pending: true, authoritativeStatus: "pending", source: "imported", blackStones: 1, whiteStones: 1, initialTurn: "white" });

    await user.click(within(review).getByRole("button", { name: "Looks right — continue" }));
    expect(within(review).getByText("✓ Verified")).toBeVisible();
    expect(screen.getByRole("button", { name: "Play at A9, empty, legal move" })).toBeEnabled();
    expect(screen.getByRole("button", { name: /pass/i })).toBeEnabled();
    expect(screen.getByRole("status")).toHaveTextContent("Imported position. White to move.");
    expect(JSON.parse(window.render_game_to_text!()).importReview).toMatchObject({ required: false, pending: false, authoritativeStatus: "confirmed" });
    expect(fetch).toHaveBeenCalledWith("/api/tools/confirm_imported_go_position", expect.objectContaining({ body: '{"gameId":"imported-go","expectedVersion":0,"expectedResetEpoch":0}' }));
  });
  it("waits for imported-position review before making one direct GPT move under StrictMode", async () => {
    const sendFollowUpMessage = vi.fn().mockResolvedValue(undefined);
    const setWidgetState = vi.fn();
    Object.defineProperty(window, "openai", { configurable: true, value: { sendFollowUpMessage, setWidgetState } });
    const target = { postMessage: vi.fn() } as unknown as Window;
    const bridge = new GameBridge(target, 100_000);
    const user = userEvent.setup();

    render(<StrictMode><App bridge={bridge} initialGame={importedGo("white", "black")}/></StrictMode>);
    expect(screen.getByText("You: White · Next: Black (GPT)")).toBeVisible();
    expect(sendFollowUpMessage).not.toHaveBeenCalled();
    await waitFor(() => expect(target.postMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 1, method: "ui/initialize" }), "*"));
    window.dispatchEvent(new MessageEvent("message", { source: target, data: { jsonrpc: "2.0", id: 1, result: { hostCapabilities: { serverTools: {}, message: {} } } } }));
    await user.click(screen.getByRole("button", { name: "Looks right — continue" }));

    await waitFor(() => expect(target.postMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 2, method: "tools/call", params: { name: "confirm_imported_go_position", arguments: { gameId: "imported-go", expectedVersion: 0, expectedResetEpoch: 0 } } }), "*"));
    window.dispatchEvent(new MessageEvent("message", { source: target, data: { jsonrpc: "2.0", id: 2, result: { structuredContent: { ...importedGo("white", "black", 0, "confirmed"), stateVersion: 1 } } } }));

    await waitFor(() => expect(target.postMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 3, method: "tools/call", params: { name: "play_game_move", arguments: { gameId: "imported-go", actor: "gpt", move: chooseStandaloneMove({ ...importedGo("white", "black", 0, "confirmed"), stateVersion: 1 }), expectedVersion: 1, expectedResetEpoch: 0 } } }), "*"));
    expect(sendFollowUpMessage).not.toHaveBeenCalled();
    await waitFor(() => expect(setWidgetState).toHaveBeenCalledWith(expect.objectContaining({ game: expect.objectContaining({ importReview: "confirmed", stateVersion: 1 }) })));
    expect(setWidgetState).not.toHaveBeenCalledWith(expect.objectContaining({ reviewedImportKey: expect.anything() }));
    bridge.dispose();
  });
  it("does not let Refresh bypass a pending imported-position review", async () => {
    const pending = importedGo("white", "black");
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ structuredContent: pending }) } as Response);
    const user = userEvent.setup();
    render(<App initialGame={pending}/>);

    await user.click(screen.getByRole("button", { name: /refresh/i }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledWith("/api/tools/get_game_state", expect.objectContaining({ body: '{"gameId":"imported-go"}' }));
    expect(screen.getByRole("button", { name: "Looks right — continue" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Empty A9" })).toBeDisabled();
  });
  it("hydrates a pending imported board from the actual ChatGPT tool output", () => {
    Object.defineProperty(window, "openai", { configurable: true, value: { toolOutput: { structuredContent: importedGo("black", "white") } } });
    render(<App/>);

    expect(screen.getByRole("region", { name: "Imported Go position review" })).toBeVisible();
    expect(screen.getByText("You: Black · Next: White (GPT)")).toBeVisible();
    expect(screen.getByRole("button", { name: "Empty A9" })).toBeDisabled();
  });
  it("requires a fresh authoritative review after resetting an imported game", async () => {
    const confirmed = { ...importedGo("white", "white", 0, "confirmed"), stateVersion: 1 };
    const reset = importedGo("white", "white", 1, "pending");
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ structuredContent: reset }) } as Response);
    const user = userEvent.setup();
    render(<App initialGame={confirmed}/>);
    expect(screen.getByRole("button", { name: "Play at A9, empty, legal move" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: /reset/i }));
    await user.click(within(screen.getByRole("alertdialog", { name: "Reset this game?" })).getByRole("button", { name: "Reset game" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Looks right — continue" })).toBeEnabled());
    expect(screen.getByRole("button", { name: "Empty A9" })).toBeDisabled();
    expect(JSON.parse(window.render_game_to_text!()).importReview).toMatchObject({ pending: true, authoritativeStatus: "pending" });
    expect(fetch).toHaveBeenCalledWith("/api/tools/reset_game", expect.objectContaining({ body: '{"gameId":"imported-go","confirmed":true,"expectedVersion":1,"expectedResetEpoch":0}' }));
  });
  it("shows safe accessible errors", async () => { vi.mocked(fetch).mockResolvedValue({ ok: false, json: async () => ({ error: { message: "Nope" } }) } as Response); render(<App />); expect(await screen.findByRole("alert")).toHaveTextContent("Nope"); });
  it("sends Go Pass with the authoritative version and accepts reset stateVersion zero", async () => {
    const user = userEvent.setup(); const start = { ...go(9, "hard"), stateVersion: 5 }; const afterPass = { ...start, stateVersion: 6, turn: "white", legalMoves: ["B9"] }; const reset = { ...start, resetEpoch: 1, stateVersion: 0 };
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ structuredContent: afterPass }) } as Response).mockResolvedValueOnce({ ok: true, json: async () => ({ structuredContent: { ...afterPass, stateVersion: 7, turn: "black", legalMoves: ["A9"] } }) } as Response).mockResolvedValueOnce({ ok: true, json: async () => ({ structuredContent: reset }) } as Response);
    render(<App initialGame={start}/>); expect(screen.getByText("Hard difficulty")).toBeVisible(); await user.click(screen.getByRole("button", { name: /pass/i })); await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/tools/play_game_move", expect.objectContaining({ body: expect.stringContaining('"move":"pass"') }))); await user.click(screen.getByRole("button", { name: /reset/i })); await user.click(within(screen.getByRole("alertdialog", { name: "Reset this game?" })).getByRole("button", { name: "Reset game" })); await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Choose a piece")); expect(screen.getByText("Hard difficulty")).toBeVisible(); expect(fetch).toHaveBeenLastCalledWith("/api/tools/reset_game", expect.objectContaining({ body: '{"gameId":"go-9","confirmed":true,"expectedVersion":7,"expectedResetEpoch":0}' }));
  });
  it("waits for the embedded host result instead of creating a fallback chess game", async () => {
    const postMessage = vi.fn();
    const target = { postMessage } as unknown as Window;
    const bridge = new GameBridge(target, 100_000);
    render(<App bridge={bridge}/>);

    expect(screen.getByRole("status")).toHaveTextContent("Loading game…");
    expect(screen.queryByRole("combobox", { name: "NEW GAME" })).not.toBeInTheDocument();
    await waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ method: "ui/initialize" }), "*"));
    const createCalls = () => postMessage.mock.calls.filter(([request]) => {
      const value = request as { method?: string; params?: { name?: string } };
      return value.method === "tools/call" && value.params?.name === "create_game";
    });
    expect(createCalls()).toHaveLength(0);

    window.dispatchEvent(new MessageEvent("message", { source: target, data: { jsonrpc: "2.0", id: 1, result: { hostCapabilities: { serverTools: {}, message: {} } } } }));
    window.dispatchEvent(new MessageEvent("message", { source: target, data: { jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { result: { structuredContent: go(9, "hard") } } } }));

    expect(await screen.findByRole("group", { name: "9 by 9 Go board" })).toBeVisible();
    expect(screen.getByText("Hard difficulty")).toBeVisible();
    expect(screen.getByRole("combobox", { name: "NEW GAME" })).toHaveValue("go-9");
    expect(screen.getByRole("combobox", { name: "DIFFICULTY" })).toHaveValue("hard");
    expect(screen.queryByText("Loading game…")).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Chess board" })).not.toBeInTheDocument();
    expect(createCalls()).toHaveLength(0);
    bridge.dispose();
  });
  it("restores an embedded game from ChatGPT widget state after reload", async () => {
    const setWidgetState = vi.fn();
    saveStandaloneGame(basketball());
    Object.defineProperty(window, "openai", { configurable: true, value: { toolOutput: chess(), widgetState: { game: go(9, "hard") }, setWidgetState } });
    const postMessage = vi.fn();
    const target = { postMessage } as unknown as Window;
    const bridge = new GameBridge(target, 100_000);

    render(<App bridge={bridge}/>);

    expect(screen.getByRole("group", { name: "9 by 9 Go board" })).toBeVisible();
    expect(screen.getByRole("combobox", { name: "NEW GAME" })).toHaveValue("go-9");
    expect(screen.getByRole("combobox", { name: "DIFFICULTY" })).toHaveValue("hard");
    expect(screen.queryByText("Loading game…")).not.toBeInTheDocument();
    window.dispatchEvent(new MessageEvent("message", { source: target, data: { jsonrpc: "2.0", id: 1, result: { hostCapabilities: { serverTools: {}, message: {} } } } }));
    await waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 2, method: "tools/call", params: { name: "get_game_state", arguments: { gameId: "go-9" } } }), "*"));
    window.dispatchEvent(new MessageEvent("message", { source: target, data: { jsonrpc: "2.0", id: 2, result: { structuredContent: go(9, "hard") } } }));
    await waitFor(() => expect(setWidgetState).toHaveBeenCalledWith({ game: go(9, "hard") }));
    await waitFor(() => expect(screen.getByRole("button", { name: /refresh/i })).toBeEnabled());
    bridge.dispose();
  });
  it("reconciles a reloaded GPT turn once under StrictMode, then makes exactly one GPT move", async () => {
    const saved = chessAdvance(chess(0, "hard"), "player", "e2e4", "black", ["a7a6"], "Black to move.");
    const newer = chessAdvance(saved, "gpt", "a7a6", "white", ["e2e4"], "Recovered GPT move.");
    Object.defineProperty(window, "openai", { configurable: true, value: { widgetState: { game: saved }, setWidgetState: vi.fn() } });
    const postMessage = vi.fn();
    const target = { postMessage } as unknown as Window;
    const bridge = new GameBridge(target, 100_000);
    const respond = async (id: number, result: unknown) => { window.dispatchEvent(new MessageEvent("message", { source: target, data: { jsonrpc: "2.0", id, result } })); await Promise.resolve(); await Promise.resolve(); };

    render(<StrictMode><App bridge={bridge}/></StrictMode>);
    await respond(1, { hostCapabilities: { serverTools: {}, message: {} } });
    await waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 2, method: "tools/call", params: expect.objectContaining({ name: "get_game_state" }) }), "*"));
    await respond(2, { structuredContent: saved });
    const reconciliationCalls = () => postMessage.mock.calls.filter(([request]) => { const value = request as { method?: string; params?: { name?: string } }; return value.method === "tools/call" && value.params?.name === "get_game_state"; });
    const gptCalls = () => postMessage.mock.calls.filter(([request]) => { const value = request as { method?: string; params?: { name?: string } }; return value.method === "tools/call" && value.params?.name === "play_game_move"; });
    expect(reconciliationCalls()).toHaveLength(1);
    await waitFor(() => expect(gptCalls()).toHaveLength(1));
    await respond(3, { structuredContent: newer });
    await waitFor(() => expect(screen.getByText("Recovered GPT move.")).toBeVisible());
    expect(gptCalls()).toHaveLength(1);
    bridge.dispose();
  });
  it("uses a newer authoritative player-turn snapshot on reload without prompting GPT", async () => {
    const saved = { ...chess(1, "hard"), turn: "black" as const, legalMoves: ["a7a6"], message: "Saved GPT turn." };
    const newer = { ...chess(2, "hard"), turn: "white" as const, legalMoves: ["e2e4"], message: "GPT already moved." };
    Object.defineProperty(window, "openai", { configurable: true, value: { widgetState: { game: saved }, setWidgetState: vi.fn() } });
    const postMessage = vi.fn();
    const target = { postMessage } as unknown as Window;
    const bridge = new GameBridge(target, 100_000);

    render(<App bridge={bridge}/>);
    window.dispatchEvent(new MessageEvent("message", { source: target, data: { jsonrpc: "2.0", id: 1, result: { hostCapabilities: { serverTools: {}, message: {} } } } }));
    await waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 2, method: "tools/call" }), "*"));
    window.dispatchEvent(new MessageEvent("message", { source: target, data: { jsonrpc: "2.0", id: 2, result: { structuredContent: newer } } }));

    expect(await screen.findByText("GPT already moved.")).toBeVisible();
    expect(screen.getByRole("button", { name: /white pawn on e2, movable source/i })).toBeEnabled();
    expect(postMessage.mock.calls.filter(([request]) => (request as { method?: string }).method === "ui/message")).toHaveLength(0);
    bridge.dispose();
  });
  it("keeps the saved board visible when the server reports an expired session", async () => {
    const saved = { ...chess(7, "hard"), turn: "black" as const, legalMoves: ["a7a6"], message: "Saved board." };
    Object.defineProperty(window, "openai", { configurable: true, value: { widgetState: { game: saved }, setWidgetState: vi.fn() } });
    const postMessage = vi.fn();
    const target = { postMessage } as unknown as Window;
    const bridge = new GameBridge(target, 100_000);

    render(<App bridge={bridge}/>);
    window.dispatchEvent(new MessageEvent("message", { source: target, data: { jsonrpc: "2.0", id: 1, result: { hostCapabilities: { serverTools: {}, message: {} } } } }));
    await waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 2, method: "tools/call" }), "*"));
    window.dispatchEvent(new MessageEvent("message", { source: target, data: { jsonrpc: "2.0", id: 2, result: { isError: true, content: [{ type: "text", text: "not_found: The game was not found." }] } } }));

    expect(await screen.findByRole("alert")).toHaveTextContent("This saved game session has expired. Start a new game to continue.");
    expect(screen.getByRole("group", { name: "Chess board" })).toBeVisible();
    expect(screen.getByText("Saved board.")).toBeVisible();
    expect(postMessage.mock.calls.filter(([request]) => (request as { method?: string }).method === "ui/message")).toHaveLength(0);
    bridge.dispose();
  });
  it("replaces embedded loading with an initialization error", async () => {
    const target = { postMessage: vi.fn() } as unknown as Window;
    const bridge = new GameBridge(target, 1);

    render(<App bridge={bridge}/>);

    expect(screen.getByText("Loading game…")).toBeVisible();
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not initialize the game host.");
    expect(screen.queryByText("Loading game…")).not.toBeInTheDocument();
    bridge.dispose();
  });
  it("uses exactly one direct, deterministic embedded GPT move and only unlocks after its matching receipt", async () => {
    const postMessage = vi.fn();
    const target = { postMessage } as unknown as Window;
    const bridge = new GameBridge(target, 100_000);
    const start = { ...chess(0, "easy"), resetEpoch: 3 };
    const after = chessAdvance(start, "player", "e2e4", "black", ["a7a6", "b7b6"], "Black to move.");
    const gptMove = chooseStandaloneMove(after)!;
    const newer = chessAdvance(after, "gpt", gptMove, "white", ["e2e4"], "Authoritative GPT move landed.");
    const respond = async (id: number, result: unknown) => { window.dispatchEvent(new MessageEvent("message", { source: target, data: { jsonrpc: "2.0", id, result } })); await Promise.resolve(); await Promise.resolve(); };
    const calls = (name?: string) => postMessage.mock.calls.map(([request]) => request as { method?: string; params?: { name?: string; arguments?: unknown } }).filter(request => request.method === "tools/call" && (name === undefined || request.params?.name === name));

    render(<App bridge={bridge} initialGame={start}/>);
    fireEvent.click(screen.getByRole("button", { name: /white pawn on e2, movable source/i }));
    fireEvent.click(screen.getByRole("button", { name: /empty e4, legal destination/i }));
    await respond(1, { hostCapabilities: { serverTools: {}, message: {} } });
    await waitFor(() => expect(calls("play_game_move")).toHaveLength(1));
    await respond(2, { structuredContent: after });

    await waitFor(() => expect(calls("play_game_move")).toHaveLength(2));
    expect(calls("play_game_move")[1]).toEqual(expect.objectContaining({ params: { name: "play_game_move", arguments: { gameId: after.gameId, actor: "gpt", move: gptMove, expectedVersion: after.stateVersion, expectedResetEpoch: 3 } } }));
    expect(calls("get_game_state")).toHaveLength(0);
    expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ method: "ui/message" }), "*");
    expect(screen.getByText("GPT thinking…")).toBeVisible();
    expect(screen.getByRole("button", { name: /white pawn on e2/i })).toBeDisabled();

    await respond(3, { structuredContent: newer });
    await waitFor(() => expect(screen.getByText("Authoritative GPT move landed.")).toBeVisible());
    expect(screen.getByRole("button", { name: /white pawn on e2, movable source/i })).toBeEnabled();
    bridge.dispose();
  });
  it("reads state exactly once after an ambiguous embedded GPT result and accepts only the matching advance", async () => {
    const postMessage = vi.fn();
    const target = { postMessage } as unknown as Window;
    const bridge = new GameBridge(target, 100_000);
    const start = chess(0, "hard");
    const after = chessAdvance(start, "player", "e2e4", "black", ["a7a6"], "Black to move.");
    const gptMove = chooseStandaloneMove(after)!;
    const recovered = chessAdvance(after, "gpt", gptMove, "white", ["e2e4"], "Recovered direct GPT move.");
    const respond = async (id: number, result?: unknown, error?: string) => { window.dispatchEvent(new MessageEvent("message", { source: target, data: error ? { jsonrpc: "2.0", id, error: { message: error } } : { jsonrpc: "2.0", id, result } })); await Promise.resolve(); await Promise.resolve(); };
    const calls = (name: string) => postMessage.mock.calls.map(([request]) => request as { method?: string; params?: { name?: string } }).filter(request => request.method === "tools/call" && request.params?.name === name);

    render(<App bridge={bridge} initialGame={start}/>);
    fireEvent.click(screen.getByRole("button", { name: /white pawn on e2, movable source/i }));
    fireEvent.click(screen.getByRole("button", { name: /empty e4, legal destination/i }));
    await respond(1, { hostCapabilities: { serverTools: {}, message: {} } });
    await waitFor(() => expect(calls("play_game_move")).toHaveLength(1));
    await respond(2, { structuredContent: after });
    await waitFor(() => expect(calls("play_game_move")).toHaveLength(2));
    await respond(3, undefined, "temporary host timeout");

    await waitFor(() => expect(calls("get_game_state")).toHaveLength(1));
    await respond(4, { structuredContent: recovered });
    await waitFor(() => expect(screen.getByText("Recovered direct GPT move.")).toBeVisible());
    await waitFor(() => expect(calls("play_game_move")).toHaveLength(2));
    expect(calls("get_game_state")).toHaveLength(1);
    bridge.dispose();
  });
  it("accepts a strict manual end from the one ambiguous GPT recovery read", async () => {
    const postMessage = vi.fn();
    const target = { postMessage } as unknown as Window;
    const bridge = new GameBridge(target, 100_000);
    const start = chess(0, "hard");
    const after = chessAdvance(start, "player", "e2e4", "black", ["a7a6"], "Black to move.");
    const ended: ChessSnapshot = { ...after, status: "finished", finishReason: "ended", legalMoves: [], stateVersion: 2, message: "Recovered manual end." };
    const respond = async (id: number, result?: unknown, error?: string) => { window.dispatchEvent(new MessageEvent("message", { source: target, data: error ? { jsonrpc: "2.0", id, error: { message: error } } : { jsonrpc: "2.0", id, result } })); await Promise.resolve(); await Promise.resolve(); };
    const calls = (name: string) => postMessage.mock.calls.map(([request]) => request as { method?: string; params?: { name?: string } }).filter(request => request.method === "tools/call" && request.params?.name === name);

    render(<App bridge={bridge} initialGame={start}/>);
    fireEvent.click(screen.getByRole("button", { name: /white pawn on e2, movable source/i }));
    fireEvent.click(screen.getByRole("button", { name: /empty e4, legal destination/i }));
    await respond(1, { hostCapabilities: { serverTools: {}, message: {} } });
    await waitFor(() => expect(calls("play_game_move")).toHaveLength(1));
    await respond(2, { structuredContent: after });
    await waitFor(() => expect(calls("play_game_move")).toHaveLength(2));
    await respond(3, undefined, "temporary host timeout");
    await waitFor(() => expect(calls("get_game_state")).toHaveLength(1));
    await respond(4, { structuredContent: ended });

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Recovered manual end."));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(calls("play_game_move")).toHaveLength(2);
    expect(calls("get_game_state")).toHaveLength(1);
    bridge.dispose();
  });
  it("accepts a reset lifecycle from the one ambiguous GPT recovery read", async () => {
    const postMessage = vi.fn();
    const target = { postMessage } as unknown as Window;
    const bridge = new GameBridge(target, 100_000);
    const start = { ...chess(0, "hard"), resetEpoch: 0 };
    const after = chessAdvance(start, "player", "e2e4", "black", ["a7a6"], "Black to move.");
    const reset: ChessSnapshot = { ...chess(0, "hard"), resetEpoch: 1, message: "Recovered reset." };
    const respond = async (id: number, result?: unknown, error?: string) => { window.dispatchEvent(new MessageEvent("message", { source: target, data: error ? { jsonrpc: "2.0", id, error: { message: error } } : { jsonrpc: "2.0", id, result } })); await Promise.resolve(); await Promise.resolve(); };
    const calls = (name: string) => postMessage.mock.calls.map(([request]) => request as { method?: string; params?: { name?: string } }).filter(request => request.method === "tools/call" && request.params?.name === name);

    render(<App bridge={bridge} initialGame={start}/>);
    fireEvent.click(screen.getByRole("button", { name: /white pawn on e2, movable source/i }));
    fireEvent.click(screen.getByRole("button", { name: /empty e4, legal destination/i }));
    await respond(1, { hostCapabilities: { serverTools: {}, message: {} } });
    await waitFor(() => expect(calls("play_game_move")).toHaveLength(1));
    await respond(2, { structuredContent: after });
    await waitFor(() => expect(calls("play_game_move")).toHaveLength(2));
    await respond(3, undefined, "temporary host timeout");
    await waitFor(() => expect(calls("get_game_state")).toHaveLength(1));
    await respond(4, { structuredContent: reset });

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Choose a piece to begin."));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(JSON.parse(window.render_game_to_text!()).game).toMatchObject({ resetEpoch: 1, stateVersion: 0, message: "Recovered reset." });
    expect(calls("play_game_move")).toHaveLength(2);
    expect(calls("get_game_state")).toHaveLength(1);
    bridge.dispose();
  });
  it("suppresses a stale GPT recovery read after an explicit Reset interrupts its epoch", async () => {
    const postMessage = vi.fn();
    const target = { postMessage } as unknown as Window;
    const bridge = new GameBridge(target, 100_000);
    const start = { ...chess(0, "hard"), resetEpoch: 0 };
    const after = chessAdvance(start, "player", "e2e4", "black", ["a7a6"], "Black to move.");
    const gptMove = chooseStandaloneMove(after)!;
    const staleRecovery = chessAdvance(after, "gpt", gptMove, "white", ["e2e4"], "Stale recovered GPT move.");
    const reset: ChessSnapshot = { ...chess(0, "hard"), resetEpoch: 1, message: "Explicit reset won." };
    const respond = async (id: number, result?: unknown, error?: string) => { window.dispatchEvent(new MessageEvent("message", { source: target, data: error ? { jsonrpc: "2.0", id, error: { message: error } } : { jsonrpc: "2.0", id, result } })); await Promise.resolve(); await Promise.resolve(); };
    const calls = (name: string) => postMessage.mock.calls.map(([request]) => request as { method?: string; params?: { name?: string } }).filter(request => request.method === "tools/call" && request.params?.name === name);

    render(<App bridge={bridge} initialGame={start}/>);
    fireEvent.click(screen.getByRole("button", { name: /white pawn on e2, movable source/i }));
    fireEvent.click(screen.getByRole("button", { name: /empty e4, legal destination/i }));
    await respond(1, { hostCapabilities: { serverTools: {}, message: {} } });
    await waitFor(() => expect(calls("play_game_move")).toHaveLength(1));
    await respond(2, { structuredContent: after });
    await waitFor(() => expect(calls("play_game_move")).toHaveLength(2));
    await respond(3, undefined, "temporary host timeout");
    await waitFor(() => expect(calls("get_game_state")).toHaveLength(1));

    fireEvent.click(screen.getByRole("button", { name: /reset/i }));
    fireEvent.click(within(screen.getByRole("alertdialog", { name: "Reset this game?" })).getByRole("button", { name: "Reset game" }));
    await waitFor(() => expect(calls("reset_game")).toHaveLength(1));
    await respond(5, { structuredContent: reset });
    await waitFor(() => expect(screen.getByText("Explicit reset won.")).toBeVisible());

    await respond(4, { structuredContent: staleRecovery });
    expect(screen.getByText("Explicit reset won.")).toBeVisible();
    expect(screen.queryByText("Stale recovered GPT move.")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(calls("play_game_move")).toHaveLength(2);
    expect(calls("get_game_state")).toHaveLength(1);
    bridge.dispose();
  });
  it("keeps the board unchanged when the one ambiguous GPT state read has a mismatched receipt", async () => {
    const postMessage = vi.fn();
    const target = { postMessage } as unknown as Window;
    const bridge = new GameBridge(target, 100_000);
    const start = chess(0, "hard");
    const after = chessAdvance(start, "player", "e2e4", "black", ["a7a6"], "Black to move.");
    const gptMove = chooseStandaloneMove(after)!;
    const mismatched = chessAdvance(after, "gpt", gptMove === "a7a6" ? "b7b6" : "a7a6", "white", ["e2e4"], "Wrong GPT receipt.");
    const respond = async (id: number, result?: unknown, error?: string) => { window.dispatchEvent(new MessageEvent("message", { source: target, data: error ? { jsonrpc: "2.0", id, error: { message: error } } : { jsonrpc: "2.0", id, result } })); await Promise.resolve(); await Promise.resolve(); };
    const calls = (name: string) => postMessage.mock.calls.map(([request]) => request as { method?: string; params?: { name?: string } }).filter(request => request.method === "tools/call" && request.params?.name === name);

    render(<App bridge={bridge} initialGame={start}/>);
    fireEvent.click(screen.getByRole("button", { name: /white pawn on e2, movable source/i }));
    fireEvent.click(screen.getByRole("button", { name: /empty e4, legal destination/i }));
    await respond(1, { hostCapabilities: { serverTools: {}, message: {} } });
    await waitFor(() => expect(calls("play_game_move")).toHaveLength(1));
    await respond(2, { structuredContent: after });
    await waitFor(() => expect(calls("play_game_move")).toHaveLength(2));
    await respond(3, undefined, "temporary host timeout");
    await waitFor(() => expect(calls("get_game_state")).toHaveLength(1));
    await respond(4, { structuredContent: mismatched });

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("GPT move was not confirmed. Use Refresh to continue."));
    expect(screen.getByText("Black to move.")).toBeVisible();
    expect(screen.queryByText("Wrong GPT receipt.")).not.toBeInTheDocument();
    expect(calls("play_game_move")).toHaveLength(2);
    expect(calls("get_game_state")).toHaveLength(1);
    bridge.dispose();
  });
  it("ignores same-game tool notifications until the pending direct GPT receipt arrives", async () => {
    const postMessage = vi.fn();
    const target = { postMessage } as unknown as Window;
    const bridge = new GameBridge(target, 100_000);
    const start = chess(0, "hard");
    const after = chessAdvance(start, "player", "e2e4", "black", ["a7a6", "b7b6"], "Black to move.");
    const gptMove = chooseStandaloneMove(after)!;
    const expected = chessAdvance(after, "gpt", gptMove, "white", ["e2e4"], "Confirmed direct move.");
    const unexpected = chessAdvance(after, "gpt", gptMove === "a7a6" ? "b7b6" : "a7a6", "white", ["e2e4"], "Injected notification.");
    const respond = async (id: number, result: unknown) => { window.dispatchEvent(new MessageEvent("message", { source: target, data: { jsonrpc: "2.0", id, result } })); await Promise.resolve(); await Promise.resolve(); };
    const gptCalls = () => postMessage.mock.calls.map(([request]) => request as { method?: string; params?: { name?: string; arguments?: { actor?: string } } }).filter(request => request.method === "tools/call" && request.params?.name === "play_game_move" && request.params.arguments?.actor === "gpt");

    render(<App bridge={bridge} initialGame={start}/>);
    fireEvent.click(screen.getByRole("button", { name: /white pawn on e2, movable source/i }));
    fireEvent.click(screen.getByRole("button", { name: /empty e4, legal destination/i }));
    await respond(1, { hostCapabilities: { serverTools: {}, message: {} } });
    await waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 2, method: "tools/call", params: { name: "play_game_move", arguments: expect.objectContaining({ actor: "player" }) } }), "*"));
    await respond(2, { structuredContent: after });
    await waitFor(() => expect(gptCalls()).toHaveLength(1));

    window.dispatchEvent(new MessageEvent("message", { source: target, data: { jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { structuredContent: unexpected } } }));
    await Promise.resolve();
    expect(screen.getByText("Black to move.")).toBeVisible();
    expect(screen.queryByText("Injected notification.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /white pawn on e2/i })).toBeDisabled();

    await respond(3, { structuredContent: expected });
    await waitFor(() => expect(screen.getByText("Confirmed direct move.")).toBeVisible());
    expect(gptCalls()).toHaveLength(1);
    bridge.dispose();
  });
  it("ignores a structurally valid but corrupt reset notification during a pending GPT receipt", async () => {
    const postMessage = vi.fn();
    const target = { postMessage } as unknown as Window;
    const bridge = new GameBridge(target, 100_000);
    const start = { ...chess(0, "hard"), resetEpoch: 0 };
    const after = chessAdvance(start, "player", "e2e4", "black", ["a7a6"], "Black to move.");
    const gptMove = chooseStandaloneMove(after)!;
    const expected = chessAdvance(after, "gpt", gptMove, "white", ["e2e4"], "Confirmed direct move.");
    const corruptReset: ChessSnapshot = { ...chess(0, "hard"), resetEpoch: 1, message: "Corrupt reset notification.", board: chess().board.map(cell => cell.square === "a8" ? { ...cell, color: "black", piece: "q" } : cell) };
    const respond = async (id: number, result: unknown) => { window.dispatchEvent(new MessageEvent("message", { source: target, data: { jsonrpc: "2.0", id, result } })); await Promise.resolve(); await Promise.resolve(); };
    const calls = (name: string) => postMessage.mock.calls.map(([request]) => request as { method?: string; params?: { name?: string; arguments?: { actor?: string } } }).filter(request => request.method === "tools/call" && request.params?.name === name);

    render(<App bridge={bridge} initialGame={start}/>);
    fireEvent.click(screen.getByRole("button", { name: /white pawn on e2, movable source/i }));
    fireEvent.click(screen.getByRole("button", { name: /empty e4, legal destination/i }));
    await respond(1, { hostCapabilities: { serverTools: {}, message: {} } });
    await waitFor(() => expect(calls("play_game_move")).toHaveLength(1));
    await respond(2, { structuredContent: after });
    await waitFor(() => expect(calls("play_game_move")).toHaveLength(2));

    window.dispatchEvent(new MessageEvent("message", { source: target, data: { jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { structuredContent: corruptReset } } }));
    await Promise.resolve();
    expect(screen.getByText("Black to move.")).toBeVisible();
    expect(screen.queryByText("Corrupt reset notification.")).not.toBeInTheDocument();
    expect(screen.getByText("GPT thinking…")).toBeVisible();

    await respond(3, { structuredContent: expected });
    await waitFor(() => expect(screen.getByText("Confirmed direct move.")).toBeVisible());
    expect(calls("play_game_move")).toHaveLength(2);
    bridge.dispose();
  });
  it("does not read or retry after a definite embedded GPT rejection", async () => {
    const postMessage = vi.fn();
    const target = { postMessage } as unknown as Window;
    const bridge = new GameBridge(target, 100_000);
    const start = chess(0, "hard");
    const after = chessAdvance(start, "player", "e2e4", "black", ["a7a6"], "Black to move.");
    const respond = async (id: number, result: unknown) => { window.dispatchEvent(new MessageEvent("message", { source: target, data: { jsonrpc: "2.0", id, result } })); await Promise.resolve(); await Promise.resolve(); };
    const calls = (name: string) => postMessage.mock.calls.map(([request]) => request as { method?: string; params?: { name?: string } }).filter(request => request.method === "tools/call" && request.params?.name === name);

    render(<App bridge={bridge} initialGame={start}/>);
    fireEvent.click(screen.getByRole("button", { name: /white pawn on e2, movable source/i }));
    fireEvent.click(screen.getByRole("button", { name: /empty e4, legal destination/i }));
    await respond(1, { hostCapabilities: { serverTools: {}, message: {} } });
    await waitFor(() => expect(calls("play_game_move")).toHaveLength(1));
    await respond(2, { structuredContent: after });
    await waitFor(() => expect(calls("play_game_move")).toHaveLength(2));
    await respond(3, { isError: true, content: [{ type: "text", text: "MOVE_NOT_APPLIED stale_version: The game changed." }] });

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("MOVE_NOT_APPLIED"));
    expect(calls("play_game_move")).toHaveLength(2);
    expect(calls("get_game_state")).toHaveLength(0);
    bridge.dispose();
  });
  it("treats an ambiguous result mentioning a missing MOVE_NOT_APPLIED receipt as ambiguous", async () => {
    const postMessage = vi.fn();
    const target = { postMessage } as unknown as Window;
    const bridge = new GameBridge(target, 100_000);
    const start = chess(0, "hard");
    const after = chessAdvance(start, "player", "e2e4", "black", ["a7a6"], "Black to move.");
    const gptMove = chooseStandaloneMove(after)!;
    const recovered = chessAdvance(after, "gpt", gptMove, "white", ["e2e4"], "Recovered after ambiguous protocol result.");
    const respond = async (id: number, result: unknown) => { window.dispatchEvent(new MessageEvent("message", { source: target, data: { jsonrpc: "2.0", id, result } })); await Promise.resolve(); await Promise.resolve(); };
    const calls = (name: string) => postMessage.mock.calls.map(([request]) => request as { method?: string; params?: { name?: string } }).filter(request => request.method === "tools/call" && request.params?.name === name);

    render(<App bridge={bridge} initialGame={start}/>);
    fireEvent.click(screen.getByRole("button", { name: /white pawn on e2, movable source/i }));
    fireEvent.click(screen.getByRole("button", { name: /empty e4, legal destination/i }));
    await respond(1, { hostCapabilities: { serverTools: {}, message: {} } });
    await waitFor(() => expect(calls("play_game_move")).toHaveLength(1));
    await respond(2, { structuredContent: after });
    await waitFor(() => expect(calls("play_game_move")).toHaveLength(2));
    await respond(3, { isError: true, content: [{ type: "text", text: "MOVE_CONFIRMATION_UNKNOWN internal_error: no MOVE_NOT_APPLIED receipt was available." }] });

    await waitFor(() => expect(calls("get_game_state")).toHaveLength(1));
    await respond(4, { structuredContent: recovered });
    await waitFor(() => expect(screen.getByText("Recovered after ambiguous protocol result.")).toBeVisible());
    expect(calls("get_game_state")).toHaveLength(1);
    expect(calls("play_game_move")).toHaveLength(2);
    bridge.dispose();
  });
  it("disables board interactions while GPT owns the turn", () => { render(<App initialGame={{ ...chess(), turn: "black" }}/>); expect(screen.getByRole("button", { name: /white pawn on e2/i })).toBeDisabled(); });
  it("tracks the ChatGPT host maximum height for responsive board sizing", async () => {
    const target = { postMessage: vi.fn() } as unknown as Window;
    const bridge = new GameBridge(target, 100_000);
    render(<App bridge={bridge} initialGame={chess()}/>);
    window.dispatchEvent(new MessageEvent("message", { source: target, data: { jsonrpc: "2.0", id: 1, result: { hostCapabilities: { serverTools: {}, message: {} }, hostContext: { maxHeight: 640 } } } }));
    await waitFor(() => expect(document.querySelector("main.arena")).toHaveStyle("--host-max-height: 640px"));
    window.dispatchEvent(new MessageEvent("message", { source: target, data: { jsonrpc: "2.0", method: "ui/notifications/host-context-changed", params: { maxHeight: 520 } } }));
    await waitFor(() => expect(document.querySelector("main.arena")).toHaveStyle("--host-max-height: 520px"));
    bridge.dispose();
  });
  it("ignores a superseded stale human completion", async () => {
    let resolveOld!: (value: Response) => void; const old = new Promise<Response>(resolve => { resolveOld = resolve; }); const user = userEvent.setup(); vi.mocked(fetch).mockReturnValueOnce(old).mockResolvedValueOnce({ ok: true, json: async () => ({ structuredContent: go() }) } as Response);
    render(<App initialGame={chess()}/>); await user.click(screen.getByRole("button", { name: /white pawn on e2, movable source/i })); await user.click(screen.getByRole("button", { name: /empty e4, legal destination/i })); await user.selectOptions(screen.getByRole("combobox", { name: "NEW GAME" }), "go-9"); await user.click(screen.getByRole("button", { name: "Start game" })); await screen.findByRole("button", { name: /Play at A9, empty, legal move/i }); resolveOld({ ok: true, json: async () => ({ structuredContent: { ...chess(99), turn: "black" } }) } as Response); await Promise.resolve(); await Promise.resolve(); expect(screen.getByRole("group", { name: /go board/i })).toBeVisible(); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("does not update state when mount initialization rejects after unmount", async () => {
    const target = { postMessage: vi.fn() } as unknown as Window; const bridge = new GameBridge(target); const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined); const view = render(<App bridge={bridge} initialGame={chess()}/>); view.unmount(); await Promise.resolve(); await Promise.resolve(); expect(consoleError).not.toHaveBeenCalled(); consoleError.mockRestore();
  });
  it("exposes concise deterministic text state and a harmless time hook", () => {
    render(<App initialGame={go(13, "hard")}/>);
    const state = JSON.parse(window.render_game_to_text!()) as { mode: string; coordinateSystem: string; game: { kind: string; difficulty: string; board: string[]; legalMoves: string[] } };
    expect(state).toMatchObject({ mode: "active", game: { kind: "go", difficulty: "hard", legalMoves: ["A13", "pass"] } });
    expect(state.coordinateSystem).toContain("I is skipped");
    expect(state.game.board).toHaveLength(13);
    const before = window.render_game_to_text!();
    expect(() => window.advanceTime!(1_000)).not.toThrow();
    expect(window.render_game_to_text!()).toBe(before);
  });
  it("ignores a delayed notification for a different game", () => { const target = { postMessage: vi.fn() } as unknown as Window; const bridge = new GameBridge(target); render(<App bridge={bridge} initialGame={go()}/>); window.dispatchEvent(new MessageEvent("message", { source: target, data: { jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { structuredContent: chess(9) } } })); expect(screen.getByRole("group", { name: /go board/i })).toBeVisible(); bridge.dispose(); });
  it("rejects a newer notification that alters a historical move color", () => {
    const target = { postMessage: vi.fn() } as unknown as Window;
    const bridge = new GameBridge(target, 100_000);
    const start = chessAdvance(chess(), "player", "e2e4", "black", ["a7a6"], "Authoritative player move.");
    const next = chessAdvance(start, "gpt", "a7a6", "white", ["e2e4"], "Altered historical color.");
    const altered = { ...next, moveHistory: [{ ...start.moveHistory[0]!, color: "black" as const }, next.moveHistory[1]!] };
    render(<App bridge={bridge} initialGame={start}/>);

    window.dispatchEvent(new MessageEvent("message", { source: target, data: { jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { structuredContent: altered } } }));

    expect(screen.getByText("Authoritative player move.")).toBeVisible();
    expect(screen.queryByText("Altered historical color.")).not.toBeInTheDocument();
    bridge.dispose();
  });
  it("holds a reset epoch barrier against delayed pre-reset notifications", async () => {
    const target = { postMessage: vi.fn() } as unknown as Window;
    const bridge = new GameBridge(target, 100_000);
    const start = { ...chess(5), resetEpoch: 0 };
    const reset = { ...chess(0), resetEpoch: 1, message: "Reset epoch" };
    const old = { ...chess(6), resetEpoch: 0, message: "Old epoch" };
    const fresh = { ...chess(1), resetEpoch: 1, message: "New epoch" };
    const reply = async (id: number, result: unknown) => { window.dispatchEvent(new MessageEvent("message", { source: target, data: { jsonrpc: "2.0", id, result } })); await new Promise<void>(resolve => window.setTimeout(resolve, 0)); };
    render(<App bridge={bridge} initialGame={start}/>);
    fireEvent.click(screen.getByRole("button", { name: /reset/i }));
    fireEvent.click(within(screen.getByRole("alertdialog", { name: "Reset this game?" })).getByRole("button", { name: "Reset game" }));
    await reply(1, { hostCapabilities: { serverTools: {}, message: {} } });
    await waitFor(() => expect(target.postMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 2, method: "tools/call", params: { name: "reset_game", arguments: { gameId: "chess-1", confirmed: true, expectedVersion: 5, expectedResetEpoch: 0 } } }), "*"));
    await reply(2, { structuredContent: reset });
    expect(screen.getByText("Reset epoch")).toBeVisible();
    window.dispatchEvent(new MessageEvent("message", { source: target, data: { jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { structuredContent: old } } }));
    expect(screen.queryByText("Old epoch")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: /refresh/i })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
    await waitFor(() => expect(target.postMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 3, method: "tools/call" }), "*"));
    await reply(3, { structuredContent: fresh });
    expect(screen.getByText("New epoch")).toBeVisible();
    window.dispatchEvent(new MessageEvent("message", { source: target, data: { jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { structuredContent: reset } } }));
    expect(screen.getByText("New epoch")).toBeVisible();
    bridge.dispose();
  });
  it("accepts a legitimate repeated move sequence after an explicit reset epoch", async () => {
    const target = { postMessage: vi.fn() } as unknown as Window;
    const bridge = new GameBridge(target, 100_000);
    const oldPlayer = { actor: "player", color: "white", notation: "e2e4", ply: 1 } as const;
    const oldGpt = { actor: "gpt", color: "black", notation: "e7e5", ply: 2 } as const;
    const start = { ...chess(2), resetEpoch: 0, moveHistory: [oldPlayer, oldGpt], lastMove: oldGpt, message: "Old epoch" };
    const reset = { ...chess(0), resetEpoch: 1, message: "Reset epoch" };
    const fresh = { ...chess(1), resetEpoch: 1, moveHistory: [oldPlayer], lastMove: oldPlayer, message: "New epoch" };
    const late = { ...chess(2), resetEpoch: 1, moveHistory: [oldPlayer, oldGpt], lastMove: oldGpt, message: "Late repeated GPT move" };
    const reply = async (id: number, result: unknown) => {
      window.dispatchEvent(new MessageEvent("message", { source: target, data: { jsonrpc: "2.0", id, result } }));
      await new Promise<void>(resolve => window.setTimeout(resolve, 0));
    };
    render(<App bridge={bridge} initialGame={start}/>);

    fireEvent.click(screen.getByRole("button", { name: /reset/i }));
    fireEvent.click(within(screen.getByRole("alertdialog", { name: "Reset this game?" })).getByRole("button", { name: "Reset game" }));
    await reply(1, { hostCapabilities: { serverTools: {}, message: {} } });
    await waitFor(() => expect(target.postMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 2, method: "tools/call", params: { name: "reset_game", arguments: { gameId: "chess-1", confirmed: true, expectedVersion: 2, expectedResetEpoch: 0 } } }), "*"));
    await reply(2, { structuredContent: reset });
    window.dispatchEvent(new MessageEvent("message", { source: target, data: { jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { structuredContent: { ...start, stateVersion: 3, message: "Delayed old epoch" } } } }));
    expect(screen.queryByText("Delayed old epoch")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: /refresh/i })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
    await waitFor(() => expect(target.postMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 3, method: "tools/call" }), "*"));
    await reply(3, { structuredContent: fresh });
    expect(screen.getByText("New epoch")).toBeVisible();

    window.dispatchEvent(new MessageEvent("message", { source: target, data: { jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { structuredContent: late } } }));
    expect(await screen.findByText("Late repeated GPT move")).toBeVisible();
    bridge.dispose();
  });
  it("ignores an unsolicited same-game version-zero notification", () => {
    const target = { postMessage: vi.fn() } as unknown as Window;
    const bridge = new GameBridge(target, 100_000);
    const move = { actor: "player", color: "white", notation: "e2e4", ply: 1 } as const;
    const active = { ...chess(1), moveHistory: [move], lastMove: move, message: "Active board" };
    render(<App bridge={bridge} initialGame={active}/>);

    window.dispatchEvent(new MessageEvent("message", { source: target, data: { jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { structuredContent: { ...chess(0), message: "Stale reset" } } } }));

    expect(screen.getByText("Active board")).toBeVisible();
    expect(screen.queryByText("Stale reset")).not.toBeInTheDocument();
    bridge.dispose();
  });
  it("continues a late embedded result with a direct GPT move when GPT still owns the turn", async () => {
    const target = { postMessage: vi.fn() } as unknown as Window;
    const bridge = new GameBridge(target, 100_000);
    const playerMove = { actor: "player", color: "black", notation: "C4", ply: 1 } as const;
    const gptMove = { actor: "gpt", color: "white", notation: "C3", ply: 2 } as const;
    const before = { ...reversi(), turn: "white" as const, stateVersion: 1, moveHistory: [playerMove], lastMove: playerMove, legalMoves: ["C3" as ReversiCoordinate], message: "Waiting for GPT" };
    const late = { ...before, stateVersion: 2, moveHistory: [playerMove, gptMove], lastMove: gptMove, legalMoves: ["C5" as ReversiCoordinate], message: "White moves again" };
    render(<App bridge={bridge} initialGame={before}/>);

    window.dispatchEvent(new MessageEvent("message", {
      source: target,
      data: { jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { structuredContent: late } },
    }));
    window.dispatchEvent(new MessageEvent("message", {
      source: target,
      data: { jsonrpc: "2.0", id: 1, result: { hostCapabilities: { serverTools: {}, message: {} } } },
    }));

    await waitFor(() => expect(target.postMessage).toHaveBeenCalledWith(expect.objectContaining({ method: "tools/call", params: { name: "play_game_move", arguments: expect.objectContaining({ actor: "gpt", expectedVersion: 2 }) } }), "*"));
    expect(target.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ method: "ui/message" }), "*");
    expect(screen.getByText("GPT thinking…")).toBeVisible();
    bridge.dispose();
  });
  it("creates every new game with black and no boardSize, preserving the active board until Start", async () => {
    const variants: Array<[string, TicTacToeSnapshot | ConnectFourSnapshot | ReversiSnapshot | PoolSnapshot | BasketballSnapshot]> = [["tic-tac-toe", tic()], ["connect-four", four()], ["reversi", reversi()], ["pool", pool()], ["basketball", basketball()]];
    for (const [preset, snapshot] of variants) {
      cleanup(); vi.mocked(fetch).mockReset(); vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ structuredContent: snapshot }) } as Response);
      render(<App initialGame={chess()}/>); const user = userEvent.setup(); await user.selectOptions(screen.getByRole("combobox", { name: "NEW GAME" }), preset); expect(screen.getByRole("group", { name: "Chess board" })).toBeVisible(); await user.click(screen.getByRole("button", { name: "Start game" })); await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/tools/create_game", expect.objectContaining({ body: JSON.stringify({ game: preset, playerColor: "black", difficulty: "medium" }) }))); expect(JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string)).not.toHaveProperty("boardSize");
    }
  });
  it("plays an exact Mini 8-Ball pot from a selected ball and pocket", async () => {
    const opening = pool();
    const move = { actor: "player", color: "black", notation: "POT:1:TM", ply: 1 } as const;
    const after: PoolSnapshot = { ...opening, cueBall: { x: 32, y: 9 }, balls: opening.balls.filter((ball) => ball.id !== 1), legalMoves: ["POT:2:BL", "POT:3:BL", "SAFE:L", "SAFE:C", "SAFE:R", "SAFE:T", "SAFE:B"], moveHistory: [move], lastMove: move, stateVersion: 1 };
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ structuredContent: after }) } as Response);
    render(<App initialGame={opening}/>);
    const user = userEvent.setup();
    expect(screen.getByRole("group", { name: "Mini 8-Ball pool table" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: /Ball 1, solids, 2 legal pockets/ }));
    await user.click(screen.getByRole("button", { name: "Pot ball 1 in the top middle pocket" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string)).toEqual({ gameId: "pool", actor: "player", move: "POT:1:TM", expectedVersion: 0, expectedResetEpoch: 0 });
    expect(screen.getByText(/Solids left/).parentElement).toHaveTextContent("Solids left 2");
    expect(screen.getByText("POT:1:TM · Player (Solids)")).toBeVisible();
    const text = JSON.parse(window.render_game_to_text!());
    expect(text.coordinateSystem).toContain("x=0-100");
    expect(text.game).toMatchObject({ kind: "pool", stateVersion: 1, cueBall: { x: 32, y: 9 }, lastMove: { notation: "POT:1:TM" } });
  });
  it("plays Court Duel through the authoritative player shot and one GPT reply", async () => {
    const opening = basketball();
    const playerMove = { actor: "player", color: "black", notation: "drive", ply: 1 } as const;
    const afterPlayer: BasketballSnapshot = { ...opening, turn: "white", score: { black: 2, white: 0 }, energy: { black: 2, white: 4 }, streak: { black: 1, white: 0 }, attempts: { black: 1, white: 0 }, moveHistory: [playerMove], lastMove: playerMove, stateVersion: 1, message: "White to shoot in round 1. Score 2-0.", shotResults: [{ actor: "player", color: "black", ply: 1, move: "drive", made: true, points: 2, accuracy: 82 }], shotOptions: opening.shotOptions };
    const gptMove = chooseStandaloneMove(afterPlayer) as "drive" | "pull-up" | "three";
    expect(afterPlayer.legalMoves).toContain(gptMove);
    const profile = afterPlayer.shotOptions.find((option) => option.move === gptMove)!;
    const gptRecord = { actor: "gpt", color: "white", notation: gptMove, ply: 2 } as const;
    const afterGpt: BasketballSnapshot = { ...afterPlayer, turn: "black", score: { black: 2, white: profile.points }, energy: { black: 2, white: 4 - profile.energyCost }, streak: { black: 1, white: 1 }, attempts: { black: 1, white: 1 }, round: 2, moveHistory: [playerMove, gptRecord], lastMove: gptRecord, stateVersion: 2, message: `Black to shoot in round 2. Score 2-${profile.points}.`, shotResults: [...afterPlayer.shotResults, { actor: "gpt", color: "white", ply: 2, move: gptMove, made: true, points: profile.points, accuracy: profile.accuracy }], shotOptions: [{ move: "drive", points: 2, energyCost: 2, accuracy: 75 }, { move: "pull-up", points: 2, energyCost: 1, accuracy: 71 }, { move: "three", points: 3, energyCost: 0, accuracy: 53 }] };
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ structuredContent: afterPlayer }) } as Response).mockResolvedValueOnce({ ok: true, json: async () => ({ structuredContent: afterGpt }) } as Response);
    render(<App initialGame={opening}/>);
    expect(screen.getByRole("region", { name: "Court Duel basketball game" })).toBeVisible();
    await userEvent.setup().click(screen.getByRole("button", { name: /Drive, 2 points, 82 percent accuracy/ }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string)).toEqual({ gameId: "court", actor: "player", move: "drive", expectedVersion: 0, expectedResetEpoch: 0 });
    expect(JSON.parse((vi.mocked(fetch).mock.calls[1][1] as RequestInit).body as string)).toEqual({ gameId: "court", actor: "gpt", move: gptMove, expectedVersion: 1, expectedResetEpoch: 0 });
    expect(screen.getByText(new RegExp(`GPT made ${profile.points}`))).toBeVisible();
    const text = JSON.parse(window.render_game_to_text!());
    expect(text.game).toMatchObject({ kind: "basketball", stateVersion: 2, round: 2, score: afterGpt.score, energy: afterGpt.energy });
  });
  it("plays a reachable Tic-Tac-Toe opening and sends the exact deterministic GPT request", async () => {
    const after: TicTacToeSnapshot = { ...tic(), turn: "white", legalMoves: ["A2", "A3", "B1", "B2", "B3", "C1", "C2", "C3"], moveHistory: [{ actor: "player", color: "black", notation: "A1", ply: 1 }], lastMove: { actor: "player", color: "black", notation: "A1", ply: 1 }, stateVersion: 1, message: "White to move.", board: [[null, null, null], [null, null, null], ["black", null, null]] };
    const gptMove = chooseStandaloneMove(after);
    expect(gptMove).toBe("B2");
    expect(after.legalMoves).toContain(gptMove);
    const gpt: TicTacToeSnapshot = { ...after, turn: "black", legalMoves: ["A2", "A3", "B1", "B3", "C1", "C2", "C3"], moveHistory: [...after.moveHistory, { actor: "gpt", color: "white", notation: "B2", ply: 2 }], lastMove: { actor: "gpt", color: "white", notation: "B2", ply: 2 }, stateVersion: 2, message: "Black to move.", board: [[null, null, null], [null, "white", null], ["black", null, null]] };
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ structuredContent: after }) } as Response).mockResolvedValueOnce({ ok: true, json: async () => ({ structuredContent: gpt }) } as Response);
    render(<App initialGame={tic()}/>);
    await userEvent.setup().click(screen.getByRole("button", { name: "A1, empty, legal move" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string)).toEqual({ gameId: "tic", actor: "player", move: "A1", expectedVersion: 0, expectedResetEpoch: 0 });
    expect(JSON.parse((vi.mocked(fetch).mock.calls[1][1] as RequestInit).body as string)).toEqual({ gameId: "tic", actor: "gpt", move: "B2", expectedVersion: 1, expectedResetEpoch: 0 });
    expect(screen.queryByRole("button", { name: /pass/i })).not.toBeInTheDocument();
  });
  it("plays a reachable Connect Four opening and sends the exact deterministic GPT request", async () => {
    const after: ConnectFourSnapshot = { ...four(), turn: "white", moveHistory: [{ actor: "player", color: "black", notation: "A", ply: 1 }], lastMove: { actor: "player", color: "black", notation: "A", ply: 1 }, stateVersion: 1, message: "White to move.", board: [[null, null, null, null, null, null, null], [null, null, null, null, null, null, null], [null, null, null, null, null, null, null], [null, null, null, null, null, null, null], [null, null, null, null, null, null, null], ["black", null, null, null, null, null, null]] };
    const gptMove = chooseStandaloneMove(after);
    expect(gptMove).toBe("D");
    expect(after.legalMoves).toContain(gptMove);
    const gpt: ConnectFourSnapshot = { ...after, turn: "black", moveHistory: [...after.moveHistory, { actor: "gpt", color: "white", notation: "D", ply: 2 }], lastMove: { actor: "gpt", color: "white", notation: "D", ply: 2 }, stateVersion: 2, message: "Black to move.", board: [[null, null, null, null, null, null, null], [null, null, null, null, null, null, null], [null, null, null, null, null, null, null], [null, null, null, null, null, null, null], [null, null, null, null, null, null, null], ["black", null, null, "white", null, null, null]] };
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ structuredContent: after }) } as Response).mockResolvedValueOnce({ ok: true, json: async () => ({ structuredContent: gpt }) } as Response);
    render(<App initialGame={four()}/>);
    await userEvent.setup().click(screen.getByRole("button", { name: "Drop in column A, legal move" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string)).toEqual({ gameId: "four", actor: "player", move: "A", expectedVersion: 0, expectedResetEpoch: 0 });
    expect(JSON.parse((vi.mocked(fetch).mock.calls[1][1] as RequestInit).body as string)).toEqual({ gameId: "four", actor: "gpt", move: "D", expectedVersion: 1, expectedResetEpoch: 0 });
    expect(screen.queryByRole("button", { name: /pass/i })).not.toBeInTheDocument();
  });
  it("plays a reachable Reversi opening and sends the exact deterministic GPT request", async () => {
    const after: ReversiSnapshot = { ...reversi(), turn: "white", legalMoves: ["C3", "C5", "E3"], moveHistory: [{ actor: "player", color: "black", notation: "C4", ply: 1 }], lastMove: { actor: "player", color: "black", notation: "C4", ply: 1 }, stateVersion: 1, message: "White to move.", board: [[null, null, null, null, null, null, null, null], [null, null, null, null, null, null, null, null], [null, null, null, null, null, null, null, null], [null, null, null, "black", "white", null, null, null], [null, null, "black", "black", "black", null, null, null], [null, null, null, null, null, null, null, null], [null, null, null, null, null, null, null, null], [null, null, null, null, null, null, null, null]], score: { black: 4, white: 1 } };
    const gptMove = chooseStandaloneMove(after);
    expect(gptMove).toBe("E3");
    expect(after.legalMoves).toContain(gptMove);
    const gpt = reversiFixturePlay(after, gptMove as ReversiCoordinate);
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ structuredContent: after }) } as Response).mockResolvedValueOnce({ ok: true, json: async () => ({ structuredContent: gpt }) } as Response);
    render(<App initialGame={reversi()}/>);
    await userEvent.setup().click(screen.getByRole("button", { name: "C4, empty, legal move" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string)).toEqual({ gameId: "rev", actor: "player", move: "C4", expectedVersion: 0, expectedResetEpoch: 0 });
    expect(JSON.parse((vi.mocked(fetch).mock.calls[1][1] as RequestInit).body as string)).toEqual({ gameId: "rev", actor: "gpt", move: "E3", expectedVersion: 1, expectedResetEpoch: 0 });
    expect(screen.queryByRole("button", { name: /pass/i })).not.toBeInTheDocument();
  });
  it("renders each Reversi history entry from its authoritative actor and color", () => {
    const skipped: ReversiSnapshot = { ...reversi(), moveHistory: [{ actor: "gpt", color: "white", notation: "C4", ply: 8 }, { actor: "gpt", color: "white", notation: "A3", ply: 9 }], lastMove: { actor: "gpt", color: "white", notation: "A3", ply: 9 }, stateVersion: 9 };
    render(<App initialGame={skipped}/>);
    expect(screen.getByText("8.")).toBeVisible();
    expect(screen.getByText("C4 · GPT (White)")).toBeVisible();
    expect(screen.getByText("9.")).toBeVisible();
    expect(screen.getByText("A3 · GPT (White)")).toBeVisible();
    expect(screen.queryByText("4…")).not.toBeInTheDocument();
  });
  it("keeps standalone Reversi busy through a forced skipped-player GPT turn", async () => {
    const states = ["C4", "C3", "C2", "B2", "E6", "C1"].reduce<ReversiSnapshot>((game, move) => reversiFixturePlay(game, move as ReversiCoordinate), { ...reversi(), difficulty: "easy" });
    const afterPlayer = reversiFixturePlay(states, "A1");
    expect(afterPlayer.turn).toBe("white"); expect(afterPlayer.legalMoves).toContain("A3");
    const afterFirstGpt = reversiFixturePlay(afterPlayer, "A3");
    expect(afterFirstGpt).toMatchObject({ turn: "white", legalMoves: ["C5", "F6"], stateVersion: 8 });
    const secondMove = chooseStandaloneMove(afterFirstGpt)!; const afterSecondGpt = reversiFixturePlay(afterFirstGpt, secondMove as ReversiCoordinate);
    let resolveSecond!: (response: Response) => void;
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ structuredContent: afterPlayer }) } as Response).mockResolvedValueOnce({ ok: true, json: async () => ({ structuredContent: afterFirstGpt }) } as Response).mockReturnValueOnce(new Promise<Response>(resolve => { resolveSecond = resolve; }));
    render(<App initialGame={states}/>); await userEvent.setup().click(screen.getByRole("button", { name: "A1, empty, legal move" })); await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(JSON.parse((vi.mocked(fetch).mock.calls[1][1] as RequestInit).body as string)).toEqual({ gameId: "rev", actor: "gpt", move: "A3", expectedVersion: 7, expectedResetEpoch: 0 });
    expect(JSON.parse((vi.mocked(fetch).mock.calls[2][1] as RequestInit).body as string)).toEqual({ gameId: "rev", actor: "gpt", move: secondMove, expectedVersion: 8, expectedResetEpoch: 0 });
    expect(screen.getByRole("button", { name: /reset/i })).toBeEnabled();
    resolveSecond({ ok: true, json: async () => ({ structuredContent: afterSecondGpt }) } as Response);
    await waitFor(() => expect(screen.getByRole("button", { name: /reset/i })).toBeEnabled());
  });
  it("makes direct GPT moves again when embedded GPT retains the turn", async () => {
    const postMessage = vi.fn(); const target = { postMessage } as unknown as Window; const bridge = new GameBridge(target, 100_000); const start = chess(0, "hard"); const after = chessAdvance(start, "player", "e2e4", "black", ["a7a6"], "Black to move."); const skipped = chessAdvance(after, "gpt", "a7a6", "black", ["b7b6"], "Black moves again."); const done = chessAdvance(skipped, "gpt", "b7b6", "white", ["e2e4"], "White to move.");
    render(<App bridge={bridge} initialGame={start}/>); fireEvent.click(screen.getByRole("button", { name: /white pawn on e2, movable source/i })); fireEvent.click(screen.getByRole("button", { name: /empty e4/i }));
    const respond = async (id: number, result: unknown) => { window.dispatchEvent(new MessageEvent("message", { source: target, data: { jsonrpc: "2.0", id, result } })); await Promise.resolve(); await Promise.resolve(); };
    await respond(1, { hostCapabilities: { serverTools: {}, message: {} } }); await waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 2, method: "tools/call", params: { name: "play_game_move", arguments: expect.objectContaining({ actor: "player" }) } }), "*")); await respond(2, { structuredContent: after }); await waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 3, method: "tools/call", params: { name: "play_game_move", arguments: expect.objectContaining({ actor: "gpt" }) } }), "*")); await respond(3, { structuredContent: skipped });
    const directGptCalls = () => postMessage.mock.calls.filter(([request]) => { const value = request as { method?: string; params?: { arguments?: { actor?: string } } }; return value.method === "tools/call" && value.params?.arguments?.actor === "gpt"; }); await waitFor(() => expect(directGptCalls()).toHaveLength(2)); await respond(4, { structuredContent: done });
    await waitFor(() => expect(screen.getByRole("button", { name: /white pawn on e2, movable source/i })).toBeEnabled()); expect(directGptCalls()).toHaveLength(2); expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ method: "ui/message" }), "*"); bridge.dispose();
  });
  it("opens and cancels the inline reset confirmation without calling the service", async () => {
    const user = userEvent.setup();
    render(<App initialGame={{ ...chess(4), resetEpoch: 2 }}/>);
    const trigger = screen.getByRole("button", { name: /reset/i });

    await user.click(trigger);

    const dialog = screen.getByRole("alertdialog", { name: "Reset this game?" });
    expect(dialog).toHaveTextContent("All current progress will be cleared. Your game settings will stay the same.");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(within(dialog).getByRole("button", { name: "Keep playing" })).toHaveFocus();
    expect(screen.getByRole("button", { name: /white pawn on e2, movable source/i })).toBeDisabled();
    expect(fetch).not.toHaveBeenCalled();
    expect(JSON.parse(window.render_game_to_text!()).resetGame).toMatchObject({ available: true, enabled: true, confirmation: { gameId: "chess-1", expectedVersion: 4, expectedResetEpoch: 2 } });

    await user.click(within(dialog).getByRole("button", { name: "Keep playing" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reset/i })).toHaveFocus();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("resets a finished game only after a matching authoritative receipt", async () => {
    const user = userEvent.setup();
    const finished: ChessSnapshot = { ...chess(4), resetEpoch: 2, status: "finished", winner: "black", finishReason: "ended", legalMoves: [], message: "Game ended." };
    const reset: ChessSnapshot = { ...chess(0), resetEpoch: 3, message: "White to move." };
    let resolveReset!: (response: Response) => void;
    vi.mocked(fetch).mockReturnValueOnce(new Promise<Response>(resolve => { resolveReset = resolve; }));
    render(<App initialGame={finished}/>);

    await user.click(screen.getByRole("button", { name: /reset/i }));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Reset game" }));

    expect(screen.getByRole("status")).toHaveTextContent("Game ended.");
    expect(fetch).toHaveBeenCalledWith("/api/tools/reset_game", expect.objectContaining({ body: '{"gameId":"chess-1","confirmed":true,"expectedVersion":4,"expectedResetEpoch":2}' }));
    resolveReset({ ok: true, json: async () => ({ structuredContent: reset }) } as Response);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Choose a piece to begin."));
    expect(JSON.parse(window.render_game_to_text!())).toMatchObject({ mode: "active", resetGame: { available: true, confirmation: null }, game: { resetEpoch: 3, stateVersion: 0 } });
  });
  it("does not reconcile a reset that is definitively rejected", async () => {
    const user = userEvent.setup();
    const start = { ...chess(3), resetEpoch: 1 };
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, json: async () => ({ error: { code: "stale_version", message: "The requested reset was not applied." } }) } as Response);
    render(<App initialGame={start}/>);

    await user.click(screen.getByRole("button", { name: /reset/i }));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Reset game" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("stale_version");
    expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual(["/api/tools/reset_game"]);
    expect(JSON.parse(window.render_game_to_text!())).toMatchObject({ mode: "active", game: { resetEpoch: 1, stateVersion: 3 } });
  });
  it("reconciles an uncertain reset with one state read and never repeats the mutation", async () => {
    const user = userEvent.setup();
    const start = { ...chess(6), resetEpoch: 3 };
    const reset = { ...chess(0), resetEpoch: 4, message: "White to move." };
    vi.mocked(fetch)
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ structuredContent: reset }) } as Response);
    render(<App initialGame={start}/>);

    await user.click(screen.getByRole("button", { name: /reset/i }));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Reset game" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Choose a piece to begin."));
    expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual(["/api/tools/reset_game", "/api/tools/get_game_state"]);
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/tools/reset_game")).toHaveLength(1);
  });
  it("rejects an ambiguous reset read that changes imported Go configuration", async () => {
    const user = userEvent.setup();
    const start = { ...importedGo("white", "white", 2, "confirmed"), stateVersion: 5 };
    const mismatched = importedGo("white", "white", 3, "pending");
    mismatched.initialPosition = { ...mismatched.initialPosition!, blackStones: ["C3"] };
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ isError: true, content: [{ type: "text", text: "RESET_CONFIRMATION_UNKNOWN: response lost" }] }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ structuredContent: mismatched }) } as Response);
    render(<App initialGame={start}/>);

    await user.click(screen.getByRole("button", { name: /reset/i }));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Reset game" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("reset could not be confirmed");
    expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual(["/api/tools/reset_game", "/api/tools/get_game_state"]);
    expect(JSON.parse(window.render_game_to_text!())).toMatchObject({ game: { gameId: "imported-go", resetEpoch: 2, stateVersion: 5 } });
    expect(screen.getByText("✓ Verified")).toBeVisible();
  });
  it("lets reset safely interrupt an in-flight GPT turn", async () => {
    const target = { postMessage: vi.fn() } as unknown as Window;
    const bridge = new GameBridge(target, 100_000);
    const start = { ...chess(0, "hard"), resetEpoch: 0 };
    const after = chessAdvance(start, "player", "e2e4", "black", ["a7a6"], "Black to move.");
    const reset = { ...chess(0, "hard"), resetEpoch: 1, message: "White to move." };
    const reply = async (id: number, result: unknown) => { window.dispatchEvent(new MessageEvent("message", { source: target, data: { jsonrpc: "2.0", id, result } })); await Promise.resolve(); await Promise.resolve(); };
    render(<App bridge={bridge} initialGame={start}/>);
    fireEvent.click(screen.getByRole("button", { name: /white pawn on e2, movable source/i }));
    fireEvent.click(screen.getByRole("button", { name: /empty e4/i }));
    await reply(1, { hostCapabilities: { serverTools: {}, message: {} } });
    await waitFor(() => expect(target.postMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 2, method: "tools/call", params: { name: "play_game_move", arguments: expect.objectContaining({ actor: "player" }) } }), "*"));
    await reply(2, { structuredContent: after });
    await waitFor(() => expect(target.postMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 3, method: "tools/call", params: { name: "play_game_move", arguments: expect.objectContaining({ actor: "gpt" }) } }), "*"));
    expect(screen.getByText("GPT thinking…")).toBeVisible();

    const resetTrigger = screen.getByRole("button", { name: /reset/i });
    expect(resetTrigger).toBeEnabled();
    fireEvent.click(resetTrigger);
    fireEvent.click(within(screen.getByRole("alertdialog", { name: "Reset this game?" })).getByRole("button", { name: "Reset game" }));
    await Promise.resolve();
    expect(target.postMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 4, method: "tools/call", params: { name: "reset_game", arguments: { gameId: "chess-1", confirmed: true, expectedVersion: 1, expectedResetEpoch: 0 } } }), "*");
    await reply(4, { structuredContent: reset });

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Choose a piece to begin."));
    expect(screen.queryByText("GPT move not confirmed")).not.toBeInTheDocument();
    bridge.dispose();
  });
  it("keeps End game interruptible while GPT is thinking and ignores its late direct receipt after confirmation", async () => {
    const postMessage = vi.fn();
    const target = { postMessage } as unknown as Window;
    const bridge = new GameBridge(target, 100_000);
    const start = chess(0, "hard");
    const after = chessAdvance(start, "player", "e2e4", "black", ["a7a6"], "Black to move.");
    const gptMove = chooseStandaloneMove(after)!;
    const lateGpt = chessAdvance(after, "gpt", gptMove, "white", ["e2e4"], "Late GPT receipt.");
    const ended: ChessSnapshot = { ...after, status: "finished", finishReason: "ended", legalMoves: [], stateVersion: 2, message: "Game ended." };
    const alteredEnded: ChessSnapshot = { ...ended, moveHistory: [{ ...after.moveHistory[0]!, color: "black" }], lastMove: { ...after.lastMove!, color: "black" }, board: ended.board.map(cell => cell.square === "a8" ? { ...cell, color: "black", piece: "q" } : cell) };
    const respond = async (id: number, result: unknown) => { window.dispatchEvent(new MessageEvent("message", { source: target, data: { jsonrpc: "2.0", id, result } })); await Promise.resolve(); await Promise.resolve(); };

    render(<App bridge={bridge} initialGame={start}/>);
    fireEvent.click(screen.getByRole("button", { name: /white pawn on e2, movable source/i }));
    fireEvent.click(screen.getByRole("button", { name: /empty e4, legal destination/i }));
    await respond(1, { hostCapabilities: { serverTools: {}, message: {} } });
    await waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 2, method: "tools/call", params: { name: "play_game_move", arguments: expect.objectContaining({ actor: "player" }) } }), "*"));
    await respond(2, { structuredContent: after });
    await waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 3, method: "tools/call", params: { name: "play_game_move", arguments: expect.objectContaining({ actor: "gpt" }) } }), "*"));

    window.dispatchEvent(new MessageEvent("message", { source: target, data: { jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { structuredContent: alteredEnded } } }));
    await Promise.resolve();
    expect(screen.getByText("Black to move.")).toBeVisible();
    expect(screen.queryByText("Game ended.")).not.toBeInTheDocument();
    expect(screen.getByText("GPT thinking…")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "End game" }));
    const dialog = screen.getByRole("alertdialog", { name: "End this game?" });
    expect(within(dialog).getByRole("button", { name: "Keep playing" })).toBeEnabled();
    expect(within(dialog).getByRole("button", { name: "End game" })).toBeEnabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep playing" }));
    expect(screen.getByRole("button", { name: "End game" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "End game" }));
    fireEvent.click(within(screen.getByRole("alertdialog", { name: "End this game?" })).getByRole("button", { name: "End game" }));
    await waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 4, method: "tools/call", params: { name: "end_game", arguments: { gameId: after.gameId, confirmed: true, expectedVersion: after.stateVersion, expectedResetEpoch: 0 } } }), "*"));
    await respond(4, { structuredContent: ended });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Game ended."));

    await respond(3, { structuredContent: lateGpt });
    await Promise.resolve();
    expect(screen.getByRole("status")).toHaveTextContent("Game ended.");
    expect(screen.queryByText("Late GPT receipt.")).not.toBeInTheDocument();
    bridge.dispose();
  });
  it("opens and cancels the inline end-game confirmation without calling the service", async () => {
    const user = userEvent.setup();
    render(<App initialGame={{ ...chess(4), resetEpoch: 2 }}/>);
    expect(screen.getByRole("group", { name: "Chess board" }).closest(".table")).toHaveClass("table-chess");
    expect(screen.getByRole("button", { name: "End game" }).closest(".controls")).toHaveClass("controls-chess", "controls-active");

    await user.click(screen.getByRole("button", { name: "End game" }));

    const dialog = screen.getByRole("alertdialog", { name: "End this game?" });
    expect(dialog).toHaveTextContent("The board will be frozen. Reset or start a New Game afterward.");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    const keepPlaying = within(dialog).getByRole("button", { name: "Keep playing" });
    const confirmEnd = within(dialog).getByRole("button", { name: "End game" });
    expect(keepPlaying).toHaveFocus();
    expect(screen.getByRole("button", { name: /white pawn on e2, movable source/i })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "NEW GAME" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "DIFFICULTY" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Start game" })).toBeDisabled();
    confirmEnd.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(keepPlaying).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(confirmEnd).toHaveFocus();
    expect(fetch).not.toHaveBeenCalled();
    expect(JSON.parse(window.render_game_to_text!()).endGame).toMatchObject({ available: true, enabled: true, confirmation: { gameId: "chess-1", expectedVersion: 4, expectedResetEpoch: 2 } });

    await user.click(within(dialog).getByRole("button", { name: "Keep playing" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "End game" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "End game" })).toHaveFocus();
    expect(screen.getByRole("button", { name: /white pawn on e2, movable source/i })).toBeEnabled();
    expect(screen.getByRole("combobox", { name: "NEW GAME" })).toBeEnabled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("confirms end_game with the captured version and renders only the authoritative finish", async () => {
    const user = userEvent.setup();
    const start = { ...chess(4), resetEpoch: 2 };
    const ended: ChessSnapshot = { ...start, status: "finished", finishReason: "ended", legalMoves: [], stateVersion: 5, message: "Game ended." };
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ structuredContent: ended }) } as Response);
    render(<App initialGame={start}/>);

    await user.click(screen.getByRole("button", { name: "End game" }));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "End game" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Game ended."));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("/api/tools/end_game", expect.objectContaining({ body: '{"gameId":"chess-1","confirmed":true,"expectedVersion":4,"expectedResetEpoch":2}' }));
    expect(screen.queryByRole("button", { name: "End game" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reset/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /refresh/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /reset/i }).closest(".controls")).toHaveClass("controls-chess", "controls-finished");
    expect(JSON.parse(window.render_game_to_text!())).toMatchObject({ mode: "finished", endGame: { available: false, confirmation: null }, game: { finishReason: "ended", message: "Game ended.", stateVersion: 5 } });
  });
  it("keeps the active board when a stale end request is rejected", async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, json: async () => ({ error: { code: "stale_version", message: "The requested game operation could not be completed." } }) } as Response);
    render(<App initialGame={chess(3)}/>);

    await user.click(screen.getByRole("button", { name: "End game" }));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "End game" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("stale_version");
    expect(screen.getByRole("group", { name: "Chess board" })).toBeVisible();
    expect(screen.getByRole("button", { name: "End game" })).toBeEnabled();
    expect(JSON.parse(window.render_game_to_text!()).mode).toBe("active");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("reconciles one ambiguous end result with exactly one authoritative state read", async () => {
    const user = userEvent.setup();
    const start = { ...chess(6), resetEpoch: 3 };
    const ended: ChessSnapshot = { ...start, status: "finished", finishReason: "ended", legalMoves: [], stateVersion: 7, message: "Game ended." };
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ isError: true, content: [{ type: "text", text: "END_CONFIRMATION_UNKNOWN: response lost" }] }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ structuredContent: ended }) } as Response);
    render(<App initialGame={start}/>);

    await user.click(screen.getByRole("button", { name: "End game" }));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "End game" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Game ended."));
    expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual(["/api/tools/end_game", "/api/tools/get_game_state"]);
    expect(JSON.parse((vi.mocked(fetch).mock.calls[1][1] as RequestInit).body as string)).toEqual({ gameId: "chess-1" });
  });
  it("reconciles a generic transport failure after end_game without repeating the mutation", async () => {
    const user = userEvent.setup();
    const start = { ...chess(8), resetEpoch: 4 };
    const ended: ChessSnapshot = { ...start, status: "finished", finishReason: "ended", legalMoves: [], stateVersion: 9, message: "Game ended." };
    vi.mocked(fetch)
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ structuredContent: ended }) } as Response);
    render(<App initialGame={start}/>);

    await user.click(screen.getByRole("button", { name: "End game" }));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "End game" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Game ended."));
    expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual(["/api/tools/end_game", "/api/tools/get_game_state"]);
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/tools/end_game")).toHaveLength(1);
  });
  it("ignores an end notification while GPT recovery is pending, then accepts it from the state read", async () => {
    vi.useFakeTimers();
    const postMessage = vi.fn();
    const target = { postMessage } as unknown as Window;
    const bridge = new GameBridge(target, 100_000);
    const start = chess(0, "hard");
    const after = chessAdvance(start, "player", "e2e4", "black", ["a7a6"], "Black to move.");
    const ended: ChessSnapshot = { ...after, status: "finished", finishReason: "ended", legalMoves: [], stateVersion: 2, message: "Game ended." };
    const reply = async (id: number, result: unknown) => { window.dispatchEvent(new MessageEvent("message", { source: target, data: { jsonrpc: "2.0", id, result } })); await vi.advanceTimersByTimeAsync(0); };
    render(<App bridge={bridge} initialGame={start}/>);
    fireEvent.click(screen.getByRole("button", { name: /white pawn on e2, movable source/i }));
    fireEvent.click(screen.getByRole("button", { name: /empty e4/i }));
    await reply(1, { hostCapabilities: { serverTools: {}, message: {} } });
    await reply(2, { structuredContent: after });
    await reply(3, {});

    window.dispatchEvent(new MessageEvent("message", { source: target, data: { jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { structuredContent: ended } } }));
    await vi.advanceTimersByTimeAsync(0);

    expect(screen.queryByText("Game ended.")).not.toBeInTheDocument();
    expect(screen.getByText("GPT thinking…")).toBeVisible();
    expect(postMessage.mock.calls.filter(([request]) => (request as { params?: { name?: string } }).params?.name === "get_game_state")).toHaveLength(1);
    await reply(4, { structuredContent: ended });

    expect(screen.getByRole("status")).toHaveTextContent("Game ended.");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("GPT move not confirmed")).not.toBeInTheDocument();
    bridge.dispose();
    await vi.advanceTimersByTimeAsync(0);
  });
  it("renders Reversi score, winning highlights, and deterministic text rows for every new board", () => {
    const finished: TicTacToeSnapshot = { ...tic(), turn: "black", status: "finished", winner: "black", legalMoves: [], moveHistory: [{ actor: "player", color: "black", notation: "A3", ply: 1 }, { actor: "gpt", color: "white", notation: "A2", ply: 2 }, { actor: "player", color: "black", notation: "B3", ply: 3 }, { actor: "gpt", color: "white", notation: "B2", ply: 4 }, { actor: "player", color: "black", notation: "C3", ply: 5 }], lastMove: { actor: "player", color: "black", notation: "C3", ply: 5 }, stateVersion: 5, message: "Black wins.", board: [["black", "black", "black"], ["white", "white", null], [null, null, null]], winningLine: ["A3", "B3", "C3"] };
    expect(isSnapshot(finished)).toBe(true); render(<App initialGame={finished}/>); expect(screen.getByRole("button", { name: /A3, X/i })).toHaveClass("winning"); expect(screen.getByRole("status")).toHaveTextContent("Black wins."); const ticText = JSON.parse(window.render_game_to_text!()); expect(ticText.coordinateSystem).toBe("Tic-Tac-Toe columns A-C run left-to-right and ranks 3-1 run top-to-bottom."); expect(ticText.game).toMatchObject({ status: "finished", winner: "black", stateVersion: 5, message: "Black wins.", lastMove: { actor: "player", color: "black", notation: "C3", ply: 5 }, legalMoves: [], board: ["BBB", "WW.", "..."], winningLine: ["A3", "B3", "C3"] }); cleanup(); const opening = reversi(); render(<App initialGame={opening}/>); expect(screen.getByText("Disks — Black: 2, White: 2")).toBeVisible(); const revText = JSON.parse(window.render_game_to_text!()); expect(revText.coordinateSystem).toBe("Reversi columns A-H run left-to-right and ranks 8-1 run top-to-bottom."); expect(revText.game.board).toEqual(["........", "........", "........", "...BW...", "...WB...", "........", "........", "........"]); expect(revText.game.score).toEqual({ black: 2, white: 2 }); cleanup(); const winningFour: ConnectFourSnapshot = { ...four(), turn: "black", status: "finished", winner: "black", legalMoves: [], moveHistory: [{ actor: "player", color: "black", notation: "A", ply: 1 }, { actor: "gpt", color: "white", notation: "B", ply: 2 }, { actor: "player", color: "black", notation: "A", ply: 3 }, { actor: "gpt", color: "white", notation: "B", ply: 4 }, { actor: "player", color: "black", notation: "A", ply: 5 }, { actor: "gpt", color: "white", notation: "B", ply: 6 }, { actor: "player", color: "black", notation: "A", ply: 7 }], lastMove: { actor: "player", color: "black", notation: "A", ply: 7 }, stateVersion: 7, message: "Black wins.", board: [[null, null, null, null, null, null, null], [null, null, null, null, null, null, null], ["black", null, null, null, null, null, null], ["black", "white", null, null, null, null, null], ["black", "white", null, null, null, null, null], ["black", "white", null, null, null, null, null]], winningLine: ["A4", "A3", "A2", "A1"] }; expect(isSnapshot(winningFour)).toBe(true); render(<App initialGame={winningFour}/>); expect(screen.getAllByRole("button", { name: /Drop in column/ })).toHaveLength(7); const rows = screen.getAllByRole("row"); expect(rows).toHaveLength(6); expect(rows.every(row => within(row).getAllByRole("gridcell").length === 7)).toBe(true); const cells = screen.getAllByRole("gridcell"); expect(cells).toHaveLength(42); expect(cells.every(cell => cell.classList.contains("connect-cell"))).toBe(true); expect(screen.getByRole("gridcell", { name: "black disk at A1, winning disk" })).toHaveClass("connect-cell", "winning"); expect(screen.getByRole("gridcell", { name: "empty at G6" })).toBeVisible(); expect(screen.getByRole("status")).toHaveTextContent("Black wins."); const fourText = JSON.parse(window.render_game_to_text!()); expect(fourText.coordinateSystem).toBe("Connect Four columns A-G run left-to-right and ranks 6-1 run top-to-bottom."); expect(fourText.game).toMatchObject({ status: "finished", winner: "black", stateVersion: 7, message: "Black wins.", lastMove: { actor: "player", color: "black", notation: "A", ply: 7 }, legalMoves: [], board: [".......", ".......", "B......", "BW.....", "BW.....", "BW....."], winningLine: ["A4", "A3", "A2", "A1"] });
  });
});
