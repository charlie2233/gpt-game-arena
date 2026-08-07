export type Color = "white" | "black";
export type GameDifficulty = "easy" | "medium" | "hard";
export type ToolName = "create_game" | "import_go_position" | "confirm_imported_go_position" | "get_game_state" | "play_game_move" | "end_game" | "reset_game" | "render_game";
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
export type PoolPocket = "TL" | "TM" | "TR" | "BL" | "BM" | "BR";
export type PoolSafetyZone = "L" | "C" | "R" | "T" | "B";
export type PoolBallId = 1 | 2 | 3 | 8 | 9 | 10 | 11;
export type PoolMove = `POT:${PoolBallId}:${PoolPocket}` | `SAFE:${PoolSafetyZone}`;
export type BasketballMove = "drive" | "pull-up" | "three";
export type Tuple<T, N extends number, R extends T[] = []> = R["length"] extends N ? R : Tuple<T, N, [...R, T]>;
export type Board<Row extends number, Column extends number> = Tuple<Tuple<Color | null, Column>, Row>;
export type BaseSnapshot = { gameId: string; resetEpoch?: number; difficulty: GameDifficulty; playerColor: Color; turn: Color; status: "active" | "finished"; winner?: Color | "draw"; finishReason?: "ended"; legalMoves: string[]; moveHistory: MoveRecord[]; lastMove?: MoveRecord; stateVersion: number; message: string };
export type ChessSnapshot = BaseSnapshot & { kind: "chess"; board: ChessCell[] };
export type GoPositionSetup = { source: "imported"; blackStones: string[]; whiteStones: string[]; turn: Color; captures: { black: number; white: number } };
export type GoSnapshot = BaseSnapshot & { kind: "go"; board: (Color | null)[][]; boardSize: GoBoardSize; initialPosition?: GoPositionSetup; importReview?: "pending" | "confirmed"; captures: { black: number; white: number }; consecutivePasses: number; score?: { black: number; white: number; komi: 6.5 } };
export type TicTacToeSnapshot = Omit<BaseSnapshot, "legalMoves" | "moveHistory" | "lastMove"> & { kind: "tic-tac-toe"; board: Board<3, 3>; legalMoves: TicTacToeCoordinate[]; moveHistory: TicTacToeMoveRecord[]; lastMove?: TicTacToeMoveRecord; winningLine?: [TicTacToeCoordinate, TicTacToeCoordinate, TicTacToeCoordinate] };
export type ConnectFourSnapshot = Omit<BaseSnapshot, "legalMoves" | "moveHistory" | "lastMove"> & { kind: "connect-four"; board: Board<6, 7>; legalMoves: ConnectFourColumn[]; moveHistory: ConnectFourMoveRecord[]; lastMove?: ConnectFourMoveRecord; winningLine?: [ConnectFourCoordinate, ConnectFourCoordinate, ConnectFourCoordinate, ConnectFourCoordinate] };
export type ReversiMoveRecord = Omit<MoveRecord, "notation"> & { notation: ReversiCoordinate };
export type ReversiSnapshot = Omit<BaseSnapshot, "legalMoves" | "moveHistory" | "lastMove"> & { kind: "reversi"; board: Board<8, 8>; legalMoves: ReversiCoordinate[]; moveHistory: ReversiMoveRecord[]; lastMove?: ReversiMoveRecord; score: { black: number; white: number } };
export type PoolMoveRecord = Omit<MoveRecord, "notation"> & { notation: PoolMove };
export type PoolBall = { id: PoolBallId; group: "solids" | "stripes" | "eight"; x: number; y: number };
export type PoolSnapshot = Omit<BaseSnapshot, "legalMoves" | "moveHistory" | "lastMove"> & { kind: "pool"; cueBall: { x: number; y: number }; balls: PoolBall[]; legalMoves: PoolMove[]; moveHistory: PoolMoveRecord[]; lastMove?: PoolMoveRecord };
export type BasketballMoveRecord = Omit<MoveRecord, "notation"> & { notation: BasketballMove };
export type ShotOption = { move: BasketballMove; points: 2 | 3; energyCost: 0 | 1 | 2; accuracy: number };
export type ShotResult = { ply: number; actor: "player" | "gpt"; color: Color; move: BasketballMove; made: boolean; points: 0 | 2 | 3; accuracy: number };
export type BasketballSnapshot = Omit<BaseSnapshot, "legalMoves" | "moveHistory" | "lastMove"> & { kind: "basketball"; legalMoves: BasketballMove[]; moveHistory: BasketballMoveRecord[]; lastMove?: BasketballMoveRecord; score: { black: number; white: number }; energy: { black: number; white: number }; streak: { black: number; white: number }; attempts: { black: number; white: number }; phase: "regulation" | "overtime"; round: number; shotOptions: ShotOption[]; shotResults: ShotResult[] };
export type GameSnapshot = ChessSnapshot | GoSnapshot | TicTacToeSnapshot | ConnectFourSnapshot | ReversiSnapshot | PoolSnapshot | BasketballSnapshot;
export type ToolResult = { structuredContent?: unknown; content?: { type: string; text: string }[]; isError?: boolean };
export type ToolInput = {
  create_game: { game: "chess"; playerColor: Color; difficulty: GameDifficulty; boardSize?: never } | { game: "go"; playerColor: Color; difficulty: GameDifficulty; boardSize?: GoBoardSize } | { game: "tic-tac-toe" | "connect-four" | "reversi" | "pool" | "basketball"; playerColor: Color; difficulty: GameDifficulty; boardSize?: never };
  import_go_position: { boardSize: GoBoardSize; playerColor: Color; turn: Color; blackStones: string[]; whiteStones: string[]; captures?: { black: number; white: number }; difficulty?: GameDifficulty };
  confirm_imported_go_position: { gameId: string; expectedVersion: number; expectedResetEpoch: number };
  get_game_state: { gameId: string };
  play_game_move: { gameId: string; actor: "player" | "gpt"; move: string; expectedVersion: number; expectedResetEpoch?: number };
  end_game: { gameId: string; confirmed: true; expectedVersion: number; expectedResetEpoch: number };
  reset_game: { gameId: string; confirmed: true; expectedVersion: number; expectedResetEpoch: number };
  render_game: { gameId: string };
};

declare global {
  interface Window {
    render_game_to_text?: () => string;
    advanceTime?: (milliseconds: number) => void;
  }
}
