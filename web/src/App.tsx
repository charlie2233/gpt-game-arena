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

const expiredSessionMessage = "This saved game session has expired. Start a new game to continue.";
const gptPollTimeoutMs = 45_000;

type SnapshotMove = { actor: string; notation: string; ply: number };
type ResetBarrier = { gameId: string; staleHistory: SnapshotMove[]; legacyCeiling: number };

function historyStartsWith(history: readonly SnapshotMove[], prefix: readonly SnapshotMove[]): boolean {
  return prefix.length <= history.length && prefix.every((move, index) => {
    const candidate = history[index];
    return candidate?.actor === move.actor && candidate.notation === move.notation && candidate.ply === move.ply;
  });
}

function resetEpochOf(snapshot: GameSnapshot): number {
  return snapshot.resetEpoch ?? 0;
}

function compareSnapshotPosition(left: GameSnapshot, right: GameSnapshot): number {
  return resetEpochOf(left) - resetEpochOf(right) || left.stateVersion - right.stateVersion;
}

function isNotFoundError(reason: unknown): boolean {
  return reason instanceof Error && /(?:^|\b)not_found\b|game (?:was|is) not found/i.test(reason.message);
}

function requestErrorMessage(reason: unknown): string {
  if (isNotFoundError(reason)) return expiredSessionMessage;
  return reason instanceof Error ? reason.message : "Game request failed.";
}

