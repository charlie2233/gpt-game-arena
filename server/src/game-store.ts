import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

import { z } from "zod";

import { GameRuleError } from "./domain/errors.js";
import {
  descriptorFromSession,
  replayGameSession,
  type GameSession,
} from "./game-session.js";

export type { GameSession } from "./game-session.js";

export interface GameStoreOptions {
  maxSessions?: number;
  ttlMs?: number;
  legacyBackupTtlMs?: number;
  readinessCacheMs?: number;
  now?: () => number;
  /** Enables single-process JSON persistence when set. */
  persistencePath?: string;
}

interface StoredSession {
  session: GameSession;
  lastAccessedAt: number;
}

export const DEFAULT_GAME_STORE_MAX_SESSIONS = 1_000;
export const MAX_GAME_STORE_SESSIONS = 10_000;
export const DEFAULT_GAME_STORE_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
export const DEFAULT_LEGACY_BACKUP_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
export const DEFAULT_READINESS_CACHE_MS = 15_000;
export const STALE_TEMP_FILE_TTL_MS = 24 * 60 * 60 * 1_000;
export const MAX_STALE_TEMP_FILES_TO_CLEAN = 32;
const maxPersistedEvents = 10_000;

class PersistenceCommitUnknownError extends Error {}

const persistedMoveSchema = z.object({
  type: z.literal("move"),
  actor: z.enum(["player", "gpt"]),
  move: z.string().min(1).max(32),
}).strict();

const persistedEndSchema = z.object({
  type: z.literal("end"),
}).strict();

const persistedEventSchema = z.discriminatedUnion("type", [persistedMoveSchema, persistedEndSchema]);
const persistedEventsSchema = z.array(persistedEventSchema).max(maxPersistedEvents).superRefine((events, context) => {
  const firstEnd = events.findIndex(event => event.type === "end");
  if (firstEnd >= 0 && (firstEnd !== events.length - 1 || events.some((event, index) => index > firstEnd && event.type === "end"))) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "The end event must occur once and be terminal." });
  }
});

const persistedSessionBaseSchema = z.object({
  gameId: z.string().min(1).max(256),
  playerColor: z.enum(["white", "black"]),
  difficulty: z.enum(["easy", "medium", "hard"]),
  resetEpoch: z.number().int().nonnegative().optional(),
  events: persistedEventsSchema,
  lastAccessedAt: z.number().int().nonnegative(),
});

const persistedGoPositionSchema = z.object({
  source: z.literal("imported"),
  blackStones: z.array(z.string().regex(/^[A-HJ-T](?:[1-9]|1[0-9])$/)).max(361),
  whiteStones: z.array(z.string().regex(/^[A-HJ-T](?:[1-9]|1[0-9])$/)).max(361),
  turn: z.enum(["black", "white"]),
  captures: z.object({
    black: z.number().int().nonnegative().max(maxPersistedEvents),
    white: z.number().int().nonnegative().max(maxPersistedEvents),
  }).strict(),
}).strict();

const persistedSessionV1Schema = z.discriminatedUnion("kind", [
  persistedSessionBaseSchema.extend({ kind: z.literal("chess") }).strict(),
  persistedSessionBaseSchema.extend({
    kind: z.literal("go"),
    boardSize: z.union([z.literal(9), z.literal(13), z.literal(19)]),
    initialPosition: persistedGoPositionSchema.optional(),
    importReview: z.enum(["pending", "confirmed"]).optional(),
  }).strict(),
  persistedSessionBaseSchema.extend({ kind: z.literal("tic-tac-toe") }).strict(),
  persistedSessionBaseSchema.extend({ kind: z.literal("connect-four") }).strict(),
  persistedSessionBaseSchema.extend({ kind: z.literal("reversi") }).strict(),
  persistedSessionBaseSchema.extend({ kind: z.literal("pool") }).strict(),
  persistedSessionBaseSchema.extend({
    kind: z.literal("basketball"),
    basketballOutcomeSeed: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  }).strict(),
]);

