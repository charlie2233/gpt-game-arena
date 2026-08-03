import { useCallback, useEffect, useRef, useState } from "react";
import { GameBridge } from "./bridge";
import { GameClient, isSnapshot } from "./game-client";
import { ChessBoard } from "./components/ChessBoard";
import { GoBoard } from "./components/GoBoard";
import { GameChrome } from "./components/GameChrome";
import { ConnectFourBoard, ReversiBoard, TicTacToeBoard } from "./components/SmallBoards";
import { chooseStandaloneMove, embeddedMovePrompt } from "./move-strategy";
import type { GameDifficulty, GameSnapshot, GoBoardSize } from "./types";

type GamePreset = "chess" | "tic-tac-toe" | "connect-four" | "reversi" | `go-${GoBoardSize}`;
const gamePresets: ReadonlyArray<{ value: GamePreset; label: string }> = [
  { value: "chess", label: "Chess" },
  { value: "tic-tac-toe", label: "Tic-Tac-Toe" },
  { value: "connect-four", label: "Connect Four" },
  { value: "reversi", label: "Reversi" },
  { value: "go-9", label: "Quick Go · 9×9" },
  { value: "go-13", label: "Go · 13×13" },
  { value: "go-19", label: "Real Go · 19×19" },
];
const difficultyPresets: ReadonlyArray<{ value: GameDifficulty; label: string }> = [
  { value: "easy", label: "Easy" },
  { value: "medium", label: "Medium" },
  { value: "hard", label: "Hard" },
];

function presetFor(game?: GameSnapshot): GamePreset {
  return game?.kind === "go" ? `go-${game.boardSize}` : game?.kind ?? "chess";
}

type ChatGptHost = {
  toolOutput?: unknown;
  initialState?: unknown;
  widgetState?: unknown;
  setWidgetState?: (state: unknown) => void | Promise<void>;
};

function chatGptHost(): ChatGptHost | undefined {
  return (window as Window & { openai?: ChatGptHost }).openai;
}

function snapshotFromHost(candidate: unknown): GameSnapshot | undefined {
  if (isSnapshot(candidate)) return candidate;
  if (!candidate || typeof candidate !== "object") return;
  const value = candidate as { structuredContent?: unknown; game?: unknown };
  if (isSnapshot(value.structuredContent)) return value.structuredContent;
  if (isSnapshot(value.game)) return value.game;
}

