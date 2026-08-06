import { GameRuleError } from "./errors.js";
import type { GameActor, GameDifficulty, GoBoardSize, GoGameSnapshot, GoPositionSetup, MoveRecord, StoneColor } from "./types.js";

const COLUMNS = "ABCDEFGHJKLMNOPQRST";
const PASS = "pass";
type Point = { row: number; column: number };
type Board = (StoneColor | null)[][];

function otherColor(color: StoneColor): StoneColor {
  return color === "black" ? "white" : "black";
}

function colorOwner(playerColor: StoneColor, color: StoneColor): GameActor {
  return playerColor === color ? "player" : "gpt";
}

export class GoGame {
  private board: Board;
  private turn: StoneColor = "black";
  private status: "active" | "finished" = "active";
  private readonly moveHistory: MoveRecord[] = [];
  private readonly captures = { black: 0, white: 0 };
  private consecutivePasses = 0;
  private stateVersion = 0;
  private readonly stonePositionHashes: Set<string>;
  private readonly initialPosition: GoPositionSetup | undefined;
  private importReview: "pending" | "confirmed" | undefined;

  private constructor(
    private readonly gameId: string,
    private readonly playerColor: StoneColor,
    private readonly boardSize: GoBoardSize,
    private readonly difficulty: GameDifficulty,
    private readonly resetEpoch: number,
    initialPosition?: GoPositionSetup,
    importReview?: "pending" | "confirmed",
  ) {
    this.board = GoGame.emptyBoard(boardSize);
    if (initialPosition === undefined && importReview !== undefined) {
      throw new GameRuleError("invalid_position", "Only imported Go positions can have an import review state.");
    }
    if (importReview !== undefined && importReview !== "pending" && importReview !== "confirmed") {
      throw new GameRuleError("invalid_position", "The imported Go review state is not supported.");
    }
    this.initialPosition = initialPosition === undefined ? undefined : this.loadInitialPosition(initialPosition);
    this.importReview = initialPosition === undefined ? undefined : importReview ?? "pending";
    if (this.importReview === "confirmed") this.stateVersion = 1;
    this.stonePositionHashes = new Set([this.boardHash(this.board)]);
  }

  static create(
    gameId: string,
    playerColor: StoneColor,
    boardSize: GoBoardSize = 9,
    difficulty: GameDifficulty = "medium",
    resetEpoch = 0,
    initialPosition?: GoPositionSetup,
    importReview?: "pending" | "confirmed",
  ): GoGame {
    if (boardSize !== 9 && boardSize !== 13 && boardSize !== 19) {
      throw new RangeError("Unsupported Go board size.");
    }
    return new GoGame(gameId, playerColor, boardSize, difficulty, resetEpoch, initialPosition, importReview);
  }

  snapshot(): GoGameSnapshot {
    const score = this.status === "finished" ? this.areaScore() : undefined;
    const winner = score === undefined ? undefined : score.black > score.white ? "black" : "white";

    return {
      gameId: this.gameId,
      kind: "go",
      difficulty: this.difficulty,
      playerColor: this.playerColor,
      turn: this.turn,
      status: this.status,
      ...(winner === undefined ? {} : { winner }),
      legalMoves: this.status === "finished" || this.importReview === "pending" ? [] : this.legalMoves(),
      moveHistory: this.moveHistory.map((move) => ({ ...move })),
      ...(this.moveHistory.length === 0
        ? {}
        : { lastMove: { ...this.moveHistory[this.moveHistory.length - 1] } }),
      stateVersion: this.stateVersion,
      resetEpoch: this.resetEpoch,
      message: this.message(score, winner),
      board: this.board.map((row) => [...row]),
      boardSize: this.boardSize,
      ...(this.initialPosition === undefined ? {} : { initialPosition: GoGame.cloneInitialPosition(this.initialPosition) }),
      ...(this.importReview === undefined ? {} : { importReview: this.importReview }),
      captures: { ...this.captures },
      consecutivePasses: this.consecutivePasses,
      ...(score === undefined ? {} : { score }),
    };
  }

  play(actor: GameActor, move: string, expectedVersion: number): GoGameSnapshot {
    if (expectedVersion !== this.stateVersion) {
      throw new GameRuleError("stale_version", "The supplied game version is stale.");
    }
    if (this.importReview === "pending") {
      throw new GameRuleError("import_review_required", "Confirm the imported Go position before playing a move.");
    }
    if (this.status === "finished") {
      throw new GameRuleError("game_finished", "This game has already finished.");
    }
    if (colorOwner(this.playerColor, this.turn) !== actor) {
      throw new GameRuleError("wrong_actor", "This actor does not own the current turn.");
    }

    if (move === PASS) {
      this.commitMove(actor, move, 0, true);
      return this.snapshot();
    }

    const point = this.parsePoint(move);
    if (point === undefined || this.board[point.row][point.column] !== null) {
      throw new GameRuleError("illegal_move", "That move is not legal in the current position.");
    }

    const simulation = this.simulateStoneMove(this.board, point, this.turn);
    if (simulation === undefined || this.stonePositionHashes.has(this.boardHash(simulation.board))) {
      throw new GameRuleError("illegal_move", "That move is not legal in the current position.");
    }

    this.board = simulation.board;
    this.stonePositionHashes.add(this.boardHash(this.board));
    this.commitMove(actor, move, simulation.captured, false);
    return this.snapshot();
  }