const persistedReadySessionV2Schema = z.discriminatedUnion("kind", [
  persistedSessionBaseSchema.extend({ kind: z.literal("chess") }).strict(),
  persistedSessionBaseSchema.extend({
    kind: z.literal("go"),
    boardSize: z.union([z.literal(9), z.literal(13), z.literal(19)]),
    initialPosition: persistedGoPositionSchema.optional(),
    importReview: z.enum(["pending", "confirmed"]).optional(),
  }).strict(),
  persistedSessionBaseSchema.extend({ kind: z.literal("tic-tac-toe") }).strict(),
  persistedSessionBaseSchema.extend({ kind: z.literal("connect-four") }).strict(),
  persistedSessionBaseSchema.extend({ kind: z.literal("reversi") }).strict(),
  persistedSessionBaseSchema.extend({ kind: z.literal("pool") }).strict(),
  persistedSessionBaseSchema.extend({
    kind: z.literal("basketball"),
    basketballOutcomeSeed: z.string().regex(/^[0-9a-f]{64}$/),
  }).strict(),
]);

const persistedUnavailableSessionV2Schema = persistedSessionBaseSchema.extend({
  kind: z.literal("basketball"),
  unavailableReason: z.literal("missing-basketball-outcome-seed"),
  events: persistedEventsSchema.refine(events => events.some(event => event.type === "move"), "An unavailable legacy save must retain at least one move."),
}).strict();

const persistedSessionV2Schema = z.union([
  persistedReadySessionV2Schema,
  persistedUnavailableSessionV2Schema,
]);

const persistedStoreV1Schema = z.object({
  formatVersion: z.literal(1),
  sessions: z.array(persistedSessionV1Schema).max(MAX_GAME_STORE_SESSIONS),
}).strict();

const persistedStoreV2Schema = z.object({
  formatVersion: z.literal(2),
  sessions: z.array(persistedSessionV2Schema).max(MAX_GAME_STORE_SESSIONS),
}).strict();

const persistedStoreSchema = z.discriminatedUnion("formatVersion", [persistedStoreV1Schema, persistedStoreV2Schema]);

type PersistedStore = z.infer<typeof persistedStoreV2Schema>;
type PersistedSession = z.infer<typeof persistedReadySessionV2Schema>;
type PersistedUnavailableSession = z.infer<typeof persistedUnavailableSessionV2Schema>;

function persistedSessionFromStored({ session, lastAccessedAt }: StoredSession): PersistedSession {
  const snapshot = session.snapshot();
  const descriptor = descriptorFromSession(session);
  const events: z.infer<typeof persistedEventSchema>[] = snapshot.moveHistory.map(({ actor, notation }) => ({
    type: "move",
    actor,
    move: notation,
  }));
  if (snapshot.finishReason === "ended") {
    events.push({ type: "end" });
  }
  const common = {
    gameId: snapshot.gameId,
    playerColor: snapshot.playerColor,
    difficulty: snapshot.difficulty,
    resetEpoch: snapshot.resetEpoch ?? 0,
    events,
    lastAccessedAt,
  };

  switch (snapshot.kind) {
    case "chess":
      return { ...common, kind: "chess" };
    case "go":
      return {
        ...common,
        kind: "go",
        boardSize: snapshot.boardSize,
        ...(snapshot.initialPosition === undefined ? {} : { initialPosition: snapshot.initialPosition }),
        ...(snapshot.importReview === undefined ? {} : { importReview: snapshot.importReview }),
      };
    case "tic-tac-toe":
      return { ...common, kind: "tic-tac-toe" };
    case "connect-four":
      return { ...common, kind: "connect-four" };
    case "reversi":
      return { ...common, kind: "reversi" };
    case "pool":
      return { ...common, kind: "pool" };
    case "basketball":
      if (descriptor.basketballOutcomeSeed === undefined) {
        throw new Error("Court Duel session is missing its server-private outcome seed.");
      }
      return {
        ...common,
        kind: "basketball",
        basketballOutcomeSeed: descriptor.basketballOutcomeSeed,
      };
    default:
      return unhandledPersistedKind(snapshot);
  }
}

