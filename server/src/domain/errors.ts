export type GameRuleErrorCode =
  | "not_found"
  | "save_incompatible"
  | "store_full"
  | "stale_version"
  | "wrong_actor"
  | "illegal_move"
  | "invalid_position"
  | "import_review_required"
  | "import_review_unavailable"
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
