import { useCallback, useEffect, useRef, useState } from "react";
import { GameBridge } from "./bridge";
import { GameClient, isSnapshot } from "./game-client";
import { ChessBoard } from "./components/ChessBoard";
import { GoBoard } from "./components/GoBoard";
import { GameChrome } from "./components/GameChrome";
import type { GameSnapshot } from "./types";

function initialHostState(): GameSnapshot | undefined {
  const state = (window as Window & { openai?: { toolOutput?: unknown; initialState?: unknown } }).openai;
  const candidate = state?.toolOutput ?? state?.initialState;
  if (isSnapshot(candidate)) return candidate;
  if (candidate && typeof candidate === "object" && isSnapshot((candidate as { structuredContent?: unknown }).structuredContent)) return (candidate as { structuredContent: GameSnapshot }).structuredContent;
}
export function App({ bridge: suppliedBridge, initialGame }: { bridge?: GameBridge; initialGame?: GameSnapshot } = {}) {
  const bridge = useRef(suppliedBridge ?? new GameBridge()).current;
  const client = useRef(new GameClient(bridge)).current;
  const [game, setGame] = useState<GameSnapshot | undefined>(() => initialGame ?? initialHostState());
  const [selected, setSelected] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const epoch = useRef(0); const pollTimer = useRef<number>(); const pollExpiry = useRef<number>(); const pollDone = useRef<(() => void)>(); const gameRef = useRef<GameSnapshot | undefined>(game); const busyRef = useRef(busy); const resetBarrier = useRef<number>(); gameRef.current = game; busyRef.current = busy;
  const stop = useCallback(() => { epoch.current += 1; if (pollTimer.current) window.clearTimeout(pollTimer.current); if (pollExpiry.current) window.clearTimeout(pollExpiry.current); pollTimer.current = undefined; pollExpiry.current = undefined; pollDone.current?.(); pollDone.current = undefined; }, []);
  const commitBusy = useCallback((next: boolean) => { busyRef.current = next; setBusy(next); }, []);
  const apply = useCallback((next: GameSnapshot, version: number) => { if (version === epoch.current) { if (next.stateVersion > 0) resetBarrier.current = undefined; gameRef.current = next; setGame(next); } }, []);
  const action = useCallback(async (run: () => Promise<GameSnapshot>, after?: (next: GameSnapshot, version: number) => Promise<void>) => {
    stop(); const version = epoch.current; commitBusy(true); setError(undefined); setSelected(undefined);
    try { const next = await run(); if (version !== epoch.current) return; apply(next, version); if (version !== epoch.current) return; await after?.(next, version); } catch (reason) { if (version === epoch.current) setError(reason instanceof Error ? reason.message : "Game request failed."); } finally { if (version === epoch.current) commitBusy(false); }
  }, [apply, commitBusy, stop]);
  const poll = useCallback((previous: GameSnapshot, version: number) => new Promise<void>((resolve, reject) => {
    let settled = false; const finish = (error?: Error) => { if (settled) return; settled = true; if (pollDone.current === finish) pollDone.current = undefined; if (pollTimer.current) window.clearTimeout(pollTimer.current); if (pollExpiry.current) window.clearTimeout(pollExpiry.current); pollTimer.current = undefined; pollExpiry.current = undefined; error ? reject(error) : resolve(); };
    pollDone.current = finish;
    const check = async (): Promise<void> => {
      if (version !== epoch.current) return finish();
      try { const next = await client.state(previous.gameId); if (settled || version !== epoch.current) return finish(); apply(next, version); if (next.stateVersion > previous.stateVersion || next.status === "finished") return finish(); } catch { /* transient host failure: retry until deadline */ }
      if (!settled && version === epoch.current) pollTimer.current = window.setTimeout(() => void check(), 1000);
    };
    pollTimer.current = window.setTimeout(() => void check(), 1000);
    pollExpiry.current = window.setTimeout(() => finish(new Error("GPT did not return a move in time.")), 15_000);
  }), [apply, client]);
  const gptTurn = useCallback(async (next: GameSnapshot, version: number) => {
    if (next.status === "finished" || next.turn === next.playerColor) return;
    if (bridge.embedded) { await bridge.sendMessage(`Call get_game_state for gameId ${next.gameId}, select one exact entry from legalMoves, then call play_game_move with actor 'gpt' and expectedVersion ${next.stateVersion}.`); await poll(next, version); return; }
    const moves = [...next.legalMoves].sort((a, b) => a.localeCompare(b)); const options = moves.filter(move => move !== "pass"); const move = (options.length ? options : moves)[Math.floor((options.length ? options : moves).length / 2)];
    if (!move) return; const reply = await client.play(next.gameId, "gpt", move, next.stateVersion); apply(reply, version);
  }, [apply, bridge, client, poll]);
  useEffect(() => { let alive = true; const initEpoch = epoch.current; const unsubscribe = bridge.onToolResult(result => { const next = result.structuredContent; const current = gameRef.current; if (!isSnapshot(next)) return; if (!current) { gameRef.current = next; setGame(next); return; } if (next.gameId !== current.gameId) return; if (next.stateVersion === 0) { resetBarrier.current = current.stateVersion + 1; stop(); commitBusy(false); setSelected(undefined); gameRef.current = next; setGame(next); return; } if (resetBarrier.current !== undefined && next.stateVersion <= resetBarrier.current) return; if (busyRef.current || next.stateVersion <= current.stateVersion) return; gameRef.current = next; setGame(next); }); const context = bridge.onHostContext(() => undefined); if (bridge.embedded) void bridge.initialize().catch(() => { if (alive && epoch.current === initEpoch) setError("Could not initialize the game host."); }); return () => { alive = false; unsubscribe(); context(); stop(); bridge.dispose(); }; }, [bridge, commitBusy, stop]);
  useEffect(() => { if (!game) void action(() => client.create("chess")); }, [action, client, game]);
  const humanMove = (move: string) => game && action(() => client.play(game.gameId, "player", move, game.stateVersion), gptTurn);
  const chessSquare = (square: string) => { if (!game || game.kind !== "chess") return; if (!selected) { setSelected(square); return; } const legal = game.legalMoves.filter(move => move.startsWith(selected) && move.slice(2, 4) === square).sort(); const move = legal.find(m => m.endsWith("q")) ?? legal[0]; if (move) humanMove(move); else setSelected(undefined); };
  return <main className="arena"><header><h1><span>GPT</span> GAME <em>ARENA</em></h1><div className="new-games"><button className="primary" onClick={() => void action(() => client.create("chess"))}>♞ New Chess</button><button onClick={() => void action(() => client.create("go", "black"))}>● New Go</button></div></header>{error && <p className="error" role="alert">{error}</p>}{game && <section className="table"><GameChrome game={game}/><div className="board-column">{game.kind === "chess" ? <ChessBoard game={game} selected={selected} onSquare={chessSquare} disabled={busy || game.status === "finished" || game.turn !== game.playerColor}/> : <GoBoard game={game} onMove={humanMove} disabled={busy || game.status === "finished" || game.turn !== game.playerColor}/>}<div className="controls"><button disabled={busy || game.kind !== "go" || game.status === "finished" || game.turn !== game.playerColor} onClick={() => humanMove("pass")}>⊘ Pass</button><button className="primary" disabled={busy} onClick={() => void action(() => client.reset(game.gameId))}>⟳ Reset</button><button disabled={busy} onClick={() => void action(() => client.state(game.gameId))}>⟳ Refresh</button></div>{game.kind === "go" && <p className="captures">Captures — Black: {game.captures.black}, White: {game.captures.white}</p>}<p className="game-status" role="status">{game.winner ? `Winner: ${game.winner}` : game.lastMove ? `Last move: ${game.lastMove.notation}` : "Choose a piece to begin."}</p></div></section>}</main>;
}
