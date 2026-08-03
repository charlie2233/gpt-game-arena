# GPT Game Arena

GPT Game Arena is a ChatGPT plugin/MCP app with a standalone preview. It lets a player and GPT take turns in chess, Quick Go (9×9), Go (13×13), or full-board “Real Go” (19×19). The React widget is a self-contained `web/dist/index.html`; the Node MCP server serves it at `ui://gpt-game-arena/v1/widget.html`, while `/preview` provides the same UI locally.

## Architecture

The server is authoritative for all rules and sessions. The widget uses five tools: `create_game({ game, playerColor, boardSize? })`, `get_game_state({ gameId })`, `play_game_move({ gameId, actor, move, expectedVersion })`, `reset_game({ gameId })`, and `render_game({ gameId })`. Go accepts `boardSize` 9, 13, or 19 and defaults to 9 when omitted. Each successful tool output has `structuredContent` containing the complete game snapshot.

After a player move in ChatGPT, the widget asks GPT via `ui/message` to call `get_game_state`, choose one exact `legalMoves` entry, then call `play_game_move` as `gpt` using that state version. It polls for the result. The standalone preview instead picks the stable sorted middle legal move, preferring a non-pass. No `OPENAI_API_KEY` is needed: GPT chooses moves through the host tool loop and the server never calls OpenAI.

`reset_game` is destructive and returns `stateVersion: 0`; treat it as a new epoch/ABA boundary, not a monotonic continuation. Reset preserves the selected game kind, player color, and Go board size.

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

This demo uses in-memory sessions (lost on restart), has no authentication or hosted deployment, and has not completed actual ChatGPT host acceptance. The web workspace build requires Node >=20.19; the server remains Node 18.18-compatible, and an actual Node 18 built-server smoke is a separate gate. Production needs persistent authenticated storage, distributed quotas, HTTPS, observability, abuse controls, and explicit trusted-proxy configuration before honoring forwarded IP headers.
