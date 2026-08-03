import type { ConnectFourSnapshot, ReversiSnapshot, TicTacToeSnapshot } from "../types";

const files = "ABCDEFGH";
const coordinate = (row: number, column: number, size: number) => `${files[column]}${size - row}`;
const disk = (color: "black" | "white" | null) => color ? <span className={`stone ${color}`} aria-hidden="true"/> : null;
export function TicTacToeBoard({ game, onMove, disabled }: { game: TicTacToeSnapshot; onMove: (move: string) => void; disabled: boolean }) {
  const legal = new Set(game.legalMoves); const winners = new Set(game.winningLine);
  return <div className="small-board tic-board" role="group" aria-label="Tic-Tac-Toe board">{game.board.flatMap((row, r) => row.map((cell, c) => { const move = coordinate(r, c, 3); return <button key={move} className={winners.has(move as never) ? "winning" : ""} aria-label={`${move}, ${cell === "black" ? "X" : cell === "white" ? "O" : "empty"}${legal.has(move as never) ? ", legal move" : ""}`} disabled={disabled || !legal.has(move as never)} onClick={() => onMove(move)}>{cell === "black" ? "X" : cell === "white" ? "O" : ""}</button>; }))}</div>;
}
export function ReversiBoard({ game, onMove, disabled }: { game: ReversiSnapshot; onMove: (move: string) => void; disabled: boolean }) {
  const legal = new Set(game.legalMoves);
  return <div className="small-board reversi-board" role="group" aria-label="Reversi board">{game.board.flatMap((row, r) => row.map((cell, c) => { const move = coordinate(r, c, 8); const available = legal.has(move as never); return <button key={move} className={available ? "legal" : ""} aria-label={`${move}, ${cell ?? "empty"}${available ? ", legal move" : ""}`} disabled={disabled || !available} onClick={() => onMove(move)}>{disk(cell)}</button>; }))}</div>;
}
export function ConnectFourBoard({ game, onMove, disabled }: { game: ConnectFourSnapshot; onMove: (move: string) => void; disabled: boolean }) {
  const legal = new Set(game.legalMoves); const winners = new Set(game.winningLine);
  return <div className="connect-four-wrap"><div className="connect-actions" role="group" aria-label="Connect Four columns">{[..."ABCDEFG"].map(column => <button key={column} disabled={disabled || !legal.has(column as never)} aria-label={`Drop in column ${column}${legal.has(column as never) ? ", legal move" : ""}`} onClick={() => onMove(column)}>{column}</button>)}</div><div className="connect-board" role="img" aria-label="Connect Four board">{game.board.flatMap((row, r) => row.map((cell, c) => <span key={`${r}-${c}`} className={winners.has(coordinate(r, c, 6) as never) ? "winning" : ""}>{disk(cell)}</span>))}</div></div>;
}
