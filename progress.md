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

## Compact responsive boards

### Original prompt

- make the chess plate smaller for those exceeding the screen, kinda like tencent go app u know, the screen is definitely big enough

### Completed

- [x] Reproduced the 1280×720 chess board extending below the browser viewport.
- [x] Added a centered, height-aware board rail capped at 34rem on wide desktops and 26rem in ChatGPT-sized panes.
- [x] Removed forced nested scrolling from 13×13 and 19×19 Go so the full board scales as one overview.
- [x] Added ChatGPT `maxHeight` handling and bumped the widget cache URI to v10.
- [x] Passed 166 automated tests, typecheck, build, a 21-case responsive matrix, and a hosted ChatGPT chess turn with the full 416px board visible (`e2e4`, then GPT `e7e5`, no 502).

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

- 94 server tests plus 47 web tests pass: 141 tests total.
- Server and web typechecks, production builds, and scoped diff checks pass.
- In-app browser playthroughs pass for Tic-Tac-Toe, Connect Four, and Reversi on Hard; Easy Tic-Tac-Toe produces a distinct legal reply and reset preserves Easy.
- The skill-provided Playwright client returns a valid `render_game_to_text` snapshot with no console-error artifact.
- A 320×844 Reversi playthrough has zero horizontal overflow or browser errors; Connect Four exposes 7 actions, 6 rows, and 42 square cells after visual correction.

### Pending release gates

- Deploy the v3 widget over public HTTPS and refresh metadata.
- Complete actual hosted ChatGPT acceptance and the separate Node 18 built-server smoke.

## Fast, confirmed GPT turns

### Original prompts

- make it ezier for gpt to read uz its taking too long for him everytime, ans sometime he didnt place it but he said he placed it
- Let gpt work quicker is whatg i mean
- also everytim gpt thinks anf shit it brings me back to the end of chat convo so i have t scrolll up everytime if i wanna keep playin with gpt try solving that

### Implemented

- [x] Replaced the normal redundant `get_game_state` model round trip with a compact authoritative `FAST_TURN` packet.
- [x] Added difficulty-sized, exact-legal candidate sets with tactical ordering and spatially distributed Go coverage.
- [x] Bound new moves to both `expectedResetEpoch` and `expectedVersion` while preserving cached-widget compatibility.
- [x] Added server-authored `MOVE_CONFIRMED`, definite `MOVE_NOT_APPLIED`, and ambiguous `MOVE_CONFIRMATION_UNKNOWN` result language.
- [x] Switched ChatGPT follow-ups to `sendFollowUpMessage({ scrollToBottom: false })`, with standard `ui/message` fallback for other hosts.
- [x] Reduced the repeated model-facing output schema and bumped the widget cache URI to v11.
- [x] Shortened fallback board reconciliation to start at 750 ms and stop immediately on an explicit move rejection.

### Verification status

- [x] Compact decision tests cover 19×19 payload size, legal/unique caps, spatial variety, and tactical capture retention.
- [x] Bridge tests cover no-scroll delivery, portable fallback, and no duplicate retry after a rejected follow-up.
- [x] App tests cover nonzero epochs, no-scroll completion, authoritative moves outside the shortlist, and immediate failed-move exit.
- [x] Epoch/version race, omitted-epoch-after-reset, explicit receipt, and ambiguous post-commit tests pass in focused server coverage.
- [x] Complete matrix passes: 107 server + 68 web = 175 tests, workspace typecheck, production builds, and `git diff --check`.
- [x] Required web-game client smoke produced a clean screenshot and deterministic text state with no console-error artifact.
- [x] Local 1280×720 Real Go check: the 19×19 board is 416×416, has no horizontal overflow, and completed D16 → K19 in about 0.54 s.
- [x] Hosted ChatGPT v11 check: K9 → K18 landed in board history, and GPT narrated exactly K18 only after the authoritative board update.
- [x] Hosted scroll check: the ChatGPT scroll container stayed at 479 px and the widget top stayed at -73 px while GPT was thinking; after completion it shifted only 35 px and the board remained visible instead of jumping to the conversation end.
- [ ] Replace the temporary `trycloudflare.com` acceptance tunnel with an approved stable deployment before calling the app permanently hosted.
