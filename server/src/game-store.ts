import {
  existsSync,
  mkdirSync,
  readFileSync,
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
const maxPersistedEvents = 10_000;

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

const persistedSessionSchema = z.discriminatedUnion("kind", [
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

const persistedStoreSchema = z.object({
  formatVersion: z.literal(1),
  sessions: z.array(persistedSessionSchema).max(MAX_GAME_STORE_SESSIONS),
}).strict();

type PersistedStore = z.infer<typeof persistedStoreSchema>;
type PersistedSession = z.infer<typeof persistedSessionSchema>;

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
  private readonly maxSessions: number;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly persistencePath: string | undefined;
  private writeSequence = 0;

  constructor(options: GameStoreOptions = {}) {
    this.maxSessions = options.maxSessions ?? DEFAULT_GAME_STORE_MAX_SESSIONS;
    this.ttlMs = options.ttlMs ?? DEFAULT_GAME_STORE_TTL_MS;
    this.now = options.now ?? Date.now;
    this.persistencePath = options.persistencePath;
    this.validateOptions();
    this.loadPersistedSessions();
  }

  put(session: GameSession): void {
    this.mutateAndPersist(() => {
      this.pruneExpired();
      const gameId = session.snapshot().gameId;
      if (!this.sessions.has(gameId) && this.sessions.size >= this.maxSessions) {
        throw new GameRuleError("store_full", "The game save limit has been reached.");
      }
      this.store(gameId, session);
    });
  }

  get(gameId: string): GameSession {
    this.pruneExpired();
    const stored = this.sessions.get(gameId);
    if (!stored) {
      throw new GameRuleError("not_found", `Game ${gameId} was not found.`);
    }
    this.mutateAndPersist(() => this.store(gameId, stored.session));
    return stored.session;
  }

  replace(session: GameSession): void {
    const gameId = session.snapshot().gameId;
    this.mutateAndPersist(() => {
      this.pruneExpired();
      if (!this.sessions.has(gameId)) {
        throw new GameRuleError("not_found", `Game ${gameId} was not found.`);
      }
      this.store(gameId, session);
    });
  }

  private store(gameId: string, session: GameSession): void {
    this.sessions.delete(gameId);
    this.sessions.set(gameId, { session, lastAccessedAt: this.now() });
  }

  private pruneExpired(): void {
    const now = this.now();
    for (const [gameId, stored] of this.sessions) {
      if (now - stored.lastAccessedAt >= this.ttlMs) {
        this.sessions.delete(gameId);
      }
    }
  }

  private validateOptions(): void {
    if (!Number.isInteger(this.maxSessions) || this.maxSessions < 1 || this.maxSessions > MAX_GAME_STORE_SESSIONS) {
      throw new RangeError(`maxSessions must be an integer between 1 and ${MAX_GAME_STORE_SESSIONS}.`);
    }
    if (!Number.isFinite(this.ttlMs) || this.ttlMs <= 0) {
      throw new RangeError("ttlMs must be a positive finite number.");
    }
    if (this.persistencePath !== undefined && this.persistencePath.length === 0) {
      throw new RangeError("persistencePath must not be empty.");
    }
  }

  private mutateAndPersist(mutation: () => void): void {
    const previous = new Map(this.sessions);
    try {
      mutation();
      this.persist();
    } catch (error) {
      this.sessions.clear();
      for (const [gameId, stored] of previous) this.sessions.set(gameId, stored);
      throw error;
    }
  }

  private loadPersistedSessions(): void {
    if (this.persistencePath === undefined || !existsSync(this.persistencePath)) return;

    try {
      const document = persistedStoreSchema.parse(JSON.parse(readFileSync(this.persistencePath, "utf8")));
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
              basketballOutcomeSeed: record.basketballOutcomeSeed,
            } : {}),
          },
          record.events.map(event => event.type === "move"
            ? { type: "move", actor: event.actor, move: event.move }
            : { type: "end" }),
        );
        this.sessions.set(record.gameId, { session, lastAccessedAt: record.lastAccessedAt });
      }
    } catch (error) {
      this.sessions.clear();
      throw new Error(`Persisted game store could not be validated: ${this.persistencePath}`, { cause: error });
    }
  }

  private persist(): void {
    if (this.persistencePath === undefined) return;

    const document = persistedStoreSchema.parse({
      formatVersion: 1,
      sessions: [...this.sessions.values()].map(persistedSessionFromStored),
    }) satisfies PersistedStore;

    const directory = dirname(this.persistencePath);
    mkdirSync(directory, { recursive: true });
    const temporaryPath = join(
      directory,
      `.${basename(this.persistencePath)}.${process.pid}.${this.writeSequence += 1}.tmp`,
    );

    try {
      writeFileSync(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      renameSync(temporaryPath, this.persistencePath);
    } catch (error) {
      try {
        unlinkSync(temporaryPath);
      } catch {
        // The temporary file may not have been created or may already have been renamed.
      }
      throw new Error(`Persisted game store could not be written: ${this.persistencePath}`, { cause: error });
    }
  }
}
