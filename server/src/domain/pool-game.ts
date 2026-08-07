import { GameRuleError } from "./errors.js";
import type {
  GameActor,
  GameDifficulty,
  PoolGameSnapshot,
  PoolMove,
  StoneColor,
} from "./types.js";

type Point = { x: number; y: number };
type PoolBall = PoolGameSnapshot["balls"][number];
type PoolBallId = PoolBall["id"];
type PoolPocket = "TL" | "TM" | "TR" | "BL" | "BM" | "BR";
type PoolSafeSpot = "L" | "C" | "R" | "T" | "B";

const BALL_CLEARANCE = 5;
const INITIAL_CUE_BALL: Point = { x: 12, y: 25 };
const INITIAL_BALLS: readonly PoolBall[] = [
  { id: 1, group: "solids", x: 32, y: 9 },
  { id: 2, group: "solids", x: 36, y: 20 },
  { id: 3, group: "solids", x: 34, y: 34 },
  { id: 9, group: "stripes", x: 53, y: 13 },
  { id: 10, group: "stripes", x: 54, y: 29 },
  { id: 11, group: "stripes", x: 72, y: 18 },
  { id: 8, group: "eight", x: 76, y: 35 },
];
const POCKETS: ReadonlyArray<readonly [PoolPocket, Point]> = [
  ["TL", { x: 0, y: 0 }],
  ["TM", { x: 50, y: 0 }],
  ["TR", { x: 100, y: 0 }],
  ["BL", { x: 0, y: 50 }],
  ["BM", { x: 50, y: 50 }],
  ["BR", { x: 100, y: 50 }],
];
const SAFE_SPOTS: ReadonlyArray<readonly [PoolSafeSpot, Point]> = [
  ["L", { x: 18, y: 25 }],
  ["C", { x: 50, y: 25 }],
  ["R", { x: 82, y: 25 }],
  ["T", { x: 50, y: 7 }],
  ["B", { x: 50, y: 43 }],
];

function otherColor(color: StoneColor): StoneColor {
  return color === "black" ? "white" : "black";
}

function colorOwner(playerColor: StoneColor, color: StoneColor): GameActor {
  return playerColor === color ? "player" : "gpt";
}

function distanceToSegment(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const squaredLength = dx * dx + dy * dy;
  const projection = squaredLength === 0
    ? 0
    : Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / squaredLength));
  return Math.hypot(
    point.x - (start.x + projection * dx),
    point.y - (start.y + projection * dy),
  );
}

export class PoolGame {
  private cueBall: Point = { ...INITIAL_CUE_BALL };
  private balls: PoolBall[] = INITIAL_BALLS.map((ball) => ({ ...ball }));
  private turn: StoneColor = "black";
  private status: "active" | "finished" = "active";
  private winner: StoneColor | undefined;
  private readonly moveHistory: PoolGameSnapshot["moveHistory"] = [];
  private stateVersion = 0;

  private constructor(
    private readonly gameId: string,
    private readonly playerColor: StoneColor,
    private readonly difficulty: GameDifficulty,
    private readonly resetEpoch: number,
  ) {}

  static create(
    gameId: string,
    playerColor: StoneColor,
    difficulty: GameDifficulty = "medium",
    resetEpoch = 0,
  ): PoolGame {
    return new PoolGame(gameId, playerColor, difficulty, resetEpoch);
  }

  snapshot(): PoolGameSnapshot {
    return {
      gameId: this.gameId,
      kind: "pool",
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
      cueBall: { ...this.cueBall },
      balls: this.balls.map((ball) => ({ ...ball })),
    };
  }

  play(actor: GameActor, move: string, expectedVersion: number): PoolGameSnapshot {
    if (expectedVersion !== this.stateVersion) {
      throw new GameRuleError("stale_version", "The supplied game version is stale.");
    }
    if (this.status === "finished") {
      throw new GameRuleError("game_finished", "This game has already finished.");
    }
    if (colorOwner(this.playerColor, this.turn) !== actor) {
      throw new GameRuleError("wrong_actor", "This actor does not own the current turn.");
    }
    if (!this.legalMoves().includes(move as PoolMove)) {
      throw new GameRuleError("illegal_move", "That move is not legal in the current position.");
    }

    const color = this.turn;
    if (move.startsWith("POT:")) {
      const ballId = Number(move.split(":")[1]) as PoolBallId;
      const ball = this.balls.find((candidate) => candidate.id === ballId)!;
      this.cueBall = { x: ball.x, y: ball.y };
      this.balls = this.balls.filter((candidate) => candidate.id !== ballId);
      if (ball.group === "eight") {
        this.status = "finished";
        this.winner = color;
      }
    } else {
      const spot = SAFE_SPOTS.find(([name]) => name === move.slice(5))![1];
      this.cueBall = { ...spot };
      this.turn = otherColor(color);
    }

    this.moveHistory.push({ actor, color, notation: move as PoolMove, ply: this.moveHistory.length + 1 });
    this.stateVersion += 1;
    return this.snapshot();
  }

  private legalMoves(): PoolMove[] {
    const ownGroup = this.turn === "black" ? "solids" : "stripes";
    const groupBalls = this.balls.filter((ball) => ball.group === ownGroup);
    const targets = groupBalls.length > 0
      ? groupBalls
      : this.balls.filter((ball) => ball.group === "eight");
    const moves: PoolMove[] = [];
    for (const ball of targets) {
      for (const [pocket, point] of POCKETS) {
        if (this.isClearPot(ball, point)) moves.push(`POT:${ball.id}:${pocket}` as PoolMove);
      }
    }
    for (const [spot] of SAFE_SPOTS) moves.push(`SAFE:${spot}` as PoolMove);
    return moves;
  }

  private isClearPot(target: PoolBall, pocket: Point): boolean {
    const incoming = { x: target.x - this.cueBall.x, y: target.y - this.cueBall.y };
    const outgoing = { x: pocket.x - target.x, y: pocket.y - target.y };
    if (incoming.x * outgoing.x + incoming.y * outgoing.y <= 0) return false;
    return this.clearLane(this.cueBall, target, target.id)
      && this.clearLane(target, pocket, target.id);
  }

  private clearLane(start: Point, end: Point, targetId: PoolBallId): boolean {
    return this.balls.every((ball) => ball.id === targetId || distanceToSegment(ball, start, end) >= BALL_CLEARANCE);
  }

  private message(): string {
    if (this.winner !== undefined) {
      return `${this.winner === "black" ? "Black (solids)" : "White (stripes)"} wins by pocketing the 8-ball.`;
    }
    return `${this.turn === "black" ? "Black (solids)" : "White (stripes)"} to shoot.`;
  }
}
