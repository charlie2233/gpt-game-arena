import type { GoSnapshot } from "../types";
const columns = "ABCDEFGHJKLMNOPQRST";
function isStarPoint(size: GoSnapshot["boardSize"], row: number, column: number): boolean {
  if (size === 19) return [3, 9, 15].includes(row) && [3, 9, 15].includes(column);
  const edge = size === 13 ? [3, 9] : [2, 6];
  const center = Math.floor(size / 2);
  return (edge.includes(row) && edge.includes(column)) || (row === center && column === center);
}
export function GoBoard({ game, onMove, disabled }: { game: GoSnapshot; onMove: (move: string) => void; disabled: boolean }) {
  const legal = new Set(game.legalMoves);
  const size = game.boardSize;
  const board = <div className={`go-board go-board-${size}`} style={{ gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))` }} role="group" aria-label={`${size} by ${size} Go board`}>{game.board.map((row, r) => row.map((stone, c) => { const point = `${columns[c]}${size-r}`; return <button type="button" key={point} className={`go-point${isStarPoint(size, r, c) ? " star" : ""}`} aria-label={stone ? `${stone} stone at ${point}` : legal.has(point) ? `Play at ${point}, empty, legal move` : `Empty ${point}`} disabled={disabled || !legal.has(point)} onClick={() => onMove(point)}>{stone && <i className={`stone ${stone}`} />}</button>; }))}</div>;
  if (size === 9) return board;
  const hintId = `go-board-pan-hint-${size}`;
  return <div className="go-board-frame"><p className="pan-hint" id={hintId}>Scroll to explore the full {size}×{size} board.</p><div className="go-board-viewport" role="region" aria-label={`${size} by ${size} Go board viewport`} aria-describedby={hintId} tabIndex={0}>{board}</div></div>;
}
