Original prompt: also implement select difficuktuy

## Goal (prior difficulty work; historical)

- Add Easy, Medium, and Hard difficulty selection to game creation.
- Preserve difficulty across reset and expose it to the ChatGPT move loop.
- Make standalone GPT move choice meaningfully difficulty-aware.

## TODO

- [x] Audit server and widget contracts.
- [x] Implement server-owned difficulty metadata.
- [x] Add the difficulty chooser and standalone strategies.
- [x] Run tests, browser gameplay verification, and visual review.

## Decisions

- Levels are Easy, Medium, and Hard; omitted difficulty defaults to Medium.
- Difficulty is immutable game metadata, preserved by reset and included in every snapshot.
- Changing difficulty takes effect when Start game creates a new game.
- The widget resource URI moved to v2 for that prior difficulty-only schema change; the current expanded release supersedes it with v3.

## Verification log

- Server domain, REST, MCP, schema, reset, and secret-safe validation checks pass: 64/64 tests.
- Server typecheck, production build, and diff check pass.
- Widget tests pass: 32/32; widget typecheck, production build, and diff check pass.
- In-app browser gameplay passes at 1536×1024 and 320×844. Draft difficulty stays separate from the active game until Start game; reset preserves it; the 320px layout has no horizontal overflow.
- Hard 19×19 Go replied to T1 with S1; Easy 9×9 Go replied to E5 with H8, confirming distinct legal-move strategies in the standalone preview.
- The skill-provided Playwright client smoke passes with a valid `render_game_to_text` snapshot and no reported console errors.
- Independent review led to endgame-aware Go passing, one-time group analysis for Hard 19×19, a bounded dense-board CPU regression, and a readable 12px mobile active-difficulty badge. The follow-up full suite passes 96/96.

## Next release gates

- Historical gate: deploy the then-current v2 widget over public HTTPS and refresh ChatGPT app metadata.
- Run an actual ChatGPT-host smoke test and the documented Node 18 compatibility smoke.

## Add more games

### Objective

- Expand the authoritative game arena to seven accessible presets while retaining one MCP/widget integration surface.

### Completed

- [x] Added and reviewed three authoritative engines: Tic-Tac-Toe, Connect Four, and Reversi.
- [x] Extended create/reset schemas and snapshots for all game kinds, board sizes, and difficulty metadata.
- [x] Made Chess, Tic-Tac-Toe, Connect Four, Reversi, and Go 9×9/13×13/19×19 accessible in the widget.
- [x] Added Easy, Medium, and game-aware Hard strategies.
- [x] Continued GPT turns when Reversi automatic skipping leaves GPT with the next turn.
- [x] Completed server and widget test/review coverage for the expanded arena.

### Key decisions

- Chess creates the player as White; Go, Tic-Tac-Toe, Connect Four, and Reversi create the player as Black, and those four engines are black-first.
- Board moves use each engine's displayed uppercase coordinate format; Chess remains long algebraic coordinates.
- Reversi passes are automatic when the side to move has no legal move; they are not player-entered moves.
- The material widget/schema expansion uses `ui://gpt-game-arena/v3/widget.html` to avoid a stale host cache.

### Current verification evidence

- 92 server tests plus 46 web tests pass: 138 tests total.
- Server and web typechecks, production builds, and scoped diff checks pass.
- In-app browser playthroughs pass for Tic-Tac-Toe, Connect Four, and Reversi on Hard; Easy Tic-Tac-Toe produces a distinct legal reply and reset preserves Easy.
- The skill-provided Playwright client returns a valid `render_game_to_text` snapshot with no console-error artifact.
- A 320×844 Reversi playthrough has zero horizontal overflow or browser errors; Connect Four exposes 7 actions, 6 rows, and 42 square cells after visual correction.

### Pending release gates

- Deploy the v3 widget over public HTTPS and refresh metadata.
- Complete actual hosted ChatGPT acceptance and the separate Node 18 built-server smoke.
