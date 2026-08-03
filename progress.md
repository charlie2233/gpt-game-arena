Original prompt: also implement select difficuktuy

## Goal

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
- The widget resource URI will move to v2 so ChatGPT does not reuse the prior strict snapshot schema from cache.

## Verification log

- Server domain, REST, MCP, schema, reset, and secret-safe validation checks pass: 64/64 tests.
- Server typecheck, production build, and diff check pass.
- Widget tests pass: 32/32; widget typecheck, production build, and diff check pass.
- In-app browser gameplay passes at 1536×1024 and 320×844. Draft difficulty stays separate from the active game until Start game; reset preserves it; the 320px layout has no horizontal overflow.
- Hard 19×19 Go replied to T1 with S1; Easy 9×9 Go replied to E5 with H8, confirming distinct legal-move strategies in the standalone preview.
- The skill-provided Playwright client smoke passes with a valid `render_game_to_text` snapshot and no reported console errors.
- Independent review led to endgame-aware Go passing, one-time group analysis for Hard 19×19, a bounded dense-board CPU regression, and a readable 12px mobile active-difficulty badge. The follow-up full suite passes 96/96.

## Next release gates

- Deploy the v2 widget over public HTTPS and refresh ChatGPT app metadata.
- Run an actual ChatGPT-host smoke test and the documented Node 18 compatibility smoke.
