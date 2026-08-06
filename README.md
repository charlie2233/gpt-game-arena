# GPT Game Arena

GPT Game Arena is a ChatGPT plugin/MCP app with a standalone preview. It offers seven presets: Chess, Tic-Tac-Toe, Connect Four, Reversi, and Go on 9×9, 13×13, or 19×19 boards. The React widget is a self-contained `web/dist/index.html`; the Node MCP server serves the current widget at `ui://gpt-game-arena/v14/widget.html` and retains the v13, v12, and v11 resources for historical chats, while `/preview` provides the same UI locally.

## Architecture

The server is authoritative for all rules and sessions through six MCP tools: `create_game({ game, playerColor, boardSize?, difficulty? })`, `get_game_state({ gameId })`, `play_game_move({ gameId, actor, move, expectedVersion, expectedResetEpoch? })`, `end_game({ gameId, confirmed: true, expectedVersion, expectedResetEpoch })`, `reset_game({ gameId })`, and `render_game({ gameId })`. Go accepts `boardSize` 9, 13, or 19 and defaults to 9 when omitted. Difficulty accepts `easy`, `medium`, or `hard` and defaults to `medium`. Each successful tool output has `structuredContent` containing the complete game snapshot, including a `resetEpoch` that starts at 0. New clients send both reset epoch and version so a delayed pre-reset mutation cannot land on a fresh board. For cached older widgets, an omitted move epoch is treated only as epoch 0, so it fails safely after any reset.

Moves must be exact `legalMoves` entries: Chess uses long algebraic coordinates such as `e2e4`; Tic-Tac-Toe and Reversi use uppercase squares such as `A1`; Connect Four uses an uppercase column `A`–`G`; and Go uses uppercase coordinates such as `D4` (skipping `I`) or `pass`. Tic-Tac-Toe ends at three in a row; Connect Four applies gravity and ends at four in a row. Reversi flips bracketed discs, automatically skips a side with no legal move, and finishes with the higher disc score. Go uses positional superko and ends after two consecutive passes.

After a successful player move in ChatGPT, the widget sends GPT a lossless compact board plus a deterministic, exact-legal candidate set capped at 8/16/32 moves for Easy/Medium/Hard. GPT calls `play_game_move` directly with the authoritative `resetEpoch` and `stateVersion`; it does not perform the old redundant full-state read during a normal turn. Candidate order comes from the local game engine, but the bounded alternatives let GPT compare the position instead of treating that order as a verdict. A move is presented as successful only after a matching server-authored `MOVE_CONFIRMED` receipt or an exact read-only reconciliation. Rule failures return `MOVE_NOT_APPLIED`; transport or internal ambiguity returns `MOVE_CONFIRMATION_UNKNOWN`, which must never trigger a repeated mutation. ChatGPT follow-ups request `scrollToBottom: false`, and tool-result notifications are preferred over fallback polling that starts after 750 ms and backs off to 2.5 seconds.

The standalone preview uses the same deterministic difficulty-aware move engine. Easy stays casual. Medium performs game-aware tactical and positional evaluation. Hard uses complete Tic-Tac-Toe minimax, fixed-depth alpha-beta for Connect Four, mobility-aware alpha-beta plus exact small Reversi endgames, and bounded three-ply Chess search reconstructed with `chess.js`; Go combines capture/liberty simulation with self-atari, eye-fill, spacing, corner/side development, and whole-board balance. These are bounded interactive engines rather than calibrated Elo-strength opponents. Reversi can make consecutive GPT turns when an automatic skip leaves GPT to move again. No `OPENAI_API_KEY` is needed: GPT chooses and submits moves through the host tool loop and the server never calls OpenAI.

`reset_game` is destructive, increments `resetEpoch`, and returns `stateVersion: 0`; the pair `(resetEpoch, stateVersion)` identifies a position without reset/ABA ambiguity. Reset preserves the game ID, selected game kind, player color, difficulty, and Go board size.

`end_game` is destructive and runs only after the widget's explicit two-step confirmation. It preserves the board and history, records a persisted terminal end event, returns `finishReason: "ended"` with `Game ended.`, and increments `stateVersion` once. A definite refusal returns `END_NOT_APPLIED`; a lost or ambiguous response triggers exactly one read-only state reconciliation and never repeats the end mutation.

The Go engine uses positional superko, two-pass completion, and simplified Chinese-area scoring with 6.5 komi on every board size. The 19×19 preset is the full standard board, but this demo does not include a tournament dead-stone agreement phase after passing.

## Local commands

```sh
npm install       # or npm ci (Node >=20.19 for this workspace build)
npm test
npm run typecheck
npm run build
npm run dev       # Node server, then visit /preview
npm run dev:web   # Vite widget development; run npm run dev:server alongside it
npm run preview   # Vite built-widget preview; run npm run dev:server alongside it
```

For MCP Inspector, build first, start `npm run dev`, and connect the inspector to `http://localhost:8000/mcp` using Streamable HTTP.

The Node server persists sessions to the versioned JSON move log at `.data/game-sessions.json` by default. Set `GAME_STORE_PATH` to an absolute path, or to a path relative to the server process working directory, to override it. Writes use a temporary file in the same directory followed by an atomic rename. The server fails startup if an existing file has invalid JSON, an unknown format version, invalid metadata, duplicate IDs, or an active move history that the rules engine cannot replay; expired histories are ignored.

## ChatGPT developer setup

Enable Developer mode at **Settings → Security and login → Developer mode**, then open **ChatGPT Plugins → plus** to add the server. Serve or tunnel a public HTTPS endpoint ending in `/mcp`, add the plugin/MCP server in ChatGPT, and refresh metadata whenever tools change. See the official [Plugins quickstart](https://developers.openai.com/plugins/quickstart/) and [Connect ChatGPT deployment guide](https://developers.openai.com/plugins/deploy/connect-chatgpt/). The interaction design was inspired by the [OpenAI Apps SDK examples](https://github.com/openai/openai-apps-sdk-examples), especially Cards Against AI.

## Production and demo limits

The local JSON event log survives restarts of one server on one machine, but it is intentionally a single-process store: it provides no file locking, multi-instance coordination, remote durability, backup policy, or authenticated ownership. Temporary-tunnel ChatGPT acceptance has been completed, but there is no stable hosted deployment. Difficulty combines bounded local search with GPT's private comparison, not calibrated Elo ratings. The web workspace build requires Node >=20.19; the server remains Node 18.18-compatible, and an actual Node 18 built-server smoke is a separate gate. Production needs persistent authenticated storage, distributed quotas, HTTPS, observability, abuse controls, and explicit trusted-proxy configuration before honoring forwarded IP headers.
