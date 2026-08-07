import { createHmac, randomBytes } from "node:crypto";

import { GameRuleError } from "./errors.js";
import type {
  BasketballMove,
  BasketballGameSnapshot,
  BasketballMoveRecord,
  GameActor,
  GameDifficulty,
  ShotOption,
  ShotResult,
  StoneColor,
} from "./types.js";

type ColorValues = { black: number; white: number };
type ShotProfile = {
  move: BasketballMove;
  points: 2 | 3;
  energyCost: 0 | 1 | 2;
  baseAccuracy: number;
};

const REGULATION_ROUNDS = 5;
const MAX_ROUNDS = 8;
const STARTING_ENERGY = 4;
const REPEAT_PENALTY = 12;
const STREAK_BONUS = 5;
const MAX_STREAK_BONUS = 10;
const MIN_ACCURACY = 20;
const MAX_ACCURACY = 92;

const SHOT_PROFILES: readonly ShotProfile[] = [
  { move: "drive", points: 2, energyCost: 2, baseAccuracy: 82 },
  { move: "pull-up", points: 2, energyCost: 1, baseAccuracy: 66 },
  { move: "three", points: 3, energyCost: 0, baseAccuracy: 48 },
];

const PROFILE_BY_MOVE = new Map(SHOT_PROFILES.map((profile) => [profile.move, profile]));

function colorOwner(playerColor: StoneColor, color: StoneColor): GameActor {
  return playerColor === color ? "player" : "gpt";
}

