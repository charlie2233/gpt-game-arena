# GPT Game Arena

GPT Game Arena is a ChatGPT plugin/MCP app with a standalone preview. It lets a player and GPT take turns in chess or 9×9 Go. The React widget is a self-contained `web/dist/index.html`; the Node MCP server serves it at `ui://gpt-game-arena/v1/widget.html`, while `/preview` provides the same UI locally.

## Architecture

The server is authoritative for all rules and sessions. The widget uses five tools: `create_game({ game, playerColor })`, `get_game_state({ gameId })`, `play_game_move({ gameId, actor, move, expectedVersion })`, `reset_game({ gameId })`, and `render_game({ gameId })`. Each successful tool output has `structuredContent` containing the complete game snapshot.

After a player move in ChatGPT, the widget asks GPT via `ui/message` to call `get_game_state`, choose one exact `legalMoves` entry, then call `play_game_move` as `gpt` using that state version. It polls for the result. The standalone preview instead picks the stable sorted middle legal move, preferring a non-pass. No `OPENAI_API_KEY` is needed: GPT chooses moves through the host tool loop and the server never calls OpenAI.

`reset_game` is destructive and returns `stateVersion: 0`; treat it as a new epoch/ABA boundary, not a monotonic continuation.

## Local commands

```sh
npm install       # or npm ci
npm test
npm run typecheck
npm run build
npm run dev       # Node server, then visit /preview
npm run dev:web   # Vite widget development
npm run preview   # Vite built-widget preview
```

For MCP Inspector, build first, start `npm run dev`, and connect the inspector to `http://localhost:8000/mcp` using Streamable HTTP.

## ChatGPT developer setup

Enable Developer mode at **Settings → Security → Developer mode**, then use a ChatGPT plan with Plugins support. Serve or tunnel a public HTTPS endpoint ending in `/mcp`, add the plugin/MCP server in ChatGPT, and refresh metadata whenever tools change. See the official [Plugins quickstart](https://developers.openai.com/plugins/quickstart/) and [Connect ChatGPT deployment guide](https://developers.openai.com/plugins/deploy/connect-chatgpt/). The interaction design was inspired by the [OpenAI Apps SDK examples](https://github.com/openai/openai-apps-sdk-examples), especially Cards Against AI.

## Production and demo limits

This demo uses in-memory sessions (lost on restart), has no authentication or hosted deployment, and has not completed actual ChatGPT host acceptance. It currently runs in the local Node environment; an actual Node 18 runtime smoke is a separate gate if unavailable. Production needs persistent authenticated storage, distributed quotas, HTTPS, observability, abuse controls, and explicit trusted-proxy configuration before honoring forwarded IP headers.
