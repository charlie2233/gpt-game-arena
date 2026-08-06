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

## Authoritative End Game

### Original prompt

- add a endgame button

### Implemented

- [x] Added a dedicated `end_game` tool requiring explicit confirmation plus the exact reset epoch and state version.
- [x] Added a two-step inline confirmation (`Keep playing` / `End game`) that locks outside controls, traps keyboard focus, and never changes the board optimistically.
- [x] Preserved the board and move history while freezing the authoritative game with `finishReason: "ended"` and `Game ended.`
- [x] Persisted one terminal end event so an ended game stays ended after a server restart.
- [x] Added one-read recovery for an ambiguous end receipt without ever repeating the mutation.
- [x] Kept End Game available during GPT polling so a slow or stuck GPT turn can still be stopped.
- [x] Kept Reset, Refresh, and New Game available after ending; controls wrap into a compact mobile grid.
- [x] Bumped the widget cache URI to v12 and registered accurate destructive tool annotations.
- [x] Kept the v11 resource readable so historical ChatGPT boards continue loading after the v12 cache bump.

### Verification status

- [x] Full automated matrix passes: 113 server + 76 web = 189 tests.
- [x] Workspace typecheck, production builds, and `git diff --check` pass.
- [x] The skill-provided 1280x720 browser interaction shows the full board, confirmation copy, and both confirmation actions with no console-error artifact.
- [x] Hosted ChatGPT v12 acceptance passed through the v13 developer connection: cancel left a fresh game active; one confirmed end survived reload as `Game ended.` with every square disabled and Reset/Refresh available.
- [x] Hosted compatibility check passed: the historical v11 Go board loaded again after the legacy resource was restored instead of showing `Failed to fetch template`.
- [ ] Replace the temporary `trycloudflare.com` acceptance tunnel with an approved stable deployment before calling this update permanently hosted.

### Separate Go-strength diagnosis

- Medium 19×19 Go currently sorts legal coordinates as strings and recommends the midpoint. That exactly reproduces the screenshot sequence `K19, K18, K2, K3, K17` and explains the weak vertical white shape.
- Replacing the Medium Go selector with positional/tactical scoring is a separate follow-up; End Game does not change move strength.

## Game-aware AI search

### Original prompts

- he still actin stupid wth ;et hiom think in go, then let me playbagain
- bro let him be smarter on all games he kinda stupid wth
- moret think thean prompt bro

### Implemented

- [x] Removed every Medium sorted-midpoint choice and routed Medium through game-aware evaluation.
- [x] Added complete Hard Tic-Tac-Toe minimax, fixed-depth alpha-beta search for Connect Four, and mobility/positional alpha-beta search for Reversi.
- [x] Added real `chess.js` position replay plus bounded two-ply Medium and three-ply Hard Chess search, with the existing static evaluator as a safe fallback for synthetic snapshots.
- [x] Reworked sparse Go openings to prioritize unclaimed corner anchors, whole-board spacing, and third/fourth-line play while retaining capture, atari rescue, self-atari, eye-fill, and pass safeguards.
- [x] Removed weak lexicographic Go fillers from Medium/Hard FAST_TURN shortlists.
- [x] Kept the prompt compact and receipt-gated; game-specific text now supports the actual engines without treating candidate order as a verdict.
- [x] Bumped the final widget cache URI to v14 while retaining v13, v12, and v11 compatibility resources.

### Verification status

- [x] Focused strategy suite passes 23/23, including Chess mate and opening-latency limits, Tic-Tac-Toe fork defense, Connect Four support-blunder defense, exact forced-pass Reversi endgames, and the reproduced 19×19 Go edge-ladder regression.
- [x] Hard Chess uses independent bounded root budgets: ordinary openings measured around 0.3–0.7 s in review, while the automated opening regression stays below 2 s.
- [x] Full automated matrix passes: 113 server + 86 web = 199 tests; workspace typecheck, production builds, and `git diff --check` pass.
- [x] The required browser game client produced final screenshots and deterministic text state with no error artifact; the 1280×720 Chess board and controls remain fully visible.
- [x] Hosted ChatGPT acceptance passed after refreshing the developer connection to the new engine: Black `D16` received the confirmed Hard reply `D4` in the opposite open corner, replacing the stale v12 `D10` behavior; final handoff uses the v14 cache URI.
- [x] The hosted board was reset after acceptance and left as a fresh empty Hard 19×19 game with the user to move as Black.
- [ ] Replace the temporary `trycloudflare.com` acceptance tunnel with an approved stable deployment before calling this update permanently hosted.
