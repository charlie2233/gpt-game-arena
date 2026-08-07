import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { GameBridge } from "./bridge";
import { GameClient, isSnapshot } from "./game-client";
import { ChessBoard } from "./components/ChessBoard";
import { GoBoard } from "./components/GoBoard";
import { GameChrome } from "./components/GameChrome";
import { ConnectFourBoard, ReversiBoard, TicTacToeBoard } from "./components/SmallBoards";
import { chooseStandaloneMove, embeddedMoveDecision, embeddedMovePrompt } from "./move-strategy";
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
  maxHeight?: unknown;
  setWidgetState?: (state: unknown) => void | Promise<void>;
};

function chatGptHost(): ChatGptHost | undefined {
  return (window as Window & { openai?: ChatGptHost }).openai;
}

function maxHeightFrom(value: unknown): number | undefined {
  if (!value || typeof value !== "object") return;
  const maxHeight = (value as { maxHeight?: unknown }).maxHeight;
  return typeof maxHeight === "number" && Number.isFinite(maxHeight) && maxHeight > 0 ? Math.round(maxHeight) : undefined;
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
const gptPollInitialDelayMs = 750;
const gptPollMaximumDelayMs = 2_500;
const endGameDescription = "The board will be frozen. Reset or start a New Game afterward.";
const endGamePrompt = `End this game? ${endGameDescription}`;

type SnapshotMove = { actor: string; notation: string; ply: number };
type ResetBarrier = { gameId: string; staleHistory: SnapshotMove[]; legacyCeiling: number };
type PendingPoll = { accepts: (next: GameSnapshot) => boolean; finish: (next?: GameSnapshot, error?: Error) => void };
type EndConfirmation = { gameId: string; expectedVersion: number; expectedResetEpoch: number };

function historyStartsWith(history: readonly SnapshotMove[], prefix: readonly SnapshotMove[]): boolean {
  return prefix.length <= history.length && prefix.every((move, index) => {
    const candidate = history[index];
    return candidate?.actor === move.actor && candidate.notation === move.notation && candidate.ply === move.ply;
  });
}

function resetEpochOf(snapshot: GameSnapshot): number {
  return snapshot.resetEpoch ?? 0;
}

function requiresImportReview(snapshot: GameSnapshot | undefined): boolean {
  return snapshot?.kind === "go"
    && snapshot.initialPosition !== undefined
    && snapshot.status === "active"
    && snapshot.importReview === "pending";
}

function compareSnapshotPosition(left: GameSnapshot, right: GameSnapshot): number {
  return resetEpochOf(left) - resetEpochOf(right) || left.stateVersion - right.stateVersion;
}

function isConfirmedGptAdvance(previous: GameSnapshot, next: GameSnapshot): boolean {
  if (next.gameId !== previous.gameId || resetEpochOf(next) !== resetEpochOf(previous)) return false;
  if (next.stateVersion !== previous.stateVersion + 1 || next.moveHistory.length !== previous.moveHistory.length + 1) return false;
  if (!historyStartsWith(next.moveHistory, previous.moveHistory)) return false;
  const appended = next.moveHistory[previous.moveHistory.length];
  return appended?.actor === "gpt" && appended.color === previous.turn;
}

function isNotFoundError(reason: unknown): boolean {
  return reason instanceof Error && /(?:^|\b)not_found\b|game (?:was|is) not found/i.test(reason.message);
}

function requestErrorMessage(reason: unknown): string {
  if (isNotFoundError(reason)) return expiredSessionMessage;
  return reason instanceof Error ? reason.message : "Game request failed.";
}

function isEndDefinitelyNotApplied(reason: unknown): boolean {
  return reason instanceof Error && /\bEND_NOT_APPLIED\b|^(?:invalid_input|not_found|stale_version|version_conflict|game_finished):/i.test(reason.message);
}

function isImportReviewDefinitelyNotApplied(reason: unknown): boolean {
  return reason instanceof Error && /\bIMPORT_REVIEW_NOT_APPLIED\b|^(?:invalid_input|not_found|stale_version|version_conflict|game_finished|import_review_unavailable):/i.test(reason.message);
}

function isConfirmedManualEnd(snapshot: GameSnapshot): boolean {
  return snapshot.status === "finished" && snapshot.finishReason === "ended";
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
  const [hostMaxHeight, setHostMaxHeight] = useState<number | undefined>(() => maxHeightFrom(chatGptHost()));
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string>();
  const [endConfirmation, setEndConfirmation] = useState<EndConfirmation>();
  const epoch = useRef(0); const pollTimer = useRef<number>(); const pollExpiry = useRef<number>(); const pendingPoll = useRef<PendingPoll>(); const gameRef = useRef<GameSnapshot | undefined>(game); const busyRef = useRef(busy); const resetBarrier = useRef<ResetBarrier>(); const resetPending = useRef<string>(); const recoveryStarted = useRef(false); const lifecycleTimer = useRef<number>(); const endGameTrigger = useRef<HTMLButtonElement>(null); const restoreEndGameFocus = useRef(false);
  const stop = useCallback(() => { epoch.current += 1; if (pollTimer.current) window.clearTimeout(pollTimer.current); if (pollExpiry.current) window.clearTimeout(pollExpiry.current); pollTimer.current = undefined; pollExpiry.current = undefined; pendingPoll.current?.finish(); pendingPoll.current = undefined; }, []);
  const commitBusy = useCallback((next: boolean) => { busyRef.current = next; setBusy(next); }, []);
  const apply = useCallback((next: GameSnapshot, version: number) => {
    if (version !== epoch.current) return;
    const prior = gameRef.current;
    if (!prior || prior.gameId !== next.gameId || resetEpochOf(next) > resetEpochOf(prior)) resetBarrier.current = undefined;
    else if (next.resetEpoch === undefined && prior.resetEpoch === undefined && next.stateVersion === 0 && prior.stateVersion > 0) {
      resetBarrier.current = { gameId: next.gameId, staleHistory: [...prior.moveHistory], legacyCeiling: prior.stateVersion + 1 };
    }
    setEndConfirmation(undefined);
    gameRef.current = next;
    setGame(next);
  }, []);
  const action = useCallback(async (run: () => Promise<GameSnapshot>, after?: (next: GameSnapshot, version: number) => Promise<void>, startsGame = false, resetGameId?: string) => {
    stop(); const version = epoch.current; resetPending.current = resetGameId; commitBusy(true); setStarting(startsGame); setError(undefined); setSelected(undefined); setEndConfirmation(undefined);
    try { const next = await run(); if (version !== epoch.current) return; apply(next, version); if (version !== epoch.current) return; await after?.(next, version); } catch (reason) { if (version === epoch.current) setError(requestErrorMessage(reason)); } finally { if (version === epoch.current) { if (resetPending.current === resetGameId) resetPending.current = undefined; commitBusy(false); setStarting(false); } }
  }, [apply, commitBusy, stop]);
  const poll = useCallback((previous: GameSnapshot, version: number) => new Promise<GameSnapshot | undefined>((resolve, reject) => {
    let settled = false;
    let delay = gptPollInitialDelayMs;
    let registered: PendingPoll;
    const accepts = (next: GameSnapshot) => isConfirmedGptAdvance(previous, next);
    const finish = (next?: GameSnapshot, error?: Error) => { if (settled) return; settled = true; if (pendingPoll.current === registered) pendingPoll.current = undefined; if (pollTimer.current) window.clearTimeout(pollTimer.current); if (pollExpiry.current) window.clearTimeout(pollExpiry.current); pollTimer.current = undefined; pollExpiry.current = undefined; error ? reject(error) : resolve(next); };
    registered = { accepts, finish };
    pendingPoll.current = registered;
    const schedule = () => {
      pollTimer.current = window.setTimeout(() => void check(), delay);
      delay = Math.min(gptPollMaximumDelayMs, delay + 500);
    };
    const check = async (): Promise<void> => {
      if (version !== epoch.current) return finish();
      try { const next = await client.state(previous.gameId); if (settled || version !== epoch.current) return finish(); if (next.gameId === previous.gameId && compareSnapshotPosition(next, previous) > 0) { apply(next, version); return accepts(next) || isConfirmedManualEnd(next) ? finish(next) : finish(undefined, new Error("The game changed before GPT's move was confirmed.")); } } catch { /* transient host failure: retry until deadline */ }
      if (!settled && version === epoch.current) schedule();
    };
    schedule();
    pollExpiry.current = window.setTimeout(() => finish(undefined, new Error("GPT move was not confirmed in time.")), gptPollTimeoutMs);
  }), [apply, client]);
  const gptTurn = useCallback(async (next: GameSnapshot, version: number) => {
    if (requiresImportReview(next)) return;
    let current = next;
    for (let turns = 0; turns < 128 && current.status === "active" && current.turn !== current.playerColor; turns += 1) {
      if (version !== epoch.current) return;
      if (requiresImportReview(current)) return;
      if (bridge.embedded) {
        const decision = embeddedMoveDecision(current);
        if (decision.candidateMoves.length === 0) throw new Error("No legal GPT move is available.");
        await bridge.sendMessage(embeddedMovePrompt(current, decision));
        if (version !== epoch.current) return;
        const reply = await poll(current, version);
        if (!reply || version !== epoch.current) return;
        current = reply;
        continue;
      }
      const move = chooseStandaloneMove(current);
      if (!move) return;
      const reply = await client.play(current.gameId, "gpt", move, current.stateVersion, resetEpochOf(current));
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
      const activePoll = pendingPoll.current;
      const resultText = result.content?.map(item => item.text).join(" ") ?? "";
      if (activePoll && result.isError && /^MOVE_NOT_APPLIED\b/.test(resultText)) {
        activePoll.finish(undefined, new Error("GPT move was not applied. Use Refresh to continue."));
        return;
      }
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
      gameRef.current = next;
      setGame(next);
      setSelected(undefined);
      setError(undefined);
      if (activePoll) {
        if (activePoll.accepts(next) || isConfirmedManualEnd(next)) activePoll.finish(next);
        else activePoll.finish(undefined, new Error("The game changed before GPT's move was confirmed."));
      }
      if (!activePoll && !busyRef.current && next.status === "active" && next.turn !== next.playerColor && !requiresImportReview(next)) {
        void action(() => Promise.resolve(next), gptTurn);
      }
    });
    const context = bridge.onHostContext(value => setHostMaxHeight(maxHeightFrom(value) ?? maxHeightFrom(chatGptHost())));
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
        if (reconciled?.status === "active" && reconciled.turn !== reconciled.playerColor && !requiresImportReview(reconciled)) await gptTurn(reconciled, version);
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
  useEffect(() => {
    setEndConfirmation(current => current && game && current.gameId === game.gameId && current.expectedVersion === game.stateVersion && current.expectedResetEpoch === resetEpochOf(game) ? current : undefined);
  }, [game?.gameId, game?.resetEpoch, game?.stateVersion]);
  useEffect(() => {
    if (!endConfirmation && restoreEndGameFocus.current) {
      restoreEndGameFocus.current = false;
      endGameTrigger.current?.focus();
    }
  }, [endConfirmation]);
  const humanMove = (move: string) => game && action(() => client.play(game.gameId, "player", move, game.stateVersion, resetEpochOf(game)), gptTurn);
  const chessSquare = (square: string) => { if (!game || game.kind !== "chess") return; if (!selected) { setSelected(square); return; } const legal = game.legalMoves.filter(move => move.startsWith(selected) && move.slice(2, 4) === square).sort(); const move = legal.find(m => m.endsWith("q")) ?? legal[0]; if (move) humanMove(move); else setSelected(undefined); };
  const startGame = () => {
    if (gamePreset === "chess") return action(() => client.create({ game: "chess", playerColor: "white", difficulty: difficultyPreset }), undefined, true);
    if (gamePreset === "tic-tac-toe" || gamePreset === "connect-four" || gamePreset === "reversi") return action(() => client.create({ game: gamePreset, playerColor: "black", difficulty: difficultyPreset }), undefined, true);
    const boardSize = Number(gamePreset.slice(3)) as GoBoardSize;
    return action(() => client.create({ game: "go", playerColor: "black", difficulty: difficultyPreset, ...(boardSize === 9 ? {} : { boardSize }) }), undefined, true);
  };
  const openEndConfirmation = () => {
    const current = gameRef.current;
    if (!current || current.status !== "active" || (busyRef.current && current.turn === current.playerColor)) return;
    setEndConfirmation({ gameId: current.gameId, expectedVersion: current.stateVersion, expectedResetEpoch: resetEpochOf(current) });
  };
  const confirmEndGame = () => {
    const confirmation = endConfirmation;
    if (!confirmation) return;
    void action(async () => {
      try {
        return await client.end(confirmation.gameId, confirmation.expectedVersion, confirmation.expectedResetEpoch);
      } catch (reason) {
        if (isEndDefinitelyNotApplied(reason)) throw reason;
        try {
          const recovered = await client.state(confirmation.gameId);
          if (recovered.gameId === confirmation.gameId && resetEpochOf(recovered) === confirmation.expectedResetEpoch && recovered.stateVersion === confirmation.expectedVersion + 1 && isConfirmedManualEnd(recovered)) return recovered;
        } catch { /* Report the same safe ambiguity message below. */ }
        throw new Error("The game end could not be confirmed. Use Refresh before trying again.");
      }
    });
  };
  const cancelEndConfirmation = () => {
    restoreEndGameFocus.current = true;
    setEndConfirmation(undefined);
  };
  const confirmImportReview = () => {
    const current = gameRef.current;
    if (!current || !requiresImportReview(current) || busyRef.current) return;
    void action(async () => {
      try {
        return await client.confirmImportedGo(current.gameId, current.stateVersion, resetEpochOf(current));
      } catch (reason) {
        if (isImportReviewDefinitelyNotApplied(reason)) throw reason;
        try {
          const recovered = await client.state(current.gameId);
          if (recovered.gameId === current.gameId && resetEpochOf(recovered) === resetEpochOf(current) && recovered.stateVersion === current.stateVersion + 1 && recovered.kind === "go" && recovered.importReview === "confirmed") return recovered;
        } catch { /* Report the same safe ambiguity message below. */ }
        throw new Error("The imported-position confirmation could not be verified. Use Refresh before continuing.");
      }
    }, gptTurn);
  };
  const importReviewPending = requiresImportReview(game);
  useEffect(() => {
    const render = () => JSON.stringify(gameTextState(game, gamePreset, difficultyPreset, busy, starting, selected, error, endConfirmation, importReviewPending));
    const advance = (_milliseconds: number) => { /* This turn-based DOM game has no animation clock. */ };
    window.render_game_to_text = render;
    window.advanceTime = advance;
    return () => {
      if (window.render_game_to_text === render) Reflect.deleteProperty(window, "render_game_to_text");
      if (window.advanceTime === advance) Reflect.deleteProperty(window, "advanceTime");
    };
  }, [busy, difficultyPreset, endConfirmation, error, game, gamePreset, importReviewPending, selected, starting]);
  const disabled = busy || Boolean(endConfirmation) || importReviewPending || game?.status === "finished" || game?.turn !== game?.playerColor;
  const canInterruptBusyGpt = Boolean(busy && game?.status === "active" && game.turn !== game.playerColor);
  const hostHydrating = bridge.embedded && !game && !error;
  const arenaStyle = hostMaxHeight ? { "--host-max-height": `${hostMaxHeight}px` } as CSSProperties : undefined;
  return <main className={endConfirmation ? "arena end-confirming" : "arena"} style={arenaStyle}>
    <header>
      <h1><span>GPT</span> GAME <em>ARENA</em></h1>
      {!hostHydrating && <form className="new-game-picker" aria-busy={starting} onSubmit={event => { event.preventDefault(); void startGame(); }}>
        <label className="picker-field" htmlFor="game-preset"><span>NEW GAME</span><select id="game-preset" value={gamePreset} disabled={starting || Boolean(endConfirmation)} onChange={event => setGamePreset(event.target.value as GamePreset)}>{gamePresets.map(preset => <option key={preset.value} value={preset.value}>{preset.label}</option>)}</select></label>
        <label className="picker-field" htmlFor="difficulty-preset"><span>DIFFICULTY</span><select id="difficulty-preset" value={difficultyPreset} disabled={starting || Boolean(endConfirmation)} onChange={event => setDifficultyPreset(event.target.value as GameDifficulty)}>{difficultyPresets.map(preset => <option key={preset.value} value={preset.value}>{preset.label}</option>)}</select></label>
        <button className="primary" type="submit" disabled={starting || Boolean(endConfirmation)}>{starting ? "Starting…" : "Start game"}</button>
      </form>}
    </header>
    {hostHydrating && <p className="game-status" role="status">Loading game…</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {game && <section className={`table table-${game.kind}`}>
      <GameChrome game={game} thinking={busy && game.turn !== game.playerColor} unconfirmed={Boolean(error) && !busy && game.turn !== game.playerColor}/>
      <div className={`board-column board-${game.kind}${game.kind === "go" && game.initialPosition ? " imported-position" : ""}`}>
        {game.kind === "go" && game.initialPosition && <section className={`import-review${importReviewPending ? " pending" : " verified"}`} aria-label="Imported Go position review">
          <div><strong>Imported Go position</strong><span>{game.boardSize}×{game.boardSize} · {game.initialPosition.blackStones.length} Black · {game.initialPosition.whiteStones.length} White</span></div>
          <div><span>You: {titleColor(game.playerColor)} · Next: {titleColor(game.turn)} ({game.turn === game.playerColor ? "you" : "GPT"})</span>{importReviewPending ? <button type="button" disabled={busy || Boolean(endConfirmation)} onClick={confirmImportReview}>Looks right — continue</button> : <b>✓ Verified</b>}</div>
          {importReviewPending && <small>Check the stones first. If one is wrong, tell GPT the correction before continuing.</small>}
        </section>}
        {game.kind === "chess" ? <ChessBoard game={game} selected={selected} onSquare={chessSquare} disabled={disabled}/> : game.kind === "go" ? <GoBoard game={game} onMove={humanMove} disabled={disabled}/> : game.kind === "tic-tac-toe" ? <TicTacToeBoard game={game} onMove={humanMove} disabled={disabled}/> : game.kind === "reversi" ? <ReversiBoard game={game} onMove={humanMove} disabled={disabled}/> : <ConnectFourBoard game={game} onMove={humanMove} disabled={disabled}/>}
        {endConfirmation ? <div className="end-confirmation" role="alertdialog" aria-modal="true" aria-labelledby="end-game-title" aria-describedby="end-game-description" onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); cancelEndConfirmation(); return; } if (event.key !== "Tab") return; const focusable = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")]; if (focusable.length === 0) return; const first = focusable[0]; const last = focusable[focusable.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } }}><strong id="end-game-title">End this game?</strong><p id="end-game-description">{endGameDescription}</p><div className="end-confirmation-actions"><button type="button" autoFocus disabled={busy && !canInterruptBusyGpt} onClick={cancelEndConfirmation}>Keep playing</button><button className="danger" type="button" disabled={busy && !canInterruptBusyGpt} onClick={confirmEndGame}>End game</button></div></div> : <div className={`controls controls-${game.kind} controls-${game.status}`}>{game.kind === "go" && <button type="button" disabled={disabled} onClick={() => humanMove("pass")}>⊘ Pass</button>}{game.status === "active" && <button ref={endGameTrigger} className="danger" type="button" disabled={busy && !canInterruptBusyGpt} onClick={openEndConfirmation}>End game</button>}<button className="primary" type="button" disabled={busy} onClick={() => void action(() => client.reset(game.gameId), undefined, false, game.gameId)}>⟳ Reset</button><button type="button" disabled={busy} onClick={() => void action(() => client.state(game.gameId), async (next, version) => { if (!requiresImportReview(next)) await gptTurn(next, version); })}>⟳ Refresh</button></div>}
        {game.kind === "go" && <p className="captures">Captures — Black: {game.captures.black}, White: {game.captures.white}</p>}
        {game.kind === "reversi" && <p className="captures">Disks — Black: {game.score.black}, White: {game.score.white}</p>}
        <p className="game-status" role="status">{gameStatusText(game, importReviewPending)}</p>
      </div>
    </section>}
  </main>;
}

function gameStatusText(game: GameSnapshot, importReviewPending: boolean): string {
  if (game.status === "finished") return game.message;
  if (importReviewPending) return "Review the imported stones before continuing.";
  if (game.kind === "go" && game.initialPosition !== undefined && game.moveHistory.length === 0) return game.message;
  return game.lastMove ? `Last move: ${game.lastMove.notation}` : "Choose a piece to begin.";
}

function gameTextState(game: GameSnapshot | undefined, gamePreset: GamePreset, difficultyPreset: GameDifficulty, busy: boolean, starting: boolean, selected: string | undefined, error: string | undefined, endConfirmation: EndConfirmation | undefined, importReviewPending: boolean) {
  if (!game) return { mode: "loading", draft: { game: gamePreset, difficulty: difficultyPreset }, busy, starting, error, endGame: { available: false, confirmation: null } };
  const coordinateSystem = game.kind === "chess" ? "Chess files a-h run left-to-right; ranks 1-8 run White-to-Black." : game.kind === "go" ? `Go columns ${"ABCDEFGHJKLMNOPQRST".slice(0, game.boardSize)} run left-to-right, I is skipped, and ranks ${game.boardSize}-1 run top-to-bottom.` : game.kind === "tic-tac-toe" ? "Tic-Tac-Toe columns A-C run left-to-right and ranks 3-1 run top-to-bottom." : game.kind === "connect-four" ? "Connect Four columns A-G run left-to-right and ranks 6-1 run top-to-bottom." : "Reversi columns A-H run left-to-right and ranks 8-1 run top-to-bottom.";
  const board = game.kind === "chess"
    ? Array.from({ length: 8 }, (_, row) => game.board.slice(row * 8, row * 8 + 8).map((cell) => cell.piece ? (cell.color === "white" ? cell.piece.toUpperCase() : cell.piece) : ".").join(""))
    : game.board.map((row) => row.map((stone) => stone === "black" ? "B" : stone === "white" ? "W" : ".").join(""));
  return { mode: game.status, draft: { game: gamePreset, difficulty: difficultyPreset }, busy, starting, error, selected, coordinateSystem, importReview: game.kind === "go" && game.initialPosition ? { required: importReviewPending, pending: importReviewPending, authoritativeStatus: game.importReview, source: game.initialPosition.source, blackStones: game.initialPosition.blackStones.length, whiteStones: game.initialPosition.whiteStones.length, initialTurn: game.initialPosition.turn } : null, endGame: { available: game.status === "active", enabled: game.status === "active" && (!busy || game.turn !== game.playerColor), confirmation: endConfirmation ? { ...endConfirmation, prompt: endGamePrompt } : null }, game: { gameId: game.gameId, resetEpoch: resetEpochOf(game), kind: game.kind, difficulty: game.difficulty, playerColor: game.playerColor, turn: game.turn, status: game.status, winner: game.winner, finishReason: game.finishReason, stateVersion: game.stateVersion, message: game.message, lastMove: game.lastMove, legalMoves: game.legalMoves, board, ...(game.kind === "reversi" ? { score: game.score } : {}), ...(game.kind === "tic-tac-toe" || game.kind === "connect-four" ? { winningLine: game.winningLine } : {}) } };
}

function titleColor(color: "white" | "black"): string {
  return color === "white" ? "White" : "Black";
}
