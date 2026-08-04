import { GameRuleError } from "./errors.js";
import type {
  ConnectFourColumn,
  ConnectFourCoordinate,
  ConnectFourGameSnapshot,
  ConnectFourMoveRecord,
  GameActor,
  GameDifficulty,
  StoneColor,
} from "./types.js";

type Board = (StoneColor | null)[][];
type Point = { row: number; column: number };

const COLUMNS = "ABCDEFG";
const ROWS = 6;
const WIDTH = 7;
const DIRECTIONS: readonly Point[] = [{ row: 0, column: 1 }, { row: 1, column: 0 }, { row: 1, column: 1 }, { row: 1, column: -1 }];

function otherColor(color: StoneColor): StoneColor {
  return color === "black" ? "white" : "black";
}

function colorOwner(playerColor: StoneColor, color: StoneColor): GameActor {
  return playerColor === color ? "player" : "gpt";
}

function isConnectFourColumn(move: string): move is ConnectFourColumn {
  return /^[A-G]$/.test(move);
}

export class ConnectFourGame {
  private board: Board = Array.from({ length: ROWS }, () => Array<StoneColor | null>(WIDTH).fill(null));
  private turn: StoneColor = "black";
  private status: "active" | "finished" = "active";
  private winner: StoneColor | "draw" | undefined;
  private winningLine: [ConnectFourCoordinate, ConnectFourCoordinate, ConnectFourCoordinate, ConnectFourCoordinate] | undefined;
  private readonly moveHistory: ConnectFourMoveRecord[] = [];
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
  ): ConnectFourGame {
    return new ConnectFourGame(gameId, playerColor, difficulty, resetEpoch);
  }

  snapshot(): ConnectFourGameSnapshot {
    return {
      gameId: this.gameId, kind: "connect-four", difficulty: this.difficulty, playerColor: this.playerColor,
      turn: this.turn, status: this.status,
      ...(this.winner === undefined ? {} : { winner: this.winner }),
      legalMoves: this.status === "finished" ? [] : this.legalMoves(),
      moveHistory: this.moveHistory.map((move) => ({ ...move })),
      ...(this.moveHistory.length === 0 ? {} : { lastMove: { ...this.moveHistory.at(-1)! } }),
      stateVersion: this.stateVersion, resetEpoch: this.resetEpoch,
      message: this.message(), board: this.board.map((row) => [...row]),
      ...(this.winningLine === undefined ? {} : { winningLine: [...this.winningLine] as ConnectFourGameSnapshot["winningLine"] }),
    };
  }

  play(actor: GameActor, move: string, expectedVersion: number): ConnectFourGameSnapshot {
    if (expectedVersion !== this.stateVersion) throw new GameRuleError("stale_version", "The supplied game version is stale.");
    if (this.status === "finished") throw new GameRuleError("game_finished", "This game has already finished.");
    if (colorOwner(this.playerColor, this.turn) !== actor) throw new GameRuleError("wrong_actor", "This actor does not own the current turn.");
    const parsedMove = this.parseColumn(move);
    if (parsedMove === undefined) throw new GameRuleError("illegal_move", "That move is not legal in the current position.");
    const row = this.dropRow(parsedMove.column);
    if (row === undefined) throw new GameRuleError("illegal_move", "That move is not legal in the current position.");

    const color = this.turn;
    this.board[row][parsedMove.column] = color;
    this.moveHistory.push({ actor, color, notation: parsedMove.notation, ply: this.moveHistory.length + 1 });
    this.stateVersion += 1;
    const winningLine = this.findWinningLine({ row, column: parsedMove.column }, color);
    if (winningLine !== undefined) {
      this.status = "finished";
      this.winner = color;
      this.winningLine = winningLine;
    } else if (this.board.every((boardRow) => boardRow.every((cell) => cell !== null))) {
      this.status = "finished";
      this.winner = "draw";
    } else {
      this.turn = otherColor(color);
    }
    return this.snapshot();
  }

  private parseColumn(move: string): { column: number; notation: ConnectFourColumn } | undefined {
    return isConnectFourColumn(move) ? { column: COLUMNS.indexOf(move), notation: move } : undefined;
  }

  private dropRow(column: number): number | undefined {
    for (let row = ROWS - 1; row >= 0; row -= 1) if (this.board[row][column] === null) return row;
    return undefined;
  }

  private legalMoves(): ConnectFourColumn[] {
    return [...COLUMNS].filter((column, index) => this.board[0][index] === null) as ConnectFourColumn[];
  }

  private formatPoint({ row, column }: Point): ConnectFourCoordinate {
    return `${COLUMNS[column]}${ROWS - row}` as ConnectFourCoordinate;
  }

  private findWinningLine(last: Point, color: StoneColor): [ConnectFourCoordinate, ConnectFourCoordinate, ConnectFourCoordinate, ConnectFourCoordinate] | undefined {
    for (const direction of DIRECTIONS) {
      const points = [last];
      for (const sign of [-1, 1]) {
        let row = last.row + direction.row * sign;
        let column = last.column + direction.column * sign;
        while (row >= 0 && row < ROWS && column >= 0 && column < WIDTH && this.board[row][column] === color) {
          if (sign < 0) points.unshift({ row, column }); else points.push({ row, column });
          row += direction.row * sign;
          column += direction.column * sign;
        }
      }
      if (points.length >= 4) {
        const lastIndex = points.findIndex((point) => point.row === last.row && point.column === last.column);
        const start = Math.max(0, Math.min(lastIndex, points.length - 4));
        return points.slice(start, start + 4).map((point) => this.formatPoint(point)) as [ConnectFourCoordinate, ConnectFourCoordinate, ConnectFourCoordinate, ConnectFourCoordinate];
      }
    }
    return undefined;
  }

  private message(): string {
    if (this.winner === "draw") return "The game is a draw.";
    if (this.winner !== undefined) return `${this.winner === "black" ? "Black" : "White"} wins.`;
    return `${this.turn === "black" ? "Black" : "White"} to move.`;
  }
}