function unhandledPersistedKind(value: never): never {
  throw new Error(`Unsupported persisted game kind: ${String(value)}`);
}

export class GameStore {
  private readonly sessions = new Map<string, StoredSession>();
  private readonly unavailableSessions = new Map<string, PersistedUnavailableSession>();
  private readonly maxSessions: number;
  private readonly ttlMs: number;
  private readonly legacyBackupTtlMs: number;
  private readonly readinessCacheMs: number;
  private readonly now: () => number;
  private readonly persistencePath: string | undefined;
  private readinessCache: { checkedAt: number; ready: boolean } | undefined;
  private readinessProbe: Promise<boolean> | undefined;

  constructor(options: GameStoreOptions = {}) {
    this.maxSessions = options.maxSessions ?? DEFAULT_GAME_STORE_MAX_SESSIONS;
    this.ttlMs = options.ttlMs ?? DEFAULT_GAME_STORE_TTL_MS;
    this.legacyBackupTtlMs = options.legacyBackupTtlMs ?? DEFAULT_LEGACY_BACKUP_TTL_MS;
    this.readinessCacheMs = options.readinessCacheMs ?? DEFAULT_READINESS_CACHE_MS;
    this.now = options.now ?? Date.now;
    this.persistencePath = options.persistencePath;
    this.validateOptions();
    this.loadPersistedSessions();
    this.assertPersistenceWritable();
    this.rememberReadiness(true);
    this.cleanupStaleTemporaryFiles();
    this.pruneExpiredLegacyBackup();
  }

  put(session: GameSession): void {
    this.mutateAndPersist(() => {
      this.pruneExpired();
      const gameId = session.snapshot().gameId;
      if (this.unavailableSessions.has(gameId)) {
        throw new GameRuleError("save_incompatible", "A preserved incompatible save already uses this game ID.");
      }
      if (!this.sessions.has(gameId) && this.storedSessionCount() >= this.maxSessions) {
        throw new GameRuleError("store_full", "The game save limit has been reached.");
      }
      this.store(gameId, session);
    });
  }

  get(gameId: string): GameSession {
    const now = this.now();
    const stored = this.sessions.get(gameId);
    if (stored && now - stored.lastAccessedAt < this.ttlMs) {
      return stored.session;
    }
    const unavailable = this.unavailableSessions.get(gameId);
    if (unavailable && now - unavailable.lastAccessedAt < this.ttlMs) {
      throw new GameRuleError("save_incompatible", "This legacy Court Duel save is missing its private outcome seed.");
    }
    throw new GameRuleError("not_found", `Game ${gameId} was not found.`);
  }

  replace(session: GameSession): void {
    const gameId = session.snapshot().gameId;
    this.mutateAndPersist(() => {
      this.pruneExpired();
      if (this.unavailableSessions.has(gameId)) {
        throw new GameRuleError("save_incompatible", "This legacy Court Duel save is missing its private outcome seed.");
      }
      if (!this.sessions.has(gameId)) {
        throw new GameRuleError("not_found", `Game ${gameId} was not found.`);
      }
      this.store(gameId, session);
    });
  }

  checkReadiness(): Promise<boolean> {
    const now = this.now();
    const cached = this.readinessCache;
    if (cached !== undefined) {
      const elapsed = now - cached.checkedAt;
      if (elapsed >= 0 && elapsed < this.readinessCacheMs) return Promise.resolve(cached.ready);
    }
    if (this.readinessProbe !== undefined) return this.readinessProbe;

    const probe = Promise.resolve().then(() => {
      try {
        this.assertPersistenceWritable();
        this.rememberReadiness(true);
        return true;
      } catch {
        this.rememberReadiness(false);
        return false;
      }
    });
    this.readinessProbe = probe;
    void probe.then(() => {
      if (this.readinessProbe === probe) this.readinessProbe = undefined;
    });
    return probe;
  }

