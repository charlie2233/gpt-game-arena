export type Color = "white" | "black";
export type GameDifficulty = "easy" | "medium" | "hard";
export type ToolName = "create_game" | "get_game_state" | "play_game_move" | "end_game" | "reset_game" | "render_game";
export type MoveRecord = { actor: "player" | "gpt"; color: Color; notation: string; ply: number };
export type TicTacToeMoveRecord = Omit<MoveRecord, "notation"> & { notation: TicTacToeCoordinate };
export type ConnectFourMoveRecord = Omit<MoveRecord, "notation"> & { notation: ConnectFourColumn };
export type ChessFile = "a" | "b" | "c" | "d" | "e" | "f" | "g" | "h";
export type ChessRank = "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8";
export type ChessSquare = `${ChessFile}${ChessRank}`;
export type ChessPiece = "p" | "n" | "b" | "r" | "q" | "k";
export type ChessCell = { square: ChessSquare; color: Color; piece: ChessPiece } | { square: ChessSquare; color?: never; piece?: never };
export type GoBoardSize = 9 | 13 | 19;
export type TicTacToeCoordinate = `${"A" | "B" | "C"}${1 | 2 | 3}`;
export type ConnectFourColumn = "A" | "B" | "C" | "D" | "E" | "F" | "G";
export type ConnectFourCoordinate = `${ConnectFourColumn}${1 | 2 | 3 | 4 | 5 | 6}`;
export type ReversiCoordinate = `${"A" | "B" | "C" | "D" | "E" | "F" | "G" | "H"}${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}`;
export type Tuple<T, N extends number, R extends T[] = []> = R["length"] extends N ? R : Tuple<T, N, [...R, T]>;
export type Board<Row extends number, Column extends number> = Tuple<Tuple<Color | null, Column>, Row>;
export type BaseSnapshot = { gameId: string; resetEpoch?: number; difficulty: GameDifficulty; playerColor: Color; turn: Color; status: "active" | "finished"; winner?: Color | "draw"; finishReason?: "ended"; legalMoves: string[]; moveHistory: MoveRecord[]; lastMove?: MoveRecord; stateVersion: number; message: string };
export type ChessSnapshot = BaseSnapshot & { kind: "chess"; board: ChessCell[] };
export type GoSnapshot = BaseSnapshot & { kind: "go"; board: (Color | null)[][]; boardSize: GoBoardSize; captures: { black: number; white: number }; consecutivePasses: number; score?: { black: number; white: number; komi: 6.5 } };
export type TicTacToeSnapshot = Omit<BaseSnapshot, "legalMoves" | "moveHistory" | "lastMove"> & { kind: "tic-tac-toe"; board: Board<3, 3>; legalMoves: TicTacToeCoordinate[]; moveHistory: TicTacToeMoveRecord[]; lastMove?: TicTacToeMoveRecord; winningLine?: [TicTacToeCoordinate, TicTacToeCoordinate, TicTacToeCoordinate] };
export type ConnectFourSnapshot = Omit<BaseSnapshot, "legalMoves" | "moveHistory" | "lastMove"> & { kind: "connect-four"; board: Board<6, 7>; legalMoves: ConnectFourColumn[]; moveHistory: ConnectFourMoveRecord[]; lastMove?: ConnectFourMoveRecord; winningLine?: [ConnectFourCoordinate, ConnectFourCoordinate, ConnectFourCoordinate, ConnectFourCoordinate] };
export type ReversiMoveRecord = Omit<MoveRecord, "notation"> & { notation: ReversiCoordinate };
export type ReversiSnapshot = Omit<BaseSnapshot, "legalMoves" | "moveHistory" | "lastMove"> & { kind: "reversi"; board: Board<8, 8>; legalMoves: ReversiCoordinate[]; moveHistory: ReversiMoveRecord[]; lastMove?: ReversiMoveRecord; score: { black: number; white: number } };
export type GameSnapshot = ChessSnapshot | GoSnapshot | TicTacToeSnapshot | ConnectFourSnapshot | ReversiSnapshot;
export type ToolResult = { structuredContent?: unknown; content?: { type: string; text: string }[]; isError?: boolean };
export type ToolInput = { create_game: { game: "chess"; playerColor: Color; difficulty: GameDifficulty; boardSize?: never } | { game: "go"; playerColor: Color; difficulty: GameDifficulty; boardSize?: GoBoardSize } | { game: "tic-tac-toe" | "connect-four" | "reversi"; playerColor: Color; difficulty: GameDifficulty; boardSize?: never }; get_game_state: { gameId: string }; play_game_move: { gameId: string; actor: "player" | "gpt"; move: string; expectedVersion: number; expectedResetEpoch?: number }; end_game: { gameId: string; confirmed: true; expectedVersion: number; expectedResetEpoch: number }; reset_game: { gameId: string }; render_game: { gameId: string } };

declare global {
  interface Window {
    render_game_to_text?: () => string;
    advanceTime?: (milliseconds: number) => void;
  }
}