export function App({ bridge: suppliedBridge, initialGame }: { bridge?: GameBridge; initialGame?: GameSnapshot } = {}) {
  const [bridge] = useState(() => suppliedBridge ?? new GameBridge());
  const [client] = useState(() => new GameClient(bridge));
  const [hostSeed] = useState<GameSnapshot | undefined>(() => initialGame === undefined ? initialHostState() : undefined);
  const initialSnapshot = initialGame ?? hostSeed;
  const [game, setGame] = useState<GameSnapshot | undefined>(() => initialSnapshot);
  const [selected, setSelected] = useState<string>();
  const [gamePreset, setGamePreset] = useState<GamePreset>(() => presetFor(initialSnapshot));
  const [difficultyPreset, setDifficultyPreset] = useState<GameDifficulty>(() => initialSnapshot?.difficulty ?? "medium");
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string>();
  const epoch = useRef(0); const pollTimer = useRef<number>(); const pollExpiry = useRef<number>(); const pollDone = useRef<((next?: GameSnapshot) => void)>(); const gameRef = useRef<GameSnapshot | undefined>(game); const busyRef = useRef(busy); const resetBarrier = useRef<ResetBarrier>(); const resetPending = useRef<string>(); const recoveryStarted = useRef(false); const lifecycleTimer = useRef<number>();
  const stop = useCallback(() => { epoch.current += 1; if (pollTimer.current) window.clearTimeout(pollTimer.current); if (pollExpiry.current) window.clearTimeout(pollExpiry.current); pollTimer.current = undefined; pollExpiry.current = undefined; pollDone.current?.(); pollDone.current = undefined; }, []);
  const commitBusy = useCallback((next: boolean) => { busyRef.current = next; setBusy(next); }, []);
  const apply = useCallback((next: GameSnapshot, version: number) => {
    if (version !== epoch.current) return;
    const prior = gameRef.current;
    if (!prior || prior.gameId !== next.gameId || resetEpochOf(next) > resetEpochOf(prior)) resetBarrier.current = undefined;
    else if (next.resetEpoch === undefined && prior.resetEpoch === undefined && next.stateVersion === 0 && prior.stateVersion > 0) {
      resetBarrier.current = { gameId: next.gameId, staleHistory: [...prior.moveHistory], legacyCeiling: prior.stateVersion + 1 };
    }
    gameRef.current = next;
    setGame(next);
  }, []);
  const action = useCallback(async (run: () => Promise<GameSnapshot>, after?: (next: GameSnapshot, version: number) => Promise<void>, startsGame = false, resetGameId?: string) => {
    stop(); const version = epoch.current; resetPending.current = resetGameId; commitBusy(true); setStarting(startsGame); setError(undefined); setSelected(undefined);
    try { const next = await run(); if (version !== epoch.current) return; apply(next, version); if (version !== epoch.current) return; await after?.(next, version); } catch (reason) { if (version === epoch.current) setError(requestErrorMessage(reason)); } finally { if (version === epoch.current) { if (resetPending.current === resetGameId) resetPending.current = undefined; commitBusy(false); setStarting(false); } }
  }, [apply, commitBusy, stop]);
  const poll = useCallback((previous: GameSnapshot, version: number) => new Promise<GameSnapshot | undefined>((resolve, reject) => {
    let settled = false; const finish = (next?: GameSnapshot, error?: Error) => { if (settled) return; settled = true; if (pollDone.current === finish) pollDone.current = undefined; if (pollTimer.current) window.clearTimeout(pollTimer.current); if (pollExpiry.current) window.clearTimeout(pollExpiry.current); pollTimer.current = undefined; pollExpiry.current = undefined; error ? reject(error) : resolve(next); };
    pollDone.current = finish;
    const check = async (): Promise<void> => {
      if (version !== epoch.current) return finish();
      try { const next = await client.state(previous.gameId); if (settled || version !== epoch.current) return finish(); if (next.gameId === previous.gameId && compareSnapshotPosition(next, previous) > 0) { apply(next, version); return finish(next); } } catch { /* transient host failure: retry until deadline */ }
      if (!settled && version === epoch.current) pollTimer.current = window.setTimeout(() => void check(), 1000);
    };
    pollTimer.current = window.setTimeout(() => void check(), 1000);
    pollExpiry.current = window.setTimeout(() => finish(undefined, new Error("GPT did not return a move in time.")), gptPollTimeoutMs);
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
      if (reply.gameId !== current.gameId || resetEpochOf(reply) !== resetEpochOf(current) || reply.stateVersion <= current.stateVersion) throw new Error("The game service returned a non-advancing GPT state.");
      apply(reply, version);
      current = reply;
    }
    if (current.status === "active" && current.turn !== current.playerColor) throw new Error("GPT turn limit reached.");
  }, [apply, bridge, client, poll]);
  useEffect(() => {
    if (lifecycleTimer.current) { window.clearTimeout(lifecycleTimer.current); lifecycleTimer.current = undefined; }
    let alive = true;
    const initEpoch = epoch.current;
    const unsubscribe = bridge.onToolResult(result => {
      const next = result.structuredContent;
      const current = gameRef.current;
      if (!isSnapshot(next)) return;
      if (!current) {
        stop(); commitBusy(false); setStarting(false); setError(undefined); setGamePreset(presetFor(next)); setDifficultyPreset(next.difficulty); gameRef.current = next; setGame(next); return;
      }
      if (next.gameId !== current.gameId) return;
      const epochComparison = resetEpochOf(next) - resetEpochOf(current);
      if (epochComparison < 0) return;
      const barrier = resetBarrier.current;
      if (epochComparison === 0 && next.stateVersion === 0) {
        if (current.stateVersion === 0 || barrier?.gameId === next.gameId || resetPending.current !== next.gameId) return;
        resetBarrier.current = { gameId: next.gameId, staleHistory: [...current.moveHistory], legacyCeiling: current.stateVersion + 1 };
        resetPending.current = undefined;
        stop(); commitBusy(false); setStarting(false); setError(undefined); setSelected(undefined); gameRef.current = next; setGame(next); return;
      }
      if (epochComparison === 0) {
        if (next.stateVersion <= current.stateVersion) return;
        if (!historyStartsWith(next.moveHistory, current.moveHistory)) return;
        if (barrier?.gameId === next.gameId && barrier.staleHistory.length === 0 && next.stateVersion <= barrier.legacyCeiling) return;
        if (barrier?.gameId === next.gameId && barrier.staleHistory.length > 0 && historyStartsWith(next.moveHistory, barrier.staleHistory)) return;
      } else {
        resetBarrier.current = undefined;
        resetPending.current = undefined;
      }
      const finishPoll = pollDone.current;
      gameRef.current = next;
      setGame(next);
      setSelected(undefined);
      setError(undefined);
      finishPoll?.(next);
      if (!finishPoll && next.status === "active" && next.turn !== next.playerColor) {
        void action(() => Promise.resolve(next), gptTurn);
      }
    });
    const context = bridge.onHostContext(() => undefined);
    if (bridge.embedded) void bridge.initialize().catch(() => { if (alive && epoch.current === initEpoch) setError("Could not initialize the game host."); });
    return () => {
      alive = false;
      unsubscribe();
      context();
      lifecycleTimer.current = window.setTimeout(() => { stop(); bridge.dispose(); lifecycleTimer.current = undefined; }, 0);
    };
  }, [action, bridge, commitBusy, gptTurn, stop]);
  useEffect(() => {
    if (!bridge.embedded || !hostSeed || recoveryStarted.current) return;
    recoveryStarted.current = true;
    const version = epoch.current;
    commitBusy(true);
    setError(undefined);
    void (async () => {
      try {
        let reconciled: GameSnapshot | undefined;
        try {
          const authoritative = await client.state(hostSeed.gameId);
          if (version !== epoch.current) return;
          const current = gameRef.current;
          if (!current || current.gameId !== hostSeed.gameId) return;
          reconciled = current;
          if (authoritative.gameId !== hostSeed.gameId) throw new Error("The game service returned the wrong saved game.");
          if (compareSnapshotPosition(authoritative, current) >= 0) {
            apply(authoritative, version);
            reconciled = authoritative;
          } else if (compareSnapshotPosition(current, hostSeed) === 0) {
            setError("The saved board is newer than the server session. Use Refresh to try again.");
            return;
          }
        } catch (reason) {
          if (version !== epoch.current) return;
          if (isNotFoundError(reason)) { setError(expiredSessionMessage); return; }
          const current = gameRef.current;
          if (!current || current.gameId !== hostSeed.gameId || compareSnapshotPosition(current, hostSeed) <= 0) {
            setError("Could not reconnect to this saved game. Use Refresh to try again.");
            return;
          }
          reconciled = current;
        }
        setError(undefined);
        if (reconciled?.status === "active" && reconciled.turn !== reconciled.playerColor) await gptTurn(reconciled, version);
      } catch (reason) {
        if (version !== epoch.current) return;
        const message = requestErrorMessage(reason);
        setError(isNotFoundError(reason) ? message : `${message} Use Refresh to try again.`);
      } finally {
        if (version === epoch.current) commitBusy(false);
      }
    })();
  }, [apply, bridge.embedded, client, commitBusy, gptTurn, hostSeed]);
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
  return <main className="arena"><header><h1><span>GPT</span> GAME <em>ARENA</em></h1>{!hostHydrating && <form className="new-game-picker" aria-busy={starting} onSubmit={event => { event.preventDefault(); void startGame(); }}><label className="picker-field" htmlFor="game-preset"><span>NEW GAME</span><select id="game-preset" value={gamePreset} disabled={starting} onChange={event => setGamePreset(event.target.value as GamePreset)}>{gamePresets.map(preset => <option key={preset.value} value={preset.value}>{preset.label}</option>)}</select></label><label className="picker-field" htmlFor="difficulty-preset"><span>DIFFICULTY</span><select id="difficulty-preset" value={difficultyPreset} disabled={starting} onChange={event => setDifficultyPreset(event.target.value as GameDifficulty)}>{difficultyPresets.map(preset => <option key={preset.value} value={preset.value}>{preset.label}</option>)}</select></label><button className="primary" type="submit" disabled={starting}>{starting ? "Starting…" : "Start game"}</button></form>}</header>{hostHydrating && <p className="game-status" role="status">Loading game…</p>}{error && <p className="error" role="alert">{error}</p>}{game && <section className="table"><GameChrome game={game}/><div className="board-column">{game.kind === "chess" ? <ChessBoard game={game} selected={selected} onSquare={chessSquare} disabled={disabled}/> : game.kind === "go" ? <GoBoard game={game} onMove={humanMove} disabled={disabled}/> : game.kind === "tic-tac-toe" ? <TicTacToeBoard game={game} onMove={humanMove} disabled={disabled}/> : game.kind === "reversi" ? <ReversiBoard game={game} onMove={humanMove} disabled={disabled}/> : <ConnectFourBoard game={game} onMove={humanMove} disabled={disabled}/>}<div className="controls">{game.kind === "go" && <button disabled={disabled} onClick={() => humanMove("pass")}>⊘ Pass</button>}<button className="primary" disabled={busy} onClick={() => void action(() => client.reset(game.gameId), undefined, false, game.gameId)}>⟳ Reset</button><button disabled={busy} onClick={() => void action(() => client.state(game.gameId), gptTurn)}>⟳ Refresh</button></div>{game.kind === "go" && <p className="captures">Captures — Black: {game.captures.black}, White: {game.captures.white}</p>}{game.kind === "reversi" && <p className="captures">Disks — Black: {game.score.black}, White: {game.score.white}</p>}<p className="game-status" role="status">{game.winner ? `Winner: ${game.winner}` : game.lastMove ? `Last move: ${game.lastMove.notation}` : "Choose a piece to begin."}</p></div></section>}</main>;
}

