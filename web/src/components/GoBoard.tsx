import type { GoSnapshot } from "../types";
const columns = "ABCDEFGHJ";
export function GoBoard({ game, onMove, disabled }: { game: GoSnapshot; onMove: (move: string) => void; disabled: boolean }) {
  const legal = new Set(game.legalMoves);
  return <div className="go-board" role="group" aria-label="9 by 9 Go board">{game.board.map((row, r) => row.map((stone, c) => { const point = `${columns[c]}${9-r}`; return <button key={point} className="go-point" aria-label={stone ? `${stone} stone at ${point}` : legal.has(point) ? `Play at ${point}, empty, legal move` : `Empty ${point}`} disabled={disabled || !legal.has(point)} onClick={() => onMove(point)}>{stone && <i className={`stone ${stone}`} />}</button>; }))}</div>;
}