function initialHostState(): GameSnapshot | undefined {
  const state = chatGptHost();
  return snapshotFromHost(state?.widgetState) ?? snapshotFromHost(state?.toolOutput) ?? snapshotFromHost(state?.initialState);
}
export function App({ bridge: suppliedBridge, initialGame }: { bridge?: GameBridge; initialGame?: GameSnapshot } = {}) {
  const bridge = useRef(suppliedBridge ?? new GameBridge()).current;
  const client = useRef(new GameClient(bridge)).current;
  const [game, setGame] = useState<GameSnapshot | undefined>(() => initialGame ?? initialHostState());
  const [selected, setSelected] = useState<string>();
  const [gamePreset, setGamePreset] = useState<GamePreset>(() => presetFor(initialGame ?? initialHostState()));
  const [difficultyPreset, setDifficultyPreset] = useState<GameDifficulty>(() => (initialGame ?? initialHostState())?.difficulty ?? "medium");
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string>();
  const epoch = useRef(0); const pollTimer = useRef<number>(); const pollExpiry = useRef<number>(); const pollDone = useRef<((next?: GameSnapshot) => void)>(); const gameRef = useRef<GameSnapshot | undefined>(game); const busyRef = useRef(busy); const resetBarrier = useRef<{ gameId: string; ceiling: number }>();
  const stop = useCallback(() => { epoch.current += 1; if (pollTimer.current) window.clearTimeout(pollTimer.current); if (pollExpiry.current) window.clearTimeout(pollExpiry.current); pollTimer.current = undefined; pollExpiry.current = undefined; pollDone.current?.(); pollDone.current = undefined; }, []);
  const commitBusy = useCallback((next: boolean) => { busyRef.current = next; setBusy(next); }, []);
  const apply = useCallback((next: GameSnapshot, version: number) => { if (version !== epoch.current) return; const prior = gameRef.current; if (!prior || prior.gameId !== next.gameId) resetBarrier.current = undefined; else if (next.stateVersion === 0) resetBarrier.current = { gameId: next.gameId, ceiling: Math.max(resetBarrier.current?.gameId === next.gameId ? resetBarrier.current.ceiling : 0, prior.stateVersion + 1) }; gameRef.current = next; setGame(next); }, []);
  const action = useCallback(async (run: () => Promise<GameSnapshot>, after?: (next: GameSnapshot, version: number) => Promise<void>, startsGame = false) => {
    stop(); const version = epoch.current; commitBusy(true); setStarting(startsGame); setError(undefined); setSelected(undefined);
    try { const next = await run(); if (version !== epoch.current) return; apply(next, version); if (version !== epoch.current) return; await after?.(next, version); } catch (reason) { if (version === epoch.current) setError(reason instanceof Error ? reason.message : "Game request failed."); } finally { if (version === epoch.current) { commitBusy(false); setStarting(false); } }
  }, [apply, commitBusy, stop]);
  const poll = useCallback((previous: GameSnapshot, version: number) => new Promise<GameSnapshot | undefined>((resolve, reject) => {
    let settled = false; const finish = (next?: GameSnapshot, error?: Error) => { if (settled) return; settled = true; if (pollDone.current === finish) pollDone.current = undefined; if (pollTimer.current) window.clearTimeout(pollTimer.current); if (pollExpiry.current) window.clearTimeout(pollExpiry.current); pollTimer.current = undefined; pollExpiry.current = undefined; error ? reject(error) : resolve(next); };
    pollDone.current = finish;
    const check = async (): Promise<void> => {
      if (version !== epoch.current) return finish();
      try { const next = await client.state(previous.gameId); if (settled || version !== epoch.current) return finish(); if (next.gameId === previous.gameId && next.stateVersion > previous.stateVersion) { apply(next, version); return finish(next); } } catch { /* transient host failure: retry until deadline */ }
      if (!settled && version === epoch.current) pollTimer.current = window.setTimeout(() => void check(), 1000);
    };
    pollTimer.current = window.setTimeout(() => void check(), 1000);
    pollExpiry.current = window.setTimeout(() => finish(undefined, new Error("GPT did not return a move in time.")), 15_000);
  }), [apply, client]);
  const gptTurn = useCallback(async (next: GameSnapshot, version: number) => {
    let current = next;
    for (let turns = 0; turns < 128 && current.status === "active" && current.turn !== current.playerColor; turns += 1) {
      if (version !== epoch.current) return;
      if (bridge.embedded) {
        await bridge.sendMessage(embeddedMovePrompt(current));
        if (version !== epoch.current) return;
        const reply = await poll(current, version);
        if (!reply || version !== epoch.current) return;
        current = reply;
        continue;
      }
      const move = chooseStandaloneMove(current);
      if (!move) return;
      const reply = await client.play(current.gameId, "gpt", move, current.stateVersion);
      if (version !== epoch.current) return;
      if (reply.gameId !== current.gameId || reply.stateVersion <= current.stateVersion) throw new Error("The game service returned a non-advancing GPT state.");
      apply(reply, version);
      current = reply;
    }
    if (current.status === "active" && current.turn !== current.playerColor) throw new Error("GPT turn limit reached.");
  }, [apply, bridge, client, poll]);
  useEffect(() => { let alive = true; const initEpoch = epoch.current; const unsubscribe = bridge.onToolResult(result => { const next = result.structuredContent; const current = gameRef.current; if (!isSnapshot(next)) return; if (!current) { stop(); commitBusy(false); setStarting(false); setGamePreset(presetFor(next)); setDifficultyPreset(next.difficulty); gameRef.current = next; setGame(next); return; } if (next.gameId !== current.gameId) return; const barrier = resetBarrier.current; if (next.stateVersion === 0) { if (current.stateVersion === 0 || barrier?.gameId === next.gameId) return; resetBarrier.current = { gameId: next.gameId, ceiling: current.stateVersion + 1 }; stop(); commitBusy(false); setStarting(false); setSelected(undefined); gameRef.current = next; setGame(next); return; } if (barrier?.gameId === next.gameId && next.stateVersion <= barrier.ceiling) return; const finishPoll = pollDone.current; if (!finishPoll || next.stateVersion <= current.stateVersion) return; gameRef.current = next; setGame(next); finishPoll(next); }); const context = bridge.onHostContext(() => undefined); if (bridge.embedded) void bridge.initialize().catch(() => { if (alive && epoch.current === initEpoch) setError("Could not initialize the game host."); }); return () => { alive = false; unsubscribe(); context(); stop(); bridge.dispose(); }; }, [bridge, commitBusy, stop]);
  useEffect(() => { if (!game && !bridge.embedded) void action(() => client.create({ game: "chess", playerColor: "white", difficulty: "medium" }), undefined, true); }, [action, bridge.embedded, client, game]);
  useEffect(() => {
    if (!game || !bridge.embedded) return;
    const host = chatGptHost();
    if (!host?.setWidgetState) return;
    void Promise.resolve(host.setWidgetState({ game })).catch(() => undefined);
  }, [bridge.embedded, game]);
  const currentPreset = presetFor(game);
  useEffect(() => { if (game) { setGamePreset(currentPreset); setDifficultyPreset(game.difficulty); } }, [currentPreset, game?.gameId]);
  const humanMove = (move: string) => game && action(() => client.play(game.gameId, "player", move, game.stateVersion), gptTurn);
  const chessSquare = (square: string) => { if (!game || game.kind !== "chess") return; if (!selected) { setSelected(square); return; } const legal = game.legalMoves.filter(move => move.startsWith(selected) && move.slice(2, 4) === square).sort(); const move = legal.find(m => m.endsWith("q")) ?? legal[0]; if (move) humanMove(move); else setSelected(undefined); };
  const startGame = () => {
    if (gamePreset === "chess") return action(() => client.create({ game: "chess", playerColor: "white", difficulty: difficultyPreset }), undefined, true);
    if (gamePreset === "tic-tac-toe" || gamePreset === "connect-four" || gamePreset === "reversi") return action(() => client.create({ game: gamePreset, playerColor: "black", difficulty: difficultyPreset }), undefined, true);
    const boardSize = Number(gamePreset.slice(3)) as GoBoardSize;
    return action(() => client.create({ game: "go", playerColor: "black", difficulty: difficultyPreset, ...(boardSize === 9 ? {} : { boardSize }) }), undefined, true);
  };
  useEffect(() => {
    const render = () => JSON.stringify(gameTextState(game, gamePreset, difficultyPreset, busy, starting, selected, error));
    const advance = (_milliseconds: number) => { /* This turn-based DOM game has no animation clock. */ };
    window.render_game_to_text = render;
    window.advanceTime = advance;
    return () => {
      if (window.render_game_to_text === render) Reflect.deleteProperty(window, "render_game_to_text");
      if (window.advanceTime === advance) Reflect.deleteProperty(window, "advanceTime");
    };
  }, [busy, difficultyPreset, error, game, gamePreset, selected, starting]);
  const disabled = busy || game?.status === "finished" || game?.turn !== game?.playerColor;
  const hostHydrating = bridge.embedded && !game && !error;
  return <main className="arena"><header><h1><span>GPT</span> GAME <em>ARENA</em></h1>{!hostHydrating && <form className="new-game-picker" aria-busy={starting} onSubmit={event => { event.preventDefault(); void startGame(); }}><label className="picker-field" htmlFor="game-preset"><span>NEW GAME</span><select id="game-preset" value={gamePreset} disabled={starting} onChange={event => setGamePreset(event.target.value as GamePreset)}>{gamePresets.map(preset => <option key={preset.value} value={preset.value}>{preset.label}</option>)}</select></label><label className="picker-field" htmlFor="difficulty-preset"><span>DIFFICULTY</span><select id="difficulty-preset" value={difficultyPreset} disabled={starting} onChange={event => setDifficultyPreset(event.target.value as GameDifficulty)}>{difficultyPresets.map(preset => <option key={preset.value} value={preset.value}>{preset.label}</option>)}</select></label><button className="primary" type="submit" disabled={starting}>{starting ? "Starting…" : "Start game"}</button></form>}</header>{hostHydrating && <p className="game-status" role="status">Loading game…</p>}{error && <p className="error" role="alert">{error}</p>}{game && <section className="table"><GameChrome game={game}/><div className="board-column">{game.kind === "chess" ? <ChessBoard game={game} selected={selected} onSquare={chessSquare} disabled={disabled}/> : game.kind === "go" ? <GoBoard game={game} onMove={humanMove} disabled={disabled}/> : game.kind === "tic-tac-toe" ? <TicTacToeBoard game={game} onMove={humanMove} disabled={disabled}/> : game.kind === "reversi" ? <ReversiBoard game={game} onMove={humanMove} disabled={disabled}/> : <ConnectFourBoard game={game} onMove={humanMove} disabled={disabled}/>}<div className="controls">{game.kind === "go" && <button disabled={disabled} onClick={() => humanMove("pass")}>⊘ Pass</button>}<button className="primary" disabled={busy} onClick={() => void action(() => client.reset(game.gameId))}>⟳ Reset</button><button disabled={busy} onClick={() => void action(() => client.state(game.gameId))}>⟳ Refresh</button></div>{game.kind === "go" && <p className="captures">Captures — Black: {game.captures.black}, White: {game.captures.white}</p>}{game.kind === "reversi" && <p className="captures">Disks — Black: {game.score.black}, White: {game.score.white}</p>}<p className="game-status" role="status">{game.winner ? `Winner: ${game.winner}` : game.lastMove ? `Last move: ${game.lastMove.notation}` : "Choose a piece to begin."}</p></div></section>}</main>;
}

