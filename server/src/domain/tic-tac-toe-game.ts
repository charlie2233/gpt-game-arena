import { GameRuleError } from "./errors.js";
import type {
  GameActor,
  GameDifficulty,
  StoneColor,
  TicTacToeCoordinate,
  TicTacToeGameSnapshot,
  TicTacToeMoveRecord,
} from "./types.js";

type Board = (StoneColor | null)[][];
type Point = { row: number; column: number };

const COLUMNS = "ABC";
const WIN_LINES: readonly (readonly TicTacToeCoordinate[])[] = [
  ["A3", "B3", "C3"], ["A2", "B2", "C2"], ["A1", "B1", "C1"],
  ["A3", "A2", "A1"], ["B3", "B2", "B1"], ["C3", "C2", "C1"],
  ["A3", "B2", "C1"], ["A1", "B2", "C3"],
];

function otherColor(color: StoneColor): StoneColor {
  return color === "black" ? "white" : "black";
}

function colorOwner(playerColor: StoneColor, color: StoneColor): GameActor {
  return playerColor === color ? "player" : "gpt";
}

function isTicTacToeCoordinate(move: string): move is TicTacToeCoordinate {
  return /^[A-C][1-3]$/.test(move);
}

export class TicTacToeGame {
  private board: Board = Array.from({ length: 3 }, () => Array<StoneColor | null>(3).fill(null));
  private turn: StoneColor = "black";
  private status: "active" | "finished" = "active";
  private winner: StoneColor | "draw" | undefined;
  private winningLine: [TicTacToeCoordinate, TicTacToeCoordinate, TicTacToeCoordinate] | undefined;
  private readonly moveHistory: TicTacToeMoveRecord[] = [];
  private stateVersion = 0;

  private constructor(
    private readonly gameId: string,
    private readonly playerColor: StoneColor,
    private readonly difficulty: GameDifficulty,
  ) {}

  static create(gameId: string, playerColor: StoneColor, difficulty: GameDifficulty = "medium"): TicTacToeGame {
    return new TicTacToeGame(gameId, playerColor, difficulty);
  }

  snapshot(): TicTacToeGameSnapshot {
    return {
      gameId: this.gameId,
      kind: "tic-tac-toe",
      difficulty: this.difficulty,
      playerColor: this.playerColor,
      turn: this.turn,
      status: this.status,
      ...(this.winner === undefined ? {} : { winner: this.winner }),
      legalMoves: this.status === "finished" ? [] : this.legalMoves(),
      moveHistory: this.moveHistory.map((move) => ({ ...move })),
      ...(this.moveHistory.length === 0 ? {} : { lastMove: { ...this.moveHistory.at(-1)! } }),
      stateVersion: this.stateVersion,
      message: this.message(),
      board: this.board.map((row) => [...row]),
      ...(this.winningLine === undefined ? {} : { winningLine: [...this.winningLine] as TicTacToeGameSnapshot["winningLine"] }),
    };
  }

  play(actor: GameActor, move: string, expectedVersion: number): TicTacToeGameSnapshot {
    if (expectedVersion !== this.stateVersion) throw new GameRuleError("stale_version", "The supplied game version is stale.");
    if (this.status === "finished") throw new GameRuleError("game_finished", "This game has already finished.");
    if (colorOwner(this.playerColor, this.turn) !== actor) throw new GameRuleError("wrong_actor", "This actor does not own the current turn.");

    const parsedMove = this.parsePoint(move);
    if (parsedMove === undefined || this.board[parsedMove.point.row][parsedMove.point.column] !== null) {
      throw new GameRuleError("illegal_move", "That move is not legal in the current position.");
    }
    const color = this.turn;
    this.board[parsedMove.point.row][parsedMove.point.column] = color;
    this.moveHistory.push({ actor, color, notation: parsedMove.notation, ply: this.moveHistory.length + 1 });
    this.stateVersion += 1;
    const winningLine = this.findWinningLine(color);
    if (winningLine !== undefined) {
      this.status = "finished";
      this.winner = color;
      this.winningLine = winningLine;
    } else if (this.board.every((row) => row.every((cell) => cell !== null))) {
      this.status = "finished";
      this.winner = "draw";
    } else {
      this.turn = otherColor(color);
    }
    return this.snapshot();
  }

  private legalMoves(): TicTacToeCoordinate[] {
    const moves: TicTacToeCoordinate[] = [];
    for (let row = 0; row < 3; row += 1) {
      for (let column = 0; column < 3; column += 1) {
        if (this.board[row][column] === null) moves.push(this.formatPoint({ row, column }));
      }
    }
    return moves.sort();
  }

  private parsePoint(move: string): { point: Point; notation: TicTacToeCoordinate } | undefined {
    if (!isTicTacToeCoordinate(move)) return undefined;
    const match = /^([A-C])([1-3])$/.exec(move)!;
    return { point: { row: 3 - Number(match[2]), column: COLUMNS.indexOf(match[1]) }, notation: move };
  }

  private formatPoint({ row, column }: Point): TicTacToeCoordinate {
    return `${COLUMNS[column]}${3 - row}` as TicTacToeCoordinate;
  }

  private findWinningLine(color: StoneColor): [TicTacToeCoordinate, TicTacToeCoordinate, TicTacToeCoordinate] | undefined {
    for (const line of WIN_LINES) {
      if (line.every((coordinate) => {
        const point = this.parsePoint(coordinate)!.point;
        return this.board[point.row][point.column] === color;
      })) return [...line] as [TicTacToeCoordinate, TicTacToeCoordinate, TicTacToeCoordinate];
    }
    return undefined;
  }

  private message(): string {
    if (this.winner === "draw") return "The game is a draw.";
    if (this.winner !== undefined) return `${this.winner === "black" ? "Black" : "White"} wins.`;
    return `${this.turn === "black" ? "Black" : "White"} to move.`;
  }
}