  sweepExpired(): number {
    const previous = new Map(this.sessions);
    const previousUnavailable = new Map(this.unavailableSessions);
    const previousCount = this.storedSessionCount();
    const removed = this.pruneExpired();
    if (removed > 0) {
      try {
        this.persist();
      } catch (error) {
        if (!(error instanceof PersistenceCommitUnknownError)) {
          this.sessions.clear();
          for (const [gameId, stored] of previous) this.sessions.set(gameId, stored);
          this.unavailableSessions.clear();
          for (const [gameId, stored] of previousUnavailable) this.unavailableSessions.set(gameId, stored);
        }
        throw error;
      }
    }
    this.pruneExpiredLegacyBackup();
    this.cleanupStaleTemporaryFiles();
    return previousCount - this.storedSessionCount();
  }

  private store(gameId: string, session: GameSession): void {
    this.sessions.delete(gameId);
    this.sessions.set(gameId, { session, lastAccessedAt: this.now() });
  }

  private storeUnavailable(record: PersistedUnavailableSession): void {
    this.unavailableSessions.delete(record.gameId);
    this.unavailableSessions.set(record.gameId, record);
  }

  private storedSessionCount(): number {
    return this.sessions.size + this.unavailableSessions.size;
  }

  private pruneExpired(): number {
    let removed = 0;
    const now = this.now();
    for (const [gameId, stored] of this.sessions) {
      if (now - stored.lastAccessedAt >= this.ttlMs) {
        this.sessions.delete(gameId);
        removed += 1;
      }
    }
    for (const [gameId, stored] of this.unavailableSessions) {
      if (now - stored.lastAccessedAt >= this.ttlMs) {
        this.unavailableSessions.delete(gameId);
        removed += 1;
      }
    }
    return removed;
  }

  private validateOptions(): void {
    if (!Number.isInteger(this.maxSessions) || this.maxSessions < 1 || this.maxSessions > MAX_GAME_STORE_SESSIONS) {
      throw new RangeError(`maxSessions must be an integer between 1 and ${MAX_GAME_STORE_SESSIONS}.`);
    }
    if (!Number.isFinite(this.ttlMs) || this.ttlMs <= 0) {
      throw new RangeError("ttlMs must be a positive finite number.");
    }
    if (!Number.isFinite(this.legacyBackupTtlMs) || this.legacyBackupTtlMs <= 0) {
      throw new RangeError("legacyBackupTtlMs must be a positive finite number.");
    }
    if (!Number.isFinite(this.readinessCacheMs) || this.readinessCacheMs <= 0) {
      throw new RangeError("readinessCacheMs must be a positive finite number.");
    }
    if (this.persistencePath !== undefined && this.persistencePath.length === 0) {
      throw new RangeError("persistencePath must not be empty.");
    }
  }

  private mutateAndPersist(mutation: () => void): void {
    const previous = new Map(this.sessions);
    const previousUnavailable = new Map(this.unavailableSessions);
    try {
      mutation();
      this.persist();
    } catch (error) {
      if (!(error instanceof PersistenceCommitUnknownError)) {
        this.sessions.clear();
        for (const [gameId, stored] of previous) this.sessions.set(gameId, stored);
        this.unavailableSessions.clear();
        for (const [gameId, stored] of previousUnavailable) this.unavailableSessions.set(gameId, stored);
      }
      throw error;
    }
  }