function gameTextState(game: GameSnapshot | undefined, gamePreset: GamePreset, difficultyPreset: GameDifficulty, busy: boolean, starting: boolean, selected: string | undefined, error: string | undefined) {
  if (!game) return { mode: "loading", draft: { game: gamePreset, difficulty: difficultyPreset }, busy, starting, error };
  const coordinateSystem = game.kind === "chess" ? "Chess files a-h run left-to-right; ranks 1-8 run White-to-Black." : game.kind === "go" ? `Go columns ${"ABCDEFGHJKLMNOPQRST".slice(0, game.boardSize)} run left-to-right, I is skipped, and ranks ${game.boardSize}-1 run top-to-bottom.` : game.kind === "tic-tac-toe" ? "Tic-Tac-Toe columns A-C run left-to-right and ranks 3-1 run top-to-bottom." : game.kind === "connect-four" ? "Connect Four columns A-G run left-to-right and ranks 6-1 run top-to-bottom." : "Reversi columns A-H run left-to-right and ranks 8-1 run top-to-bottom.";
  const board = game.kind === "chess"
    ? Array.from({ length: 8 }, (_, row) => game.board.slice(row * 8, row * 8 + 8).map((cell) => cell.piece ? (cell.color === "white" ? cell.piece.toUpperCase() : cell.piece) : ".").join(""))
    : game.board.map((row) => row.map((stone) => stone === "black" ? "B" : stone === "white" ? "W" : ".").join(""));
  return { mode: game.status, draft: { game: gamePreset, difficulty: difficultyPreset }, busy, starting, error, selected, coordinateSystem, game: { gameId: game.gameId, kind: game.kind, difficulty: game.difficulty, playerColor: game.playerColor, turn: game.turn, status: game.status, winner: game.winner, stateVersion: game.stateVersion, message: game.message, lastMove: game.lastMove, legalMoves: game.legalMoves, board, ...(game.kind === "reversi" ? { score: game.score } : {}), ...(game.kind === "tic-tac-toe" || game.kind === "connect-four" ? { winningLine: game.winningLine } : {}) } };
}
