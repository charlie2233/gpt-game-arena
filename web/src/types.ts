export type Color = "white" | "black";
export type GameDifficulty = "easy" | "medium" | "hard";
export type ToolName = "create_game" | "get_game_state" | "play_game_move" | "reset_game" | "render_game";
export type MoveRecord = { actor: "player" | "gpt"; color: Color; notation: string; ply: number };
export type ChessFile = "a" | "b" | "c" | "d" | "e" | "f" | "g" | "h";
export type ChessRank = "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8";
export type ChessSquare = `${ChessFile}${ChessRank}`;
export type ChessPiece = "p" | "n" | "b" | "r" | "q" | "k";
export type ChessCell = { square: ChessSquare; color: Color; piece: ChessPiece } | { square: ChessSquare; color?: never; piece?: never };
export type GoBoardSize = 9 | 13 | 19;
export type BaseSnapshot = { gameId: string; difficulty: GameDifficulty; playerColor: Color; turn: Color; status: "active" | "finished"; winner?: Color | "draw"; legalMoves: string[]; moveHistory: MoveRecord[]; lastMove?: MoveRecord; stateVersion: number; message: string };
export type ChessSnapshot = BaseSnapshot & { kind: "chess"; board: ChessCell[] };
export type GoSnapshot = BaseSnapshot & { kind: "go"; board: (Color | null)[][]; boardSize: GoBoardSize; captures: { black: number; white: number }; consecutivePasses: number; score?: { black: number; white: number; komi: 6.5 } };
export type GameSnapshot = ChessSnapshot | GoSnapshot;
export type ToolResult = { structuredContent?: unknown; content?: { type: string; text: string }[]; isError?: boolean };
export type ToolInput = { create_game: { game: "chess" | "go"; playerColor: Color; difficulty: GameDifficulty; boardSize?: GoBoardSize }; get_game_state: { gameId: string }; play_game_move: { gameId: string; actor: "player" | "gpt"; move: string; expectedVersion: number }; reset_game: { gameId: string }; render_game: { gameId: string } };

declare global {
  interface Window {
    render_game_to_text?: () => string;
    advanceTime?: (milliseconds: number) => void;
  }
}