  confirmImportedPosition(expectedVersion: number): GoGameSnapshot {
    if (expectedVersion !== this.stateVersion) {
      throw new GameRuleError("stale_version", "The supplied game version is stale.");
    }
    if (this.status === "finished") {
      throw new GameRuleError("game_finished", "This game has already finished.");
    }
    if (this.importReview !== "pending") {
      throw new GameRuleError("import_review_unavailable", "This game does not have an imported Go position awaiting review.");
    }
    this.importReview = "confirmed";
    this.stateVersion += 1;
    return this.snapshot();
  }

  private commitMove(actor: GameActor, notation: string, captured: number, wasPass: boolean): void {
    const color = this.turn;
    if (captured > 0) {
      this.captures[color] += captured;
    }
    this.consecutivePasses = wasPass ? this.consecutivePasses + 1 : 0;
    this.moveHistory.push({ actor, color, notation, ply: this.moveHistory.length + 1 });
    this.stateVersion += 1;
    this.turn = otherColor(color);
    if (this.consecutivePasses >= 2) {
      this.status = "finished";
    }
  }

  private legalMoves(): string[] {
    const moves: string[] = [];
    for (let row = 0; row < this.boardSize; row += 1) {
      for (let column = 0; column < this.boardSize; column += 1) {
        if (this.board[row][column] !== null) continue;
        const simulation = this.simulateStoneMove(this.board, { row, column }, this.turn);
        if (simulation !== undefined && !this.stonePositionHashes.has(this.boardHash(simulation.board))) {
          moves.push(this.formatPoint({ row, column }));
        }
      }
    }
    return [...moves.sort(), PASS];
  }

  private simulateStoneMove(board: Board, point: Point, color: StoneColor): { board: Board; captured: number } | undefined {
    const candidate = board.map((row) => [...row]);
    candidate[point.row][point.column] = color;
    let captured = 0;
    const inspected = new Set<string>();
    for (const neighbor of this.neighbors(point)) {
      if (candidate[neighbor.row][neighbor.column] !== otherColor(color)) continue;
      const key = this.pointKey(neighbor);
      if (inspected.has(key)) continue;
      const group = this.group(candidate, neighbor);
      for (const member of group.stones) inspected.add(this.pointKey(member));
      if (group.liberties.size === 0) {
        for (const member of group.stones) candidate[member.row][member.column] = null;
        captured += group.stones.length;
      }
    }
    return this.group(candidate, point).liberties.size === 0 ? undefined : { board: candidate, captured };
  }

  private loadInitialPosition(value: GoPositionSetup): GoPositionSetup {
    if (value.source !== "imported") {
      throw new GameRuleError("invalid_position", "The Go position source is not supported.");
    }
    if (value.turn !== "black" && value.turn !== "white") {
      throw new GameRuleError("invalid_position", "The imported Go position must name the next color to move.");
    }
    if (!Number.isSafeInteger(value.captures.black) || value.captures.black < 0
      || !Number.isSafeInteger(value.captures.white) || value.captures.white < 0) {
      throw new GameRuleError("invalid_position", "Imported capture counts must be nonnegative integers.");
    }

    const occupied = new Set<string>();
    for (const [color, stones] of [["black", value.blackStones], ["white", value.whiteStones]] as const) {
      for (const notation of stones) {
        const point = this.parsePoint(notation);
        const key = point === undefined ? undefined : this.pointKey(point);
        if (point === undefined || key === undefined || occupied.has(key)) {
          throw new GameRuleError("invalid_position", "Imported Go stones must be unique, in range, and non-overlapping.");
        }
        occupied.add(key);
        this.board[point.row][point.column] = color;
      }
    }

    this.rejectCapturedGroupsInSetup();
    this.turn = value.turn;
    this.captures.black = value.captures.black;
    this.captures.white = value.captures.white;
    return GoGame.cloneInitialPosition(value);
  }