function gameTextState(game: GameSnapshot | undefined, gamePreset: GamePreset, difficultyPreset: GameDifficulty, busy: boolean, starting: boolean, selected: string | undefined, error: string | undefined) {
  if (!game) return { mode: "loading", draft: { game: gamePreset, difficulty: difficultyPreset }, busy, starting, error };
  const coordinateSystem = game.kind === "chess" ? "Chess files a-h run left-to-right; ranks 1-8 run White-to-Black." : game.kind === "go" ? `Go columns ${"ABCDEFGHJKLMNOPQRST".slice(0, game.boardSize)} run left-to-right, I is skipped, and ranks ${game.boardSize}-1 run top-to-bottom.` : game.kind === "tic-tac-toe" ? "Tic-Tac-Toe columns A-C run left-to-right and ranks 3-1 run top-to-bottom." : game.kind === "connect-four" ? "Connect Four columns A-G run left-to-right and ranks 6-1 run top-to-bottom." : "Reversi columns A-H run left-to-right and ranks 8-1 run top-to-bottom.";
  const board = game.kind === "chess"
    ? Array.from({ length: 8 }, (_, row) => game.board.slice(row * 8, row * 8 + 8).map((cell) => cell.piece ? (cell.color === "white" ? cell.piece.toUpperCase() : cell.piece) : ".").join(""))
    : game.board.map((row) => row.map((stone) => stone === "black" ? "B" : stone === "white" ? "W" : ".").join(""));
  return { mode: game.status, draft: { game: gamePreset, difficulty: difficultyPreset }, busy, starting, error, selected, coordinateSystem, game: { gameId: game.gameId, resetEpoch: resetEpochOf(game), kind: game.kind, difficulty: game.difficulty, playerColor: game.playerColor, turn: game.turn, status: game.status, winner: game.winner, stateVersion: game.stateVersion, message: game.message, lastMove: game.lastMove, legalMoves: game.legalMoves, board, ...(game.kind === "reversi" ? { score: game.score } : {}), ...(game.kind === "tic-tac-toe" || game.kind === "connect-four" ? { winningLine: game.winningLine } : {}) } };
}