  private loadPersistedSessions(): void {
    if (this.persistencePath === undefined || !existsSync(this.persistencePath)) return;

    try {
      const persistedSource = readFileSync(this.persistencePath, "utf8");
      const document = persistedStoreSchema.parse(JSON.parse(persistedSource));
      const gameIds = new Set<string>();
      const now = this.now();
      for (const record of document.sessions) {
        if (gameIds.has(record.gameId)) throw new Error("The persisted game IDs are not unique.");
        gameIds.add(record.gameId);
      }

      const activeRecords = document.sessions.filter(record => now - record.lastAccessedAt < this.ttlMs);
      if (activeRecords.length > this.maxSessions) {
        throw new Error("The active persisted game count exceeds maxSessions.");
      }

      for (const record of activeRecords) {
        if (document.formatVersion === 1
          && record.kind === "basketball"
          && (!("basketballOutcomeSeed" in record) || record.basketballOutcomeSeed === undefined)
          && record.events.some(event => event.type === "move")) {
          this.storeUnavailable({
            ...record,
            resetEpoch: record.resetEpoch ?? 0,
            unavailableReason: "missing-basketball-outcome-seed",
          });
          continue;
        }
        if (document.formatVersion === 2 && "unavailableReason" in record) {
          this.storeUnavailable(record);
          continue;
        }
        const basketballOutcomeSeed = record.kind === "basketball" && "basketballOutcomeSeed" in record
          ? record.basketballOutcomeSeed
          : undefined;
        const session = replayGameSession(
          {
            gameId: record.gameId,
            kind: record.kind,
            playerColor: record.playerColor,
            difficulty: record.difficulty,
            resetEpoch: record.resetEpoch ?? 0,
            ...(record.kind === "go" ? {
              boardSize: record.boardSize,
              ...(record.initialPosition === undefined ? {} : { initialPosition: record.initialPosition }),
              ...(record.importReview === undefined ? {} : { importReview: record.importReview }),
            } : {}),
            ...(record.kind === "basketball" ? {
              basketballOutcomeSeed,
            } : {}),
          },
          record.events.map(event => event.type === "move"
            ? { type: "move", actor: event.actor, move: event.move }
            : { type: "end" }),
        );
        this.sessions.set(record.gameId, { session, lastAccessedAt: record.lastAccessedAt });
      }
      const removedExpiredRecords = activeRecords.length !== document.sessions.length;
      if (document.formatVersion === 1) {
        this.backupLegacyStore(persistedSource);
      }
      if (document.formatVersion === 1 || removedExpiredRecords) {
        this.persist();
      }
    } catch (error) {
      this.sessions.clear();
      this.unavailableSessions.clear();
      throw new Error(`Persisted game store could not be validated: ${this.persistencePath}`, { cause: error });
    }
  }

  private assertPersistenceWritable(): void {
    if (this.persistencePath === undefined) return;
    const directory = dirname(this.persistencePath);
    mkdirSync(directory, { recursive: true });
    const probePath = join(directory, `.${basename(this.persistencePath)}.${process.pid}.${randomUUID()}.probe`);
    try {
      writeFileSync(probePath, "", { encoding: "utf8", flag: "wx", mode: 0o600 });
      unlinkSync(probePath);
      syncDirectory(directory);
    } catch (error) {
      try {
        unlinkSync(probePath);
      } catch {
        // The write probe may not have been created.
      }
      throw new Error(`Persisted game store is not writable: ${this.persistencePath}`, { cause: error });
    }
  }

  private persist(): void {
    if (this.persistencePath === undefined) return;

    const document = persistedStoreV2Schema.parse({
      formatVersion: 2,
      sessions: [
        ...[...this.sessions.values()].map(persistedSessionFromStored),
        ...this.unavailableSessions.values(),
      ],
    }) satisfies PersistedStore;

    const directory = dirname(this.persistencePath);
    mkdirSync(directory, { recursive: true });
    const temporaryPath = temporaryPathFor(this.persistencePath, "store");

    let renamed = false;
    try {
      writeFileAndSync(temporaryPath, `${JSON.stringify(document, null, 2)}\n`);
      renameSync(temporaryPath, this.persistencePath);
      renamed = true;
      syncDirectory(directory);
      this.rememberReadiness(true);
    } catch (error) {
      this.rememberReadiness(false);
      try {
        unlinkSync(temporaryPath);
      } catch {
        // The temporary file may not have been created or may already have been renamed.
      }
      const message = `Persisted game store could not be written: ${this.persistencePath}`;
      if (renamed) throw new PersistenceCommitUnknownError(message, { cause: error });
      throw new Error(message, { cause: error });
    }
  }

