import { GameRuleError } from "./errors.js";
import type { GameActor, GameDifficulty, ReversiCoordinate, ReversiGameSnapshot, ReversiMoveRecord, StoneColor } from "./types.js";

type Board = (StoneColor | null)[][];
type Point = { row: number; column: number };

const SIZE = 8;
const FILES = "ABCDEFGH";
const DIRECTIONS: readonly Point[] = [
  { row: -1, column: -1 }, { row: -1, column: 0 }, { row: -1, column: 1 },
  { row: 0, column: -1 }, { row: 0, column: 1 },
  { row: 1, column: -1 }, { row: 1, column: 0 }, { row: 1, column: 1 },
];

function other(color: StoneColor): StoneColor { return color === "black" ? "white" : "black"; }
function owner(playerColor: StoneColor, color: StoneColor): GameActor { return playerColor === color ? "player" : "gpt"; }
function inside({ row, column }: Point): boolean { return row >= 0 && row < SIZE && column >= 0 && column < SIZE; }

export class ReversiGame {
  private board: Board = Array.from({ length: SIZE }, () => Array<StoneColor | null>(SIZE).fill(null));
  private turn: StoneColor = "black";
  private status: "active" | "finished" = "active";
  private winner: StoneColor | "draw" | undefined;
  private readonly moveHistory: ReversiMoveRecord[] = [];
  private stateVersion = 0;
  private lastSkippedColor: StoneColor | undefined;

  private constructor(private readonly gameId: string, private readonly playerColor: StoneColor, private readonly difficulty: GameDifficulty) {
    this.board[3][3] = "black"; this.board[3][4] = "white";
    this.board[4][3] = "white"; this.board[4][4] = "black";
  }

  static create(gameId: string, playerColor: StoneColor, difficulty: GameDifficulty = "medium"): ReversiGame {
    return new ReversiGame(gameId, playerColor, difficulty);
  }

  snapshot(): ReversiGameSnapshot {
    const score = this.score();
    return {
      gameId: this.gameId, kind: "reversi", difficulty: this.difficulty, playerColor: this.playerColor,
      turn: this.turn, status: this.status, ...(this.winner === undefined ? {} : { winner: this.winner }),
      legalMoves: this.status === "finished" ? [] : this.legalMoves(this.turn),
      moveHistory: this.moveHistory.map((move) => ({ ...move })), ...(this.moveHistory.length ? { lastMove: { ...this.moveHistory.at(-1)! } } : {}),
      stateVersion: this.stateVersion, message: this.message(), board: this.board.map((row) => [...row]), score: { ...score },
    };
  }

  play(actor: GameActor, move: string, expectedVersion: number): ReversiGameSnapshot {
    if (expectedVersion !== this.stateVersion) throw new GameRuleError("stale_version", "The supplied game version is stale.");
    if (this.status === "finished") throw new GameRuleError("game_finished", "This game has already finished.");
    if (owner(this.playerColor, this.turn) !== actor) throw new GameRuleError("wrong_actor", "This actor does not own the current turn.");
    const parsedMove = this.parse(move);
    if (!parsedMove) throw new GameRuleError("illegal_move", "That move is not legal in the current position.");
    const { point, notation } = parsedMove;
    const flips = this.flipsAt(point, this.turn);
    if (!flips.length) throw new GameRuleError("illegal_move", "That move is not legal in the current position.");
    const color = this.turn;
    this.board[point.row][point.column] = color;
    for (const flip of flips) this.board[flip.row][flip.column] = color;
    this.moveHistory.push({ actor, color, notation, ply: this.moveHistory.length + 1 });
    this.stateVersion += 1;
    this.lastSkippedColor = undefined;
    const opponent = other(color);
    if (this.boardFull() || (!this.legalMoves(opponent).length && !this.legalMoves(color).length)) {
      this.finish();
    } else if (this.legalMoves(opponent).length) {
      this.turn = opponent;
    } else {
      this.lastSkippedColor = opponent;
    }
    return this.snapshot();
  }

  private parse(move: string): { point: Point; notation: ReversiCoordinate } | undefined {
    if (!/^[A-H][1-8]$/.test(move)) return undefined;
    const point = { column: FILES.indexOf(move[0]), row: SIZE - Number(move[1]) };
    return { point, notation: this.coordinate(point) };
  }

  private coordinate(point: Point): ReversiCoordinate { return `${FILES[point.column]}${SIZE - point.row}` as ReversiCoordinate; }

  private legalMoves(color: StoneColor): ReversiCoordinate[] {
    const moves: ReversiCoordinate[] = [];
    for (let row = 0; row < SIZE; row += 1) for (let column = 0; column < SIZE; column += 1) {
      if (this.flipsAt({ row, column }, color).length) moves.push(this.coordinate({ row, column }));
    }
    return moves.sort();
  }

  private flipsAt(point: Point, color: StoneColor): Point[] {
    if (!inside(point) || this.board[point.row][point.column] !== null) return [];
    const opponent = other(color); const flips: Point[] = [];
    for (const direction of DIRECTIONS) {
      const line: Point[] = [];
      let current = { row: point.row + direction.row, column: point.column + direction.column };
      while (inside(current) && this.board[current.row][current.column] === opponent) {
        line.push(current); current = { row: current.row + direction.row, column: current.column + direction.column };
      }
      if (line.length && inside(current) && this.board[current.row][current.column] === color) flips.push(...line);
    }
    return flips;
  }

  private boardFull(): boolean { return this.board.every((row) => row.every((cell) => cell !== null)); }
  private score(): { black: number; white: number } {
    let black = 0; let white = 0;
    for (const row of this.board) for (const cell of row) { if (cell === "black") black += 1; else if (cell === "white") white += 1; }
    return { black, white };
  }
  private finish(): void { const score = this.score(); this.status = "finished"; this.winner = score.black === score.white ? "draw" : score.black > score.white ? "black" : "white"; }
  private message(): string {
    if (this.winner === "draw") return "The game is a draw.";
    if (this.winner) return `${this.winner === "black" ? "Black" : "White"} wins.`;
    if (this.lastSkippedColor !== undefined) return `${this.lastSkippedColor === "black" ? "Black" : "White"} has no legal move; ${this.turn === "black" ? "Black" : "White"} moves again.`;
    return `${this.turn === "black" ? "Black" : "White"} to move.`;
  }
}
