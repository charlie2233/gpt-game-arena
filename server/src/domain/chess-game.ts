import { Chess, type Color, type PieceSymbol } from "chess.js";

import { GameRuleError } from "./errors.js";
import type {
  ChessCell,
  ChessSquare,
  ChessGameSnapshot,
  GameActor,
  MoveRecord,
  StoneColor,
} from "./types.js";

const UCI_MOVE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

function toStoneColor(color: Color): StoneColor {
  return color === "w" ? "white" : "black";
}

function colorOwner(playerColor: StoneColor, color: StoneColor): GameActor {
  return playerColor === color ? "player" : "gpt";
}

export class ChessGame {
  private readonly chess = new Chess();
  private readonly moveHistory: MoveRecord[] = [];
  private stateVersion = 0;

  private constructor(
    private readonly gameId: string,
    private readonly playerColor: StoneColor,
  ) {}

  static create(gameId: string, playerColor: StoneColor): ChessGame {
    return new ChessGame(gameId, playerColor);
  }

  snapshot(): ChessGameSnapshot {
    const currentTurn = toStoneColor(this.chess.turn());
    const isCheckmate = this.chess.isCheckmate();
    const isDraw = this.chess.isDraw();
    const isGameOver = this.chess.isGameOver();
    const status = isGameOver ? "finished" : "active";
    const winner = isCheckmate
      ? toStoneColor(this.chess.turn() === "w" ? "b" : "w")
      : isDraw
        ? "draw"
        : undefined;

    return {
      gameId: this.gameId,
      kind: "chess",
      playerColor: this.playerColor,
      turn: currentTurn,
      status,
      ...(winner === undefined ? {} : { winner }),
      legalMoves: isGameOver ? [] : this.legalMoves(),
      moveHistory: this.moveHistory.map((move) => ({ ...move })),
      ...(this.moveHistory.length === 0
        ? {}
        : { lastMove: { ...this.moveHistory[this.moveHistory.length - 1] } }),
      stateVersion: this.stateVersion,
      message: this.message(currentTurn, isCheckmate, isDraw, isGameOver),
      board: this.board(),
    };
  }

  play(actor: GameActor, move: string, expectedVersion: number): ChessGameSnapshot {
    if (expectedVersion !== this.stateVersion) {
      throw new GameRuleError("stale_version", "The supplied game version is stale.");
    }

    if (this.chess.isGameOver()) {
      throw new GameRuleError("game_finished", "This game has already finished.");
    }

    const color = toStoneColor(this.chess.turn());
    if (colorOwner(this.playerColor, color) !== actor) {
      throw new GameRuleError("wrong_actor", "This actor does not own the current turn.");
    }

    if (!UCI_MOVE.test(move)) {
      throw new GameRuleError("illegal_move", "Moves must use lowercase UCI notation.");
    }

    const from = move.slice(0, 2);
    const to = move.slice(2, 4);
    const promotion = move.length === 5 ? (move[4] as PieceSymbol) : undefined;

    try {
      this.chess.move({ from, to, promotion });
    } catch {
      throw new GameRuleError("illegal_move", "That move is not legal in the current position.");
    }

    this.moveHistory.push({
      actor,
      color,
      notation: move,
      ply: this.moveHistory.length + 1,
    });
    this.stateVersion += 1;

    return this.snapshot();
  }

  private legalMoves(): string[] {
    return this.chess
      .moves({ verbose: true })
      .map((move) => `${move.from}${move.to}${move.promotion ?? ""}`)
      .sort();
  }

  private board(): ChessCell[] {
    const board: ChessCell[] = [];

    for (let rank = 8; rank >= 1; rank -= 1) {
      for (const file of "abcdefgh") {
        const square = `${file}${rank}` as ChessSquare;
        const piece = this.chess.get(square);
        if (piece) {
          board.push({
            square,
            color: toStoneColor(piece.color),
            piece: piece.type,
          });
        } else {
          board.push({ square });
        }
      }
    }

    return board;
  }

  private message(
    turn: StoneColor,
    isCheckmate: boolean,
    isDraw: boolean,
    isGameOver: boolean,
  ): string {
    if (isCheckmate) {
      return `${turn === "white" ? "Black" : "White"} wins by checkmate.`;
    }
    if (isDraw) {
      return "Game drawn.";
    }
    if (isGameOver) {
      return "Game finished.";
    }
    return `${turn === "white" ? "White" : "Black"} to move.`;
  }
}