  private backupLegacyStore(persistedSource: string): void {
    if (this.persistencePath === undefined) return;
    if (readFileSync(this.persistencePath, "utf8") !== persistedSource) {
      throw new Error("The legacy game store changed during migration.");
    }
    const backupPath = `${this.persistencePath}.v1.bak`;
    if (!existsSync(backupPath)) {
      const directory = dirname(backupPath);
      const temporaryPath = temporaryPathFor(backupPath, "backup");
      let renamed = false;
      try {
        writeFileAndSync(temporaryPath, persistedSource);
        renameSync(temporaryPath, backupPath);
        renamed = true;
        syncDirectory(directory);
      } catch (error) {
        try {
          unlinkSync(temporaryPath);
        } catch {
          // The temporary file may not have been created or may already have been renamed.
        }
        const durability = renamed ? " durably" : "";
        throw new Error(`The legacy game store backup could not be written${durability}.`, { cause: error });
      }
    }
    const backupStats = lstatSync(backupPath);
    if (!backupStats.isFile()
      || readFileSync(backupPath, "utf8") !== persistedSource
      || (backupStats.mode & 0o777) !== 0o600) {
      throw new Error("The legacy game store backup could not be verified.");
    }
  }

  private pruneExpiredLegacyBackup(): void {
    if (this.persistencePath === undefined) return;
    const backupPath = `${this.persistencePath}.v1.bak`;
    if (!existsSync(backupPath)) return;
    const stats = lstatSync(backupPath);
    if (!stats.isFile()) throw new Error("The legacy game store backup is not a regular file.");
    if (this.now() - stats.mtimeMs < this.legacyBackupTtlMs) return;
    unlinkSync(backupPath);
    syncDirectory(dirname(backupPath));
  }

  private rememberReadiness(ready: boolean): void {
    this.readinessCache = { checkedAt: this.now(), ready };
  }

  private cleanupStaleTemporaryFiles(): void {
    if (this.persistencePath === undefined) return;
    const directory = dirname(this.persistencePath);
    const patterns = temporaryFilePatterns(this.persistencePath);
    const staleBefore = this.now() - STALE_TEMP_FILE_TTL_MS;
    const candidates = readdirSync(directory)
      .filter(name => patterns.some(pattern => pattern.test(name)))
      .sort();
    let removed = 0;
    for (const name of candidates) {
      if (removed >= MAX_STALE_TEMP_FILES_TO_CLEAN) break;
      const path = join(directory, name);
      let stats;
      try {
        stats = lstatSync(path);
      } catch (error) {
        if (isMissingFileError(error)) continue;
        throw error;
      }
      if (!stats.isFile() || stats.mtimeMs > staleBefore) continue;
      try {
        unlinkSync(path);
        removed += 1;
      } catch (error) {
        if (!isMissingFileError(error)) throw error;
      }
    }
    if (removed > 0) syncDirectory(directory);
  }
}

function temporaryPathFor(targetPath: string, purpose: "store" | "backup"): string {
  return join(
    dirname(targetPath),
    `.${basename(targetPath)}.${process.pid}.${randomUUID()}.${purpose}.tmp`,
  );
}

function temporaryFilePatterns(persistencePath: string): RegExp[] {
  const storeName = escapeRegExp(basename(persistencePath));
  const backupName = escapeRegExp(`${basename(persistencePath)}.v1.bak`);
  const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
  return [
    new RegExp(`^\\.${storeName}\\.\\d+\\.${uuid}\\.store\\.tmp$`),
    new RegExp(`^\\.${backupName}\\.\\d+\\.${uuid}\\.backup\\.tmp$`),
    new RegExp(`^\\.${storeName}\\.\\d+\\.${uuid}\\.probe$`),
    new RegExp(`^\\.${storeName}\\.\\d+\\.\\d+\\.tmp$`),
  ];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function writeFileAndSync(path: string, contents: string): void {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, "wx", 0o600);
    writeFileSync(descriptor, contents, { encoding: "utf8" });
    fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function syncDirectory(directory: string): void {
  const descriptor = openSync(directory, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}
