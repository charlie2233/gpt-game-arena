export type GameRuleErrorCode =
  | "not_found"
  | "stale_version"
  | "wrong_actor"
  | "illegal_move"
  | "game_finished";

export class GameRuleError extends Error {
  readonly code: GameRuleErrorCode;

  constructor(code: GameRuleErrorCode, message: string) {
    super(message);
    this.name = "GameRuleError";
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
