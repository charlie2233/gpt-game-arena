import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { GameBridge } from "./bridge";
import type { ChessSnapshot, GoSnapshot } from "./types";
const chess = (version = 0): ChessSnapshot => ({ gameId: "chess-1", kind: "chess", playerColor: "white", turn: "white", status: "active", legalMoves: ["e2e4"], moveHistory: [], stateVersion: version, message: "White to move.", board: Array.from({ length: 8 }, (_, r) => Array.from({ length: 8 }, (_, c) => ({ square: `${"abcdefgh"[c]}${8-r}`, ...(r === 6 && c === 4 ? { color: "white" as const, piece: "p" as const } : {}) }))).flat() });
const go = (): GoSnapshot => ({ gameId: "go-1", kind: "go", playerColor: "black", turn: "black", status: "active", legalMoves: ["A9", "pass"], moveHistory: [], stateVersion: 0, message: "Black to move.", boardSize: 9, board: Array.from({ length: 9 }, () => Array<"white" | "black" | null>(9).fill(null)), captures: { black: 0, white: 0 }, consecutivePasses: 0 });
describe("App", () => {
  afterEach(() => cleanup());
  beforeEach(() => { vi.stubGlobal("fetch", vi.fn()); });
  it("selects a legal chess destination then plays a deterministic standalone GPT reply", async () => {
    const reply = { ...chess(1), turn: "black", legalMoves: ["a7a5", "a7a6"] }; const gpt = { ...chess(2), turn: "white", legalMoves: ["d2d4"] };
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ structuredContent: chess() }) } as Response).mockResolvedValueOnce({ ok: true, json: async () => ({ structuredContent: reply }) } as Response).mockResolvedValueOnce({ ok: true, json: async () => ({ structuredContent: gpt }) } as Response);
    render(<App />); await screen.findByRole("button", { name: /e2, white p.*movable/i }); const user = userEvent.setup(); await user.click(screen.getByRole("button", { name: /e2, white p.*movable/i })); await user.click(screen.getByRole("button", { name: /e4, empty.*legal destination/i }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3)); expect(fetch).toHaveBeenLastCalledWith("/api/tools/play_game_move", expect.objectContaining({ body: expect.stringContaining("a7a6") }));
  });
  it("renders Go legal coordinates and Pass", async () => { vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ structuredContent: go() }) } as Response); render(<App />); const user = userEvent.setup(); await user.click(await screen.findByRole("button", { name: /new go/i })); expect(await screen.findByRole("button", { name: /A9, empty, legal move/i })).toBeEnabled(); expect(screen.getByRole("button", { name: /pass/i })).toBeEnabled(); });
  it("shows safe accessible errors", async () => { vi.mocked(fetch).mockResolvedValue({ ok: false, json: async () => ({ error: { message: "Nope" } }) } as Response); render(<App />); expect(await screen.findByRole("alert")).toHaveTextContent("Nope"); });
  it("sends Go Pass with the authoritative version and accepts reset stateVersion zero", async () => {
    const user = userEvent.setup(); const start = { ...go(), stateVersion: 5 }; const afterPass = { ...start, stateVersion: 6, turn: "white", legalMoves: ["B9"] }; const reset = { ...start, stateVersion: 0 };
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ structuredContent: afterPass }) } as Response).mockResolvedValueOnce({ ok: true, json: async () => ({ structuredContent: { ...afterPass, stateVersion: 7, turn: "black", legalMoves: ["A9"] } }) } as Response).mockResolvedValueOnce({ ok: true, json: async () => ({ structuredContent: reset }) } as Response);
    render(<App initialGame={start}/>); await user.click(screen.getByRole("button", { name: /pass/i })); await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/tools/play_game_move", expect.objectContaining({ body: expect.stringContaining('"move":"pass"') }))); await user.click(screen.getByRole("button", { name: /reset/i })); await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Choose a piece")); expect(fetch).toHaveBeenLastCalledWith("/api/tools/reset_game", expect.objectContaining({ body: '{"gameId":"go-1"}' }));
  });
  it("uses ui/message then polls an iframe host and disables player squares while GPT owns the turn", async () => {
    vi.useFakeTimers(); const target = { postMessage: vi.fn() } as unknown as Window; const bridge = new GameBridge(target, 100_000); const start = chess(); const after = { ...chess(1), turn: "black", legalMoves: ["a7a6"] }; const newer = { ...chess(2), turn: "white", legalMoves: ["e2e4"] };
    render(<App bridge={bridge} initialGame={start}/>); fireEvent.click(screen.getByRole("button", { name: /e2, white p.*movable/i })); fireEvent.click(screen.getByRole("button", { name: /e4, empty.*legal destination/i }));
    const respond = async (id: number, result: unknown) => { window.dispatchEvent(new MessageEvent("message", { source: target, data: { jsonrpc: "2.0", id, result } })); await Promise.resolve(); await Promise.resolve(); };
    await respond(1, { hostCapabilities: { serverTools: {}, message: {} } }); await vi.advanceTimersByTimeAsync(0); await respond(2, { structuredContent: after }); await vi.advanceTimersByTimeAsync(0); await respond(3, {});
    expect(target.postMessage).toHaveBeenCalledWith(expect.objectContaining({ method: "ui/message", params: expect.objectContaining({ content: [expect.objectContaining({ text: expect.stringContaining("get_game_state") })] }) }), "*"); await vi.advanceTimersByTimeAsync(1_000); await respond(4, { structuredContent: newer }); await vi.advanceTimersByTimeAsync(0); expect(screen.getByRole("button", { name: /e2, white p.*movable/i })).toBeEnabled(); bridge.dispose(); vi.useRealTimers();
  });
  it("disables board interactions while GPT owns the turn", () => { render(<App initialGame={{ ...chess(), turn: "black" }}/>); expect(screen.getByRole("button", { name: /e2, white p/i })).toBeDisabled(); });
});
