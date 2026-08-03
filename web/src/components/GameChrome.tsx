import type { GameSnapshot } from "../types";
export function GameChrome({ game }: { game: GameSnapshot }) {
  const mine = game.turn === game.playerColor && game.status === "active";
  return <><section className="roles" aria-label="Game roles"><div><span className="token player-token">{game.playerColor === "white" ? "♟" : "♙"}</span><strong>You are {title(game.playerColor)}</strong></div><div className="turn" aria-live="polite"><i className={mine ? "dot mine" : "dot"}/><b>{game.status === "finished" ? "Game finished" : mine ? "Your turn" : "GPT thinking…"}</b><span>{game.message}</span></div><div><span className="token gpt-token">{game.playerColor === "white" ? "♙" : "♟"}</span><strong>GPT is {title(other(game.playerColor))}</strong></div></section><aside className="history"><h2>Move history</h2><ol>{game.moveHistory.map(move => <li key={move.ply}><span>{move.ply % 2 ? `${Math.ceil(move.ply/2)}.` : `${Math.ceil(move.ply/2)}…`}</span>{move.notation}</li>)}</ol></aside></>;
}
function title(color: string) { return color[0].toUpperCase() + color.slice(1); }
function other(color: "white" | "black") { return color === "white" ? "black" : "white"; }