function titleColor(color: StoneColor): string {
  return color === "black" ? "Black" : "White";
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

const OUTCOME_SEED_PATTERN = /^[0-9a-f]{64}$/;

function createOutcomeSeed(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Court Duel is an original, turn-based basketball shootout. The deterministic
 * roll is keyed by a server-private per-game seed: clients receive each option's
 * public accuracy, but cannot derive which option will make from public state.
 */
export class BasketballGame {
  private turn: StoneColor = "black";
  private status: "active" | "finished" = "active";
  private winner: StoneColor | "draw" | undefined;
  private phase: "regulation" | "overtime" = "regulation";
  private readonly score: ColorValues = { black: 0, white: 0 };
  private readonly energy: ColorValues = { black: STARTING_ENERGY, white: STARTING_ENERGY };
  private readonly streak: ColorValues = { black: 0, white: 0 };
  private readonly attempts: ColorValues = { black: 0, white: 0 };
  private readonly moveHistory: BasketballMoveRecord[] = [];
  private readonly shotResults: ShotResult[] = [];
  private stateVersion = 0;

  private constructor(
    private readonly gameId: string,
    private readonly playerColor: StoneColor,
    private readonly difficulty: GameDifficulty,
    private readonly resetEpoch: number,
    private readonly outcomeSeed: string,
  ) {
    if (!OUTCOME_SEED_PATTERN.test(outcomeSeed)) {
      throw new RangeError("Court Duel outcome seed must be 32 bytes encoded as lowercase hex.");
    }
  }

  static create(
    gameId: string,
    playerColor: StoneColor,
    difficulty: GameDifficulty = "medium",
    resetEpoch = 0,
    outcomeSeed = createOutcomeSeed(),
  ): BasketballGame {
    return new BasketballGame(gameId, playerColor, difficulty, resetEpoch, outcomeSeed);
  }

  serverPrivateState(): { basketballOutcomeSeed: string } {
    return { basketballOutcomeSeed: this.outcomeSeed };
  }

  snapshot(): BasketballGameSnapshot {
    return {
      gameId: this.gameId,
      kind: "basketball",
      difficulty: this.difficulty,
      playerColor: this.playerColor,
      turn: this.turn,
      status: this.status,
      ...(this.winner === undefined ? {} : { winner: this.winner }),
      legalMoves: this.status === "finished" ? [] : this.legalMoves(),
      moveHistory: this.moveHistory.map((move) => ({ ...move })),
      ...(this.moveHistory.length === 0 ? {} : { lastMove: { ...this.moveHistory.at(-1)! } }),
      stateVersion: this.stateVersion,
      resetEpoch: this.resetEpoch,
      message: this.message(),
      score: { ...this.score },
      energy: { ...this.energy },
      streak: { ...this.streak },
      attempts: { ...this.attempts },
      phase: this.phase,
      round: this.round(),
      shotOptions: this.status === "finished" ? [] : this.currentShotOptions(),
      shotResults: this.shotResults.map((result) => ({ ...result })),
    };
  }

  play(actor: GameActor, move: string, expectedVersion: number): BasketballGameSnapshot {
    if (expectedVersion !== this.stateVersion) {
      throw new GameRuleError("stale_version", "The supplied game version is stale.");
    }
    if (this.status === "finished") {
      throw new GameRuleError("game_finished", "This game has already finished.");
    }
    if (colorOwner(this.playerColor, this.turn) !== actor) {
      throw new GameRuleError("wrong_actor", "This actor does not own the current turn.");
    }

    const profile = PROFILE_BY_MOVE.get(move as BasketballMove);
    if (profile === undefined || profile.move !== move || this.energy[this.turn] < profile.energyCost) {
      throw new GameRuleError("illegal_move", "That move is not legal in the current position.");
    }

    const color = this.turn;
    const ply = this.moveHistory.length + 1;
    const accuracy = this.accuracy(profile, color);
    const roll = this.outcomeRoll(ply, color, profile.move);
    const made = roll < accuracy;
    const points: 0 | 2 | 3 = made ? profile.points : 0;

    this.energy[color] -= profile.energyCost;
    this.attempts[color] += 1;
    this.score[color] += points;
    this.streak[color] = made ? this.streak[color] + 1 : 0;
    this.moveHistory.push({ actor, color, notation: profile.move, ply });
    this.shotResults.push({ actor, color, move: profile.move, ply, made, points, accuracy });
    this.stateVersion += 1;

    this.advanceAfterShot(color);
    return this.snapshot();
  }

  private legalMoves(): BasketballMove[] {
    return SHOT_PROFILES
      .filter((profile) => this.energy[this.turn] >= profile.energyCost)
      .map((profile) => profile.move);
  }

  private currentShotOptions(): ShotOption[] {
    return SHOT_PROFILES.map((profile) => ({
      move: profile.move,
      points: profile.points,
      energyCost: profile.energyCost,
      accuracy: this.accuracy(profile, this.turn),
    }));
  }

  private accuracy(profile: ShotProfile, color: StoneColor): number {
    const previous = [...this.shotResults].reverse().find((result) => result.color === color);
    const repeatPenalty = previous?.move === profile.move ? REPEAT_PENALTY : 0;
    const streakBonus = Math.min(MAX_STREAK_BONUS, this.streak[color] * STREAK_BONUS);
    return clamp(profile.baseAccuracy + streakBonus - repeatPenalty, MIN_ACCURACY, MAX_ACCURACY);
  }

  private outcomeRoll(ply: number, color: StoneColor, move: BasketballMove): number {
    const digest = createHmac("sha256", this.outcomeSeed)
      .update(`${this.resetEpoch}|${ply}|${color}|${move}`)
      .digest();
    return digest.readUInt32BE(0) % 100;
  }

  private advanceAfterShot(color: StoneColor): void {
    if (color === "black") {
      this.turn = "white";
      return;
    }

    const completedRound = this.attempts.white;
    if (completedRound < REGULATION_ROUNDS) {
      this.turn = "black";
      return;
    }

    if (this.score.black !== this.score.white) {
      this.status = "finished";
      this.winner = this.score.black > this.score.white ? "black" : "white";
      return;
    }

    if (completedRound >= MAX_ROUNDS) {
      this.status = "finished";
      this.winner = "draw";
      return;
    }

    this.phase = "overtime";
    this.energy.black = Math.min(STARTING_ENERGY, this.energy.black + 1);
    this.energy.white = Math.min(STARTING_ENERGY, this.energy.white + 1);
    this.turn = "black";
  }

  private round(): number {
    if (this.status === "finished") return Math.max(this.attempts.black, this.attempts.white);
    return Math.min(MAX_ROUNDS, Math.min(this.attempts.black, this.attempts.white) + 1);
  }

  private message(): string {
    if (this.winner === "draw") {
      return `Court Duel ends in a ${this.score.black}-${this.score.white} draw.`;
    }
    if (this.winner !== undefined) {
      return `${titleColor(this.winner)} wins Court Duel ${this.score.black}-${this.score.white}.`;
    }
    const overtime = this.phase === "overtime" ? " overtime" : "";
    return `${titleColor(this.turn)} to shoot in${overtime} round ${this.round()}. Score ${this.score.black}-${this.score.white}.`;
  }
}
