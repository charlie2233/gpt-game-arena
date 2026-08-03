# GPT Game Arena

GPT Game Arena is a ChatGPT plugin/MCP app with a standalone preview. It offers seven presets: Chess, Tic-Tac-Toe, Connect Four, Reversi, and Go on 9×9, 13×13, or 19×19 boards. The React widget is a self-contained `web/dist/index.html`; the Node MCP server serves it at `ui://gpt-game-arena/v6/widget.html`, while `/preview` provides the same UI locally.

## Architecture

The server is authoritative for all rules and sessions through five MCP tools: `create_game({ game, playerColor, boardSize?, difficulty? })`, `get_game_state({ gameId })`, `play_game_move({ gameId, actor, move, expectedVersion })`, `reset_game({ gameId })`, and `render_game({ gameId })`. Go accepts `boardSize` 9, 13, or 19 and defaults to 9 when omitted. Difficulty accepts `easy`, `medium`, or `hard` and defaults to `medium`. Each successful tool output has `structuredContent` containing the complete game snapshot.

Moves must be exact `legalMoves` entries: Chess uses long algebraic coordinates such as `e2e4`; Tic-Tac-Toe and Reversi use uppercase squares such as `A1`; Connect Four uses an uppercase column `A`–`G`; and Go uses uppercase coordinates such as `D4` (skipping `I`) or `pass`. Tic-Tac-Toe ends at three in a row; Connect Four applies gravity and ends at four in a row. Reversi flips bracketed discs, automatically skips a side with no legal move, and finishes with the higher disc score. Go uses positional superko and ends after two consecutive passes.

After a player move in ChatGPT, the widget asks GPT via `ui/message` to call `get_game_state`, follow the selected fixed difficulty guidance, choose one exact `legalMoves` entry, then call `play_game_move` as `gpt` using the version from that same fetched state. It polls for the result. The standalone preview uses deterministic difficulty-aware move selection: Easy is casual, Medium preserves the stable baseline, and Hard uses game-aware heuristics for chess, Tic-Tac-Toe, Connect Four, Reversi, and Go. Hard favors tactical or positional moves without claiming calibrated engine strength; Reversi can make consecutive GPT turns when an automatic skip leaves GPT to move again. No `OPENAI_API_KEY` is needed: GPT chooses moves through the host tool loop and the server never calls OpenAI.

`reset_game` is destructive and returns `stateVersion: 0`; treat it as a new epoch/ABA boundary, not a monotonic continuation. Reset preserves the selected game kind, player color, difficulty, and Go board size.

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

## ChatGPT developer setup

Enable Developer mode at **Settings → Security and login → Developer mode**, then open **ChatGPT Plugins → plus** to add the server. Serve or tunnel a public HTTPS endpoint ending in `/mcp`, add the plugin/MCP server in ChatGPT, and refresh metadata whenever tools change. See the official [Plugins quickstart](https://developers.openai.com/plugins/quickstart/) and [Connect ChatGPT deployment guide](https://developers.openai.com/plugins/deploy/connect-chatgpt/). The interaction design was inspired by the [OpenAI Apps SDK examples](https://github.com/openai/openai-apps-sdk-examples), especially Cards Against AI.

## Production and demo limits

This demo uses in-memory sessions (lost on restart), has no authentication or hosted deployment, and has not completed actual ChatGPT host acceptance. Difficulty is guidance for ChatGPT and deterministic heuristics in standalone mode, not calibrated engines or Elo ratings. The web workspace build requires Node >=20.19; the server remains Node 18.18-compatible, and an actual Node 18 built-server smoke is a separate gate. Production needs persistent authenticated storage, distributed quotas, HTTPS, observability, abuse controls, and explicit trusted-proxy configuration before honoring forwarded IP headers.
