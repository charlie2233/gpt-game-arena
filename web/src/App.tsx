import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { GameBridge } from "./bridge";
import { GameClient, isSnapshot } from "./game-client";
import { clearStandaloneGame, loadStandaloneGame, saveStandaloneGame } from "./game-save";
import { ChessBoard } from "./components/ChessBoard";
import { GoBoard } from "./components/GoBoard";
import { GameChrome } from "./components/GameChrome";
import { ConnectFourBoard, ReversiBoard, TicTacToeBoard } from "./components/SmallBoards";
import { BasketballBoard, PoolBoard } from "./components/SportsBoards";
import { chooseStandaloneMove } from "./move-strategy";
import { isConfirmedReset } from "./reset-validation";
import type { Color, GameDifficulty, GameSnapshot, GoBoardSize } from "./types";

type GamePreset = "chess" | "tic-tac-toe" | "connect-four" | "reversi" | "pool" | "basketball" | `go-${GoBoardSize}`;
const gamePresets: ReadonlyArray<{ value: GamePreset; label: string }> = [
  { value: "chess", label: "Chess" },
  { value: "pool", label: "Mini 8-Ball" },
  { value: "basketball", label: "Court Duel" },
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
const endGameDescription = "The board will be frozen. Reset or start a New Game afterward.";
const endGamePrompt = `End this game? ${endGameDescription}`;
const resetGameDescription = "All current progress will be cleared. Your game settings will stay the same.";
const resetGamePrompt = `Reset this game? ${resetGameDescription}`;

type SnapshotMove = { actor: "player" | "gpt"; color: Color; notation: string; ply: number };
type ResetBarrier = { gameId: string; staleHistory: SnapshotMove[]; legacyCeiling: number };
type PendingGptReceipt = { epoch: number; gameId: string; expectedVersion: number; expectedResetEpoch: number; move: string };
type EndConfirmation = { gameId: string; expectedVersion: number; expectedResetEpoch: number };
type ResetConfirmation = EndConfirmation & { baseline: GameSnapshot };

function historyStartsWith(history: readonly SnapshotMove[], prefix: readonly SnapshotMove[]): boolean {
  return prefix.length <= history.length && prefix.every((move, index) => {
    const candidate = history[index];
    return candidate?.actor === move.actor && candidate.color === move.color && candidate.notation === move.notation && candidate.ply === move.ply;
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

function isConfirmedGptAdvance(previous: GameSnapshot, next: GameSnapshot, expectedMove: string): boolean {
  if (next.gameId !== previous.gameId || resetEpochOf(next) !== resetEpochOf(previous)) return false;
  if (next.stateVersion !== previous.stateVersion + 1 || next.moveHistory.length !== previous.moveHistory.length + 1) return false;
  if (!historyStartsWith(next.moveHistory, previous.moveHistory)) return false;
  const appended = next.moveHistory[previous.moveHistory.length];
  return appended?.actor === "gpt"
    && appended.color === previous.turn
    && appended.notation === expectedMove
    && appended.ply === previous.moveHistory.length + 1
    && next.lastMove?.actor === appended.actor
    && next.lastMove.color === appended.color
    && next.lastMove.notation === appended.notation
    && next.lastMove.ply === appended.ply;
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

function isResetDefinitelyNotApplied(reason: unknown): boolean {
  return reason instanceof Error && /\bRESET_NOT_APPLIED\b|^(?:invalid_input|not_found|stale_version|version_conflict|save_incompatible):/i.test(reason.message);
}

function isImportReviewDefinitelyNotApplied(reason: unknown): boolean {
  return reason instanceof Error && /\bIMPORT_REVIEW_NOT_APPLIED\b|^(?:invalid_input|not_found|stale_version|version_conflict|game_finished|import_review_unavailable):/i.test(reason.message);
}

function isGptMoveDefinitelyNotApplied(reason: unknown): boolean {
  return reason instanceof Error && (
    /^MOVE_NOT_APPLIED(?:$|\s)/.test(reason.message)
    || /^(?:invalid_input|invalid_move|illegal_move|not_found|stale_version|version_conflict|game_finished|validation(?:_error)?):/i.test(reason.message)
  );
}

function isConfirmedManualEnd(snapshot: GameSnapshot): boolean {
  return snapshot.status === "finished" && snapshot.finishReason === "ended";
}

function nonLifecycleGameJson(snapshot: GameSnapshot): string {
  const { status: _status, winner: _winner, finishReason: _finishReason, legalMoves: _legalMoves, stateVersion: _stateVersion, message: _message, ...game } = snapshot;
  return JSON.stringify(game);
}

function isConfirmedManualEndAdvance(previous: GameSnapshot, next: GameSnapshot): boolean {
  return next.gameId === previous.gameId
    && resetEpochOf(next) === resetEpochOf(previous)
    && next.stateVersion === previous.stateVersion + 1
    && isConfirmedManualEnd(next)
    && next.legalMoves.length === 0
    && next.winner === previous.winner
    && nonLifecycleGameJson(next) === nonLifecycleGameJson(previous);
}

function isConfirmedGptRecovery(previous: GameSnapshot, next: GameSnapshot, expectedMove: string): boolean {
  return isConfirmedGptAdvance(previous, next, expectedMove)
    || isConfirmedManualEndAdvance(previous, next)
    || isConfirmedReset(previous, next);
}

export function App({ bridge: suppliedBridge, initialGame }: { bridge?: GameBridge; initialGame?: GameSnapshot } = {}) {
  const [bridge] = useState(() => suppliedBridge ?? new GameBridge());
  const [client] = useState(() => new GameClient(bridge));
  const [recoverySeed] = useState<GameSnapshot | undefined>(() => initialGame === undefined
    ? initialHostState() ?? (bridge.embedded ? undefined : loadStandaloneGame())
    : undefined);
  const initialSnapshot = initialGame ?? recoverySeed;
  const [game, setGame] = useState<GameSnapshot | undefined>(() => initialSnapshot);
  const [selected, setSelected] = useState<string>();
  const [gamePreset, setGamePreset] = useState<GamePreset>(() => presetFor(initialSnapshot));
  const [difficultyPreset, setDifficultyPreset] = useState<GameDifficulty>(() => initialSnapshot?.difficulty ?? "medium");
  const [hostMaxHeight, setHostMaxHeight] = useState<number | undefined>(() => maxHeightFrom(chatGptHost()));
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string>();
  const [endConfirmation, setEndConfirmation] = useState<EndConfirmation>();
  const [resetConfirmation, setResetConfirmation] = useState<ResetConfirmation>();
  const epoch = useRef(0); const gameRef = useRef<GameSnapshot | undefined>(game); const busyRef = useRef(busy); const pendingGptReceipt = useRef<PendingGptReceipt>(); const resetBarrier = useRef<ResetBarrier>(); const resetPending = useRef<string>(); const recoveryStarted = useRef(false); const lifecycleTimer = useRef<number>(); const endGameTrigger = useRef<HTMLButtonElement>(null); const resetGameTrigger = useRef<HTMLButtonElement>(null); const restoreConfirmationFocus = useRef<"end" | "reset">();
  const stop = useCallback(() => { epoch.current += 1; pendingGptReceipt.current = undefined; }, []);
  const commitBusy = useCallback((next: boolean) => { busyRef.current = next; setBusy(next); }, []);
  const apply = useCallback((next: GameSnapshot, version: number) => {
    if (version !== epoch.current) return;
    const prior = gameRef.current;
    if (!prior || prior.gameId !== next.gameId || resetEpochOf(next) > resetEpochOf(prior)) resetBarrier.current = undefined;
    else if (next.resetEpoch === undefined && prior.resetEpoch === undefined && next.stateVersion === 0 && prior.stateVersion > 0) {
      resetBarrier.current = { gameId: next.gameId, staleHistory: [...prior.moveHistory], legacyCeiling: prior.stateVersion + 1 };
    }
    setEndConfirmation(undefined);
    setResetConfirmation(undefined);
    gameRef.current = next;
    setGame(next);
  }, []);
  const action = useCallback(async (run: () => Promise<GameSnapshot>, after?: (next: GameSnapshot, version: number) => Promise<void>, startsGame = false, resetGameId?: string) => {
    stop(); const version = epoch.current; resetPending.current = resetGameId; commitBusy(true); setStarting(startsGame); setError(undefined); setSelected(undefined); setEndConfirmation(undefined); setResetConfirmation(undefined);
    try { const next = await run(); if (version !== epoch.current) return; apply(next, version); if (version !== epoch.current) return; await after?.(next, version); } catch (reason) { if (version === epoch.current) setError(requestErrorMessage(reason)); } finally { if (version === epoch.current) { if (resetPending.current === resetGameId) resetPending.current = undefined; commitBusy(false); setStarting(false); } }
  }, [apply, commitBusy, stop]);
  const gptTurn = useCallback(async (next: GameSnapshot, version: number) => {
    if (requiresImportReview(next)) return;
    let current = next;
    for (let turns = 0; turns < 128 && current.status === "active" && current.turn !== current.playerColor; turns += 1) {
      if (version !== epoch.current) return;
      if (requiresImportReview(current)) return;
      const move = chooseStandaloneMove(current);
      if (!move) return;
      let reply: GameSnapshot | undefined;
      const pending: PendingGptReceipt | undefined = bridge.embedded ? { epoch: version, gameId: current.gameId, expectedVersion: current.stateVersion, expectedResetEpoch: resetEpochOf(current), move } : undefined;
      if (pending) pendingGptReceipt.current = pending;
      let recoveredFromState = false;
      try {
        try {
          const directReply = await client.play(current.gameId, "gpt", move, current.stateVersion, resetEpochOf(current));
          if (!bridge.embedded || isConfirmedGptAdvance(current, directReply, move)) reply = directReply;
        } catch (reason) {
          if (isGptMoveDefinitelyNotApplied(reason)) throw reason;
        }
        if (!reply) {
          recoveredFromState = true;
          try { reply = await client.state(current.gameId); } catch { throw new Error("GPT move was not confirmed. Use Refresh to continue."); }
        }
      } finally {
        if (pendingGptReceipt.current === pending) pendingGptReceipt.current = undefined;
      }
      if (version !== epoch.current) return;
      if (!reply) throw new Error("GPT move was not confirmed. Use Refresh to continue.");
      if (bridge.embedded && !(recoveredFromState ? isConfirmedGptRecovery(current, reply, move) : isConfirmedGptAdvance(current, reply, move))) throw new Error("GPT move was not confirmed. Use Refresh to continue.");
      if (!bridge.embedded && (reply.gameId !== current.gameId || resetEpochOf(reply) !== resetEpochOf(current) || reply.stateVersion <= current.stateVersion)) throw new Error("The game service returned a non-advancing GPT state.");
      apply(reply, version);
      current = reply;
    }
    if (current.status === "active" && current.turn !== current.playerColor) throw new Error("GPT turn limit reached.");
  }, [apply, bridge.embedded, client]);
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
      const pending = pendingGptReceipt.current;
      if (pending?.epoch === epoch.current
        && pending.gameId === current.gameId
        && pending.expectedVersion === current.stateVersion
        && pending.expectedResetEpoch === resetEpochOf(current)
        && (current.legalMoves as readonly string[]).includes(pending.move)) {
        return;
      }
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
        if (!isConfirmedReset(current, next)) return;
        resetBarrier.current = undefined;
        resetPending.current = undefined;
      }
      gameRef.current = next;
      setGame(next);
      setSelected(undefined);
      setError(undefined);
      if (!busyRef.current && next.status === "active" && next.turn !== next.playerColor && !requiresImportReview(next)) {
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
    if (!recoverySeed || recoveryStarted.current) return;
    recoveryStarted.current = true;
    const version = epoch.current;
    commitBusy(true);
    setError(undefined);
    void (async () => {
      try {
        let reconciled: GameSnapshot | undefined;
        try {
          const authoritative = await client.state(recoverySeed.gameId);
          if (version !== epoch.current) return;
          const current = gameRef.current;
          if (!current || current.gameId !== recoverySeed.gameId) return;
          reconciled = current;
          if (authoritative.gameId !== recoverySeed.gameId) throw new Error("The game service returned the wrong saved game.");
          if (compareSnapshotPosition(authoritative, current) >= 0) {
            apply(authoritative, version);
            reconciled = authoritative;
          } else if (compareSnapshotPosition(current, recoverySeed) === 0) {
            setError("The saved board is newer than the server session. Use Refresh to try again.");
            return;
          }
        } catch (reason) {
          if (version !== epoch.current) return;
          if (isNotFoundError(reason)) {
            if (!bridge.embedded) clearStandaloneGame();
            setError(expiredSessionMessage);
            return;
          }
          const current = gameRef.current;
          if (!current || current.gameId !== recoverySeed.gameId || compareSnapshotPosition(current, recoverySeed) <= 0) {
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
  }, [apply, bridge.embedded, client, commitBusy, gptTurn, recoverySeed]);
  useEffect(() => { if (!game && !bridge.embedded) void action(() => client.create({ game: "chess", playerColor: "white", difficulty: "medium" }), undefined, true); }, [action, bridge.embedded, client, game]);
  useEffect(() => {
    if (!game) return;
    if (!bridge.embedded) {
      saveStandaloneGame(game);
      return;
    }
    const host = chatGptHost();
    if (!host?.setWidgetState) return;
    void Promise.resolve(host.setWidgetState({ game })).catch(() => undefined);
  }, [bridge.embedded, game]);
  const currentPreset = presetFor(game);
  useEffect(() => { if (game) { setGamePreset(currentPreset); setDifficultyPreset(game.difficulty); } }, [currentPreset, game?.gameId]);
  useEffect(() => {
    setEndConfirmation(current => current && game && current.gameId === game.gameId && current.expectedVersion === game.stateVersion && current.expectedResetEpoch === resetEpochOf(game) ? current : undefined);
    setResetConfirmation(current => current && game && current.gameId === game.gameId && current.expectedVersion === game.stateVersion && current.expectedResetEpoch === resetEpochOf(game) ? current : undefined);
  }, [game?.gameId, game?.resetEpoch, game?.stateVersion]);
  useEffect(() => {
    const restore = restoreConfirmationFocus.current;
    if (!endConfirmation && !resetConfirmation && restore) {
      restoreConfirmationFocus.current = undefined;
      (restore === "end" ? endGameTrigger.current : resetGameTrigger.current)?.focus();
    }
  }, [endConfirmation, resetConfirmation]);
  const humanMove = (move: string) => game && action(() => client.play(game.gameId, "player", move, game.stateVersion, resetEpochOf(game)), gptTurn);
  const chessSquare = (square: string) => { if (!game || game.kind !== "chess") return; if (!selected) { setSelected(square); return; } const legal = game.legalMoves.filter(move => move.startsWith(selected) && move.slice(2, 4) === square).sort(); const move = legal.find(m => m.endsWith("q")) ?? legal[0]; if (move) humanMove(move); else setSelected(undefined); };
  const startGame = () => {
    if (gamePreset === "chess") return action(() => client.create({ game: "chess", playerColor: "white", difficulty: difficultyPreset }), undefined, true);
    if (gamePreset === "tic-tac-toe" || gamePreset === "connect-four" || gamePreset === "reversi" || gamePreset === "pool" || gamePreset === "basketball") return action(() => client.create({ game: gamePreset, playerColor: "black", difficulty: difficultyPreset }), undefined, true);
    const boardSize = Number(gamePreset.slice(3)) as GoBoardSize;
    return action(() => client.create({ game: "go", playerColor: "black", difficulty: difficultyPreset, ...(boardSize === 9 ? {} : { boardSize }) }), undefined, true);
  };
  const openEndConfirmation = () => {
    const current = gameRef.current;
    if (!current || current.status !== "active" || (busyRef.current && current.turn === current.playerColor)) return;
    setResetConfirmation(undefined);
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
    restoreConfirmationFocus.current = "end";
    setEndConfirmation(undefined);
  };
  const openResetConfirmation = () => {
    const current = gameRef.current;
    if (!current || (busyRef.current && current.turn === current.playerColor)) return;
    setEndConfirmation(undefined);
    setResetConfirmation({ gameId: current.gameId, expectedVersion: current.stateVersion, expectedResetEpoch: resetEpochOf(current), baseline: current });
  };
  const confirmResetGame = () => {
    const confirmation = resetConfirmation;
    if (!confirmation) return;
    void action(async () => {
      try {
        const reset = await client.reset(confirmation.gameId, confirmation.expectedVersion, confirmation.expectedResetEpoch);
        if (isConfirmedReset(confirmation.baseline, reset)) return reset;
        throw new Error("RESET_CONFIRMATION_UNKNOWN: The reset receipt did not match the requested game state.");
      } catch (reason) {
        if (isResetDefinitelyNotApplied(reason)) throw reason;
        try {
          const recovered = await client.state(confirmation.gameId);
          if (isConfirmedReset(confirmation.baseline, recovered)) return recovered;
        } catch { /* Report the same safe ambiguity message below. */ }
        throw new Error("The game reset could not be confirmed. Use Refresh before trying again.");
      }
    }, async (next, version) => {
      if (!requiresImportReview(next) && next.status === "active" && next.turn !== next.playerColor) await gptTurn(next, version);
    }, false, confirmation.gameId);
  };
  const cancelResetConfirmation = () => {
    restoreConfirmationFocus.current = "reset";
    setResetConfirmation(undefined);
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
    const render = () => JSON.stringify(gameTextState(game, gamePreset, difficultyPreset, busy, starting, selected, error, endConfirmation, resetConfirmation, importReviewPending));
    const advance = (_milliseconds: number) => { /* This turn-based DOM game has no animation clock. */ };
    window.render_game_to_text = render;
    window.advanceTime = advance;
    return () => {
      if (window.render_game_to_text === render) Reflect.deleteProperty(window, "render_game_to_text");
      if (window.advanceTime === advance) Reflect.deleteProperty(window, "advanceTime");
    };
  }, [busy, difficultyPreset, endConfirmation, error, game, gamePreset, importReviewPending, resetConfirmation, selected, starting]);
  const confirmationOpen = Boolean(endConfirmation || resetConfirmation);
  const disabled = busy || confirmationOpen || importReviewPending || game?.status === "finished" || game?.turn !== game?.playerColor;
  const canInterruptBusyGpt = Boolean(busy && game?.status === "active" && game.turn !== game.playerColor);
  const confirmationTitle = endConfirmation ? "End this game?" : "Reset this game?";
  const confirmationDescription = endConfirmation ? endGameDescription : resetGameDescription;
  const confirmationLabel = endConfirmation ? "End game" : "Reset game";
  const cancelConfirmation = endConfirmation ? cancelEndConfirmation : cancelResetConfirmation;
  const confirmAction = endConfirmation ? confirmEndGame : confirmResetGame;
  const hostHydrating = bridge.embedded && !game && !error;
  const arenaStyle = hostMaxHeight ? { "--host-max-height": `${hostMaxHeight}px` } as CSSProperties : undefined;
  return <main className={confirmationOpen ? "arena action-confirming" : "arena"} style={arenaStyle}>
    <header>
      <h1 aria-label="Turnplay Arena"><span>TURN</span>PLAY <em>ARENA</em></h1>
      {!hostHydrating && <form className="new-game-picker" aria-busy={starting} onSubmit={event => { event.preventDefault(); void startGame(); }}>
        <label className="picker-field" htmlFor="game-preset"><span>NEW GAME</span><select id="game-preset" value={gamePreset} disabled={starting || confirmationOpen} onChange={event => setGamePreset(event.target.value as GamePreset)}>{gamePresets.map(preset => <option key={preset.value} value={preset.value}>{preset.label}</option>)}</select></label>
        <label className="picker-field" htmlFor="difficulty-preset"><span>DIFFICULTY</span><select id="difficulty-preset" value={difficultyPreset} disabled={starting || confirmationOpen} onChange={event => setDifficultyPreset(event.target.value as GameDifficulty)}>{difficultyPresets.map(preset => <option key={preset.value} value={preset.value}>{preset.label}</option>)}</select></label>
        <button className="primary" type="submit" disabled={starting || confirmationOpen}>{starting ? "Starting…" : "Start game"}</button>
      </form>}
    </header>
    {hostHydrating && <p className="game-status" role="status">Loading game…</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {game && <section className={`table table-${game.kind}`}>
      <GameChrome game={game} thinking={busy && game.turn !== game.playerColor} unconfirmed={Boolean(error) && !busy && game.turn !== game.playerColor}/>
      <div className={`board-column board-${game.kind}${game.kind === "go" && game.initialPosition ? " imported-position" : ""}`}>
        {game.kind === "go" && game.initialPosition && <section className={`import-review${importReviewPending ? " pending" : " verified"}`} aria-label="Imported Go position review">
          <div><strong>Imported Go position</strong><span>{game.boardSize}×{game.boardSize} · {game.initialPosition.blackStones.length} Black · {game.initialPosition.whiteStones.length} White</span></div>
          <div><span>You: {titleColor(game.playerColor)} · Next: {titleColor(game.turn)} ({game.turn === game.playerColor ? "you" : "GPT"})</span>{importReviewPending ? <button type="button" disabled={busy || confirmationOpen} onClick={confirmImportReview}>Looks right — continue</button> : <b>✓ Verified</b>}</div>
          {importReviewPending && <small>Check the stones first. If one is wrong, tell GPT the correction before continuing.</small>}
        </section>}
        {game.kind === "chess" ? <ChessBoard game={game} selected={selected} onSquare={chessSquare} disabled={disabled}/> : game.kind === "go" ? <GoBoard game={game} onMove={humanMove} disabled={disabled}/> : game.kind === "tic-tac-toe" ? <TicTacToeBoard game={game} onMove={humanMove} disabled={disabled}/> : game.kind === "reversi" ? <ReversiBoard game={game} onMove={humanMove} disabled={disabled}/> : game.kind === "connect-four" ? <ConnectFourBoard game={game} onMove={humanMove} disabled={disabled}/> : game.kind === "pool" ? <PoolBoard game={game} onMove={humanMove} disabled={disabled}/> : <BasketballBoard game={game} onMove={humanMove} disabled={disabled}/>}
        {confirmationOpen ? <div className="end-confirmation" role="alertdialog" aria-modal="true" aria-labelledby="game-action-title" aria-describedby="game-action-description" onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); cancelConfirmation(); return; } if (event.key !== "Tab") return; const focusable = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")]; if (focusable.length === 0) return; const first = focusable[0]; const last = focusable[focusable.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } }}><strong id="game-action-title">{confirmationTitle}</strong><p id="game-action-description">{confirmationDescription}</p><div className="end-confirmation-actions"><button type="button" autoFocus disabled={busy && !canInterruptBusyGpt} onClick={cancelConfirmation}>Keep playing</button><button className="danger" type="button" disabled={busy && !canInterruptBusyGpt} onClick={confirmAction}>{confirmationLabel}</button></div></div> : <div className={`controls controls-${game.kind} controls-${game.status}`}>{game.kind === "go" && <button type="button" disabled={disabled} onClick={() => humanMove("pass")}>⊘ Pass</button>}{game.status === "active" && <button ref={endGameTrigger} className="danger" type="button" disabled={busy && !canInterruptBusyGpt} onClick={openEndConfirmation}>End game</button>}<button ref={resetGameTrigger} className="primary" type="button" disabled={busy && !canInterruptBusyGpt} onClick={openResetConfirmation}>⟳ Reset</button><button type="button" disabled={busy} onClick={() => void action(() => client.state(game.gameId), async (next, version) => { if (!requiresImportReview(next)) await gptTurn(next, version); })}>⟳ Refresh</button></div>}
        {game.kind === "go" && <p className="captures">Captures — Black: {game.captures.black}, White: {game.captures.white}</p>}
        {game.kind === "reversi" && <p className="captures">Disks — Black: {game.score.black}, White: {game.score.white}</p>}
        {game.kind === "pool" && <p className="captures">Black shoots solids · White shoots stripes · Clear your group, then pocket the 8</p>}
        {game.kind === "basketball" && <p className="captures">Score — You: {game.score[game.playerColor]}, GPT: {game.score[game.playerColor === "black" ? "white" : "black"]}</p>}
        <p className="game-status" role="status">{gameStatusText(game, importReviewPending)}</p>
      </div>
    </section>}
  </main>;
}

function gameStatusText(game: GameSnapshot, importReviewPending: boolean): string {
  if (game.status === "finished") return game.message;
  if (importReviewPending) return "Review the imported stones before continuing.";
  if (game.kind === "go" && game.initialPosition !== undefined && game.moveHistory.length === 0) return game.message;
  return game.lastMove ? `Last move: ${game.lastMove.notation}` : game.kind === "pool" ? "Choose a ball or a safety shot." : game.kind === "basketball" ? "Choose a shot." : "Choose a piece to begin.";
}

function gameTextState(game: GameSnapshot | undefined, gamePreset: GamePreset, difficultyPreset: GameDifficulty, busy: boolean, starting: boolean, selected: string | undefined, error: string | undefined, endConfirmation: EndConfirmation | undefined, resetConfirmation: ResetConfirmation | undefined, importReviewPending: boolean) {
  if (!game) return { mode: "loading", draft: { game: gamePreset, difficulty: difficultyPreset }, busy, starting, error, endGame: { available: false, confirmation: null }, resetGame: { available: false, confirmation: null } };
  const coordinateSystem = game.kind === "chess" ? "Chess files a-h run left-to-right; ranks 1-8 run White-to-Black." : game.kind === "go" ? `Go columns ${"ABCDEFGHJKLMNOPQRST".slice(0, game.boardSize)} run left-to-right, I is skipped, and ranks ${game.boardSize}-1 run top-to-bottom.` : game.kind === "tic-tac-toe" ? "Tic-Tac-Toe columns A-C run left-to-right and ranks 3-1 run top-to-bottom." : game.kind === "connect-four" ? "Connect Four columns A-G run left-to-right and ranks 6-1 run top-to-bottom." : game.kind === "reversi" ? "Reversi columns A-H run left-to-right and ranks 8-1 run top-to-bottom." : game.kind === "pool" ? "Pool uses integer x=0-100 left-to-right and y=0-50 top-to-bottom; pockets are TL, TM, TR, BL, BM, and BR." : "Court Duel has three exact shot choices: drive, pull-up, and three.";
  const board = game.kind === "chess"
    ? Array.from({ length: 8 }, (_, row) => game.board.slice(row * 8, row * 8 + 8).map((cell) => cell.piece ? (cell.color === "white" ? cell.piece.toUpperCase() : cell.piece) : ".").join(""))
    : game.kind === "pool"
      ? { cueBall: game.cueBall, balls: game.balls }
      : game.kind === "basketball"
        ? { score: game.score, energy: game.energy, attempts: game.attempts, phase: game.phase, round: game.round }
        : game.board.map((row) => row.map((stone) => stone === "black" ? "B" : stone === "white" ? "W" : ".").join(""));
  return { mode: game.status, draft: { game: gamePreset, difficulty: difficultyPreset }, busy, starting, error, selected, coordinateSystem, importReview: game.kind === "go" && game.initialPosition ? { required: importReviewPending, pending: importReviewPending, authoritativeStatus: game.importReview, source: game.initialPosition.source, blackStones: game.initialPosition.blackStones.length, whiteStones: game.initialPosition.whiteStones.length, initialTurn: game.initialPosition.turn } : null, endGame: { available: game.status === "active", enabled: game.status === "active" && (!busy || game.turn !== game.playerColor), confirmation: endConfirmation ? { ...endConfirmation, prompt: endGamePrompt } : null }, resetGame: { available: true, enabled: !busy || game.status === "active" && game.turn !== game.playerColor, confirmation: resetConfirmation ? { gameId: resetConfirmation.gameId, expectedVersion: resetConfirmation.expectedVersion, expectedResetEpoch: resetConfirmation.expectedResetEpoch, prompt: resetGamePrompt } : null }, game: { gameId: game.gameId, resetEpoch: resetEpochOf(game), kind: game.kind, difficulty: game.difficulty, playerColor: game.playerColor, turn: game.turn, status: game.status, winner: game.winner, finishReason: game.finishReason, stateVersion: game.stateVersion, message: game.message, lastMove: game.lastMove, legalMoves: game.legalMoves, board, ...(game.kind === "reversi" ? { score: game.score } : {}), ...(game.kind === "pool" ? { cueBall: game.cueBall, balls: game.balls } : {}), ...(game.kind === "basketball" ? { score: game.score, energy: game.energy, streak: game.streak, attempts: game.attempts, phase: game.phase, round: game.round, shotOptions: game.shotOptions, shotResults: game.shotResults } : {}), ...(game.kind === "tic-tac-toe" || game.kind === "connect-four" ? { winningLine: game.winningLine } : {}) } };
}

function titleColor(color: "white" | "black"): string {
  return color === "white" ? "White" : "Black";
}
