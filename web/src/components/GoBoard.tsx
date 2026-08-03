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
  const tracks = { gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${size}, minmax(0, 1fr))` };
  const board = <div className={`go-board go-board-${size}`} style={tracks} role="group" aria-label={`${size} by ${size} Go board`}>
    <svg className="go-grid" viewBox={`0 0 ${size} ${size}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
      {Array.from({ length: size }, (_, index) => <g key={index}>
        <line x1={index + 0.5} y1={0.5} x2={index + 0.5} y2={size - 0.5} />
        <line x1={0.5} y1={index + 0.5} x2={size - 0.5} y2={index + 0.5} />
      </g>)}
      {game.board.flatMap((row, r) => row.map((_, c) => isStarPoint(size, r, c) ? <circle key={`${r}-${c}`} cx={c + 0.5} cy={r + 0.5} r={0.11} /> : null))}
    </svg>
    {game.board.map((row, r) => row.map((stone, c) => { const point = `${columns[c]}${size-r}`; return <button type="button" key={point} className="go-point" aria-label={stone ? `${stone} stone at ${point}` : legal.has(point) ? `Play at ${point}, empty, legal move` : `Empty ${point}`} disabled={disabled || !legal.has(point)} onClick={() => onMove(point)}>{stone && <i className={`stone ${stone}`} />}</button>; }))}
  </div>;
  if (size === 9) return board;
  const hintId = `go-board-pan-hint-${size}`;
  return <div className="go-board-frame"><p className="pan-hint" id={hintId}>Scroll to explore the full {size}×{size} board.</p><div className="go-board-viewport" role="region" aria-label={`${size} by ${size} Go board viewport`} aria-describedby={hintId} tabIndex={0}>{board}</div></div>;
}
