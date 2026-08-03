import type { ChessSnapshot, ChessSquare } from "../types";

const files = "abcdefgh";
const glyph: Record<string, string> = { wp: "♙", wn: "♘", wb: "♗", wr: "♖", wq: "♕", wk: "♔", bp: "♟", bn: "♞", bb: "♝", br: "♜", bq: "♛", bk: "♚" };
export function ChessBoard({ game, selected, onSquare, disabled }: { game: ChessSnapshot; selected?: string; onSquare: (square: string) => void; disabled: boolean }) {
  const cells = new Map(game.board.map(cell => [cell.square, cell]));
  const legalFrom = new Set(game.legalMoves.map(move => move.slice(0, 2)));
  const destinations = selected ? new Set(game.legalMoves.filter(move => move.startsWith(selected)).map(move => move.slice(2, 4))) : new Set<string>();
  return <div className="board-wrap"><div className="files top" aria-hidden="true">{[...files].map(f => <span key={f}>{f}</span>)}</div><div className="chess-board" role="group" aria-label="Chess board">
    {Array.from({ length: 8 }, (_, row) => Array.from({ length: 8 }, (_, col) => {
      const square = `${files[col]}${8 - row}` as ChessSquare; const cell = cells.get(square); const key = cell?.color && cell.piece ? `${cell.color[0]}${cell.piece}` : "";
      const piece = key ? glyph[key] : ""; const canSelect = game.turn === game.playerColor && legalFrom.has(square); const destination = destinations.has(square);
      const names: Record<string, string> = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" }; const label = piece ? `${cell!.color} ${names[cell!.piece!]} on ${square}${selected === square ? ", selected source" : ""}${canSelect ? ", movable source" : ""}${destination ? ", legal destination" : ""}` : `empty ${square}${destination ? ", legal destination" : ""}`;
      return <button key={square} className={`square ${(row + col) % 2 ? "dark" : "light"} ${selected === square ? "selected" : ""} ${destination ? "destination" : ""}`} aria-label={label} disabled={disabled || (!canSelect && !destination)} onClick={() => onSquare(square)}>{piece}</button>;
    }))}</div><div className="files bottom" aria-hidden="true">{[...files].map(f => <span key={f}>{f}</span>)}</div></div>;
}