  private rejectCapturedGroupsInSetup(): void {
    const inspected = new Set<string>();
    for (let row = 0; row < this.boardSize; row += 1) {
      for (let column = 0; column < this.boardSize; column += 1) {
        if (this.board[row][column] === null || inspected.has(this.pointKey({ row, column }))) continue;
        const group = this.group(this.board, { row, column });
        for (const stone of group.stones) inspected.add(this.pointKey(stone));
        if (group.liberties.size === 0) {
          throw new GameRuleError("invalid_position", "Imported Go positions cannot contain stones that should already be captured.");
        }
      }
    }
  }

  private group(board: Board, start: Point): { stones: Point[]; liberties: Set<string> } {
    const color = board[start.row][start.column];
    if (color === null) return { stones: [], liberties: new Set() };
    const stones: Point[] = [];
    const liberties = new Set<string>();
    const visited = new Set<string>();
    const pending = [start];
    while (pending.length > 0) {
      const point = pending.pop() as Point;
      const key = this.pointKey(point);
      if (visited.has(key)) continue;
      visited.add(key);
      stones.push(point);
      for (const neighbor of this.neighbors(point)) {
        const value = board[neighbor.row][neighbor.column];
        if (value === null) liberties.add(this.pointKey(neighbor));
        else if (value === color && !visited.has(this.pointKey(neighbor))) pending.push(neighbor);
      }
    }
    return { stones, liberties };
  }

  private areaScore(): { black: number; white: number; komi: 6.5 } {
    let black = 0;
    let white = 6.5;
    const visitedEmpty = new Set<string>();
    for (let row = 0; row < this.boardSize; row += 1) {
      for (let column = 0; column < this.boardSize; column += 1) {
        const point = { row, column };
        const value = this.board[row][column];
        if (value === "black") {
          black += 1;
        } else if (value === "white") {
          white += 1;
        } else if (!visitedEmpty.has(this.pointKey(point))) {
          const territory = this.emptyRegion(point, visitedEmpty);
          if (territory.borders.size === 1) {
            if (territory.borders.has("black")) black += territory.points.length;
            else white += territory.points.length;
          }
        }
      }
    }
    return { black, white, komi: 6.5 };
  }

  private emptyRegion(start: Point, visited: Set<string>): { points: Point[]; borders: Set<StoneColor> } {
    const points: Point[] = [];
    const borders = new Set<StoneColor>();
    const pending = [start];
    while (pending.length > 0) {
      const point = pending.pop() as Point;
      const key = this.pointKey(point);
      if (visited.has(key)) continue;
      visited.add(key);
      points.push(point);
      for (const neighbor of this.neighbors(point)) {
        const value = this.board[neighbor.row][neighbor.column];
        if (value === null && !visited.has(this.pointKey(neighbor))) pending.push(neighbor);
        else if (value !== null) borders.add(value);
      }
    }
    return { points, borders };
  }

  private parsePoint(notation: string): Point | undefined {
    const match = /^([A-HJ-T])([1-9]|1[0-9])$/.exec(notation);
    if (!match) return undefined;
    const rank = Number(match[2]);
    const column = COLUMNS.indexOf(match[1]);
    if (rank > this.boardSize || column < 0 || column >= this.boardSize) return undefined;
    return { row: this.boardSize - rank, column };
  }

  private formatPoint(point: Point): string {
    return `${COLUMNS[point.column]}${this.boardSize - point.row}`;
  }

  private neighbors(point: Point): Point[] {
    return [
      { row: point.row - 1, column: point.column },
      { row: point.row + 1, column: point.column },
      { row: point.row, column: point.column - 1 },
      { row: point.row, column: point.column + 1 },
    ].filter(({ row, column }) => row >= 0 && row < this.boardSize && column >= 0 && column < this.boardSize);
  }

  private boardHash(board: Board): string {
    return board.map((row) => row.map((stone) => stone === null ? "." : stone === "black" ? "b" : "w").join("")).join("/");
  }

  private pointKey(point: Point): string {
    return `${point.row},${point.column}`;
  }

  private message(score: GoGameSnapshot["score"], winner: StoneColor | undefined): string {
    if (score !== undefined && winner !== undefined) {
      return `${winner === "black" ? "Black" : "White"} wins ${score.black}-${score.white}.`;
    }
    if (this.importReview === "pending") return "Imported position awaiting confirmation.";
    const prefix = this.initialPosition !== undefined && this.moveHistory.length === 0 ? "Imported position confirmed. " : "";
    return `${prefix}${this.turn === "black" ? "Black" : "White"} to move.`;
  }

  private static emptyBoard(boardSize: GoBoardSize): Board {
    return Array.from({ length: boardSize }, () => Array<StoneColor | null>(boardSize).fill(null));
  }

  private static cloneInitialPosition(value: GoPositionSetup): GoPositionSetup {
    return {
      source: "imported",
      blackStones: [...value.blackStones].sort(),
      whiteStones: [...value.whiteStones].sort(),
      turn: value.turn,
      captures: { ...value.captures },
    };
  }
}
