# GPT Game Arena Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a web-first ChatGPT plugin where a player can play chess or 9x9 Go against GPT in a responsive in-chat board, with a standalone browser fallback.

**Architecture:** Use the `interactive-decoupled` Apps SDK archetype. A TypeScript MCP server owns all authoritative game state and exposes focused create/read/move/render/reset tools; a React widget stays mounted, calls tools through the MCP Apps bridge, asks GPT to take its turn through `ui/message`, and polls the read tool for the resulting state version. The same widget runs at `/preview`, where a deterministic legal-move fallback replaces GPT so the UI is testable without ChatGPT or an OpenAI API key.

**Tech Stack:** Node.js 18+, TypeScript, npm workspaces, Express 5, MCP TypeScript SDK, `@modelcontextprotocol/ext-apps`, Zod, `chess.js`, React 18, Vite, Vitest, Testing Library, Supertest.

---

## App contract

### Primary flows

1. A user asks ChatGPT to start chess or Go.
2. ChatGPT calls `create_game`, then `render_game` with the returned `gameId`.
3. The widget sends a player move through `play_game_move`.
4. The widget sends a `ui/message` asking GPT to inspect the game and submit one legal reply with `actor: "gpt"`.
5. The widget polls `get_game_state` until `stateVersion` increases, then redraws without remounting.
6. In `/preview`, the widget instead chooses one deterministic legal fallback move so the complete turn loop is locally testable.

### Tool plan

| Tool | Intent | Side effects | UI visibility |
| --- | --- | --- | --- |
| `create_game` | Start chess or 9x9 Go with a chosen player color | Creates in-memory state | model + app |
| `get_game_state` | Read the authoritative snapshot and legal moves | None | model + app |
| `play_game_move` | Apply exactly one player or GPT move at an expected version | Mutates one game | model + app |
| `reset_game` | Reset an existing game with the same kind and player color | Replaces one game state | model + app |
| `render_game` | Render a previously created game in the board widget | None | model |

### File map

```text
.
├── .env.example
├── .gitignore
├── README.md
├── package.json
├── tsconfig.base.json
├── server
│   ├── package.json
│   ├── tsconfig.json
│   ├── src
│   │   ├── domain
│   │   │   ├── chess-game.ts
│   │   │   ├── errors.ts
│   │   │   ├── go-game.ts
│   │   │   └── types.ts
│   │   ├── game-store.ts
│   │   ├── http-app.ts
│   │   ├── index.ts
│   │   ├── mcp-server.ts
│   │   └── tool-service.ts
│   └── tests
│       ├── chess-game.test.ts
│       ├── go-game.test.ts
│       ├── http-app.test.ts
│       ├── mcp-server.test.ts
│       └── tool-service.test.ts
└── web
    ├── index.html
    ├── package.json
    ├── tsconfig.json
    ├── vite.config.ts
    └── src
        ├── App.test.tsx
        ├── App.tsx
        ├── bridge.test.ts
        ├── bridge.ts
        ├── components
        │   ├── ChessBoard.tsx
        │   ├── GameChrome.tsx
        │   └── GoBoard.tsx
        ├── game-client.ts
        ├── main.tsx
        ├── styles.css
        ├── test-setup.ts
        └── types.ts
```

## Task 1: Workspace foundation, shared state, and chess rules

**Files:**
- Create: `.gitignore`
- Create: `.env.example`
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `server/package.json`
- Create: `server/tsconfig.json`
- Create: `server/src/domain/types.ts`
- Create: `server/src/domain/errors.ts`
- Create: `server/src/domain/chess-game.ts`
- Create: `server/src/game-store.ts`
- Create: `server/tests/chess-game.test.ts`

- [ ] **Step 1: Add the workspace manifests**

Create npm workspaces named `server` and `web`. Root scripts must be exactly usable as `npm run build`, `npm run typecheck`, and `npm test`; add `dev`, `dev:server`, and `dev:web` without requiring a global package manager. The server package must include `@modelcontextprotocol/ext-apps`, `@modelcontextprotocol/sdk`, `chess.js`, `express`, and `zod`; use Vitest and TypeScript as development dependencies. Ignore `node_modules`, `dist`, `.env`, `.env.local`, coverage, and macOS metadata. `.env.example` must define `PORT=8000` and `PUBLIC_BASE_URL=http://localhost:8000` and must not contain a credential.

- [ ] **Step 2: Write the failing chess behavior tests**

Create `server/tests/chess-game.test.ts` with real `ChessGame` instances that prove:

```ts
it("starts with twenty legal white moves and version zero", () => {
  const game = ChessGame.create("game-1", "white");
  const state = game.snapshot();
  expect(state.kind).toBe("chess");
  expect(state.turn).toBe("white");
  expect(state.legalMoves).toHaveLength(20);
  expect(state.stateVersion).toBe(0);
});

it("applies UCI moves only for the actor whose color owns the turn", () => {
  const game = ChessGame.create("game-1", "white");
  expect(game.play("player", "e2e4", 0).lastMove?.notation).toBe("e2e4");
  expect(game.play("gpt", "e7e5", 1).turn).toBe("white");
});

it("rejects a stale version without mutating the board", () => {
  const game = ChessGame.create("game-1", "white");
  game.play("player", "e2e4", 0);
  expect(() => game.play("gpt", "e7e5", 0)).toThrowError(GameRuleError);
  expect(game.snapshot().stateVersion).toBe(1);
});

it("reports checkmate and the winner after fools mate", () => {
  const game = ChessGame.create("game-1", "white");
  game.play("player", "f2f3", 0);
  game.play("gpt", "e7e5", 1);
  game.play("player", "g2g4", 2);
  const state = game.play("gpt", "d8h4", 3);
  expect(state.status).toBe("finished");
  expect(state.winner).toBe("black");
});
```

- [ ] **Step 3: Run the chess tests and verify RED**

Run `npm install`, then `npm run test --workspace server -- chess-game.test.ts`. The expected failure is an unresolved `ChessGame`/domain module because production chess code does not exist yet.

- [ ] **Step 4: Implement the shared contracts and chess engine**

Define these stable public contracts in `server/src/domain/types.ts`:

```ts
export type GameKind = "chess" | "go";
export type StoneColor = "white" | "black";
export type GameActor = "player" | "gpt";
export type GameStatus = "active" | "finished";

export interface MoveRecord {
  actor: GameActor;
  color: StoneColor;
  notation: string;
  ply: number;
}

export interface BaseGameSnapshot {
  gameId: string;
  kind: GameKind;
  playerColor: StoneColor;
  turn: StoneColor;
  status: GameStatus;
  winner?: StoneColor | "draw";
  legalMoves: string[];
  moveHistory: MoveRecord[];
  lastMove?: MoveRecord;
  stateVersion: number;
  message: string;
}
```

Add discriminated `ChessGameSnapshot`, `GoGameSnapshot`, and `GameSnapshot` types. Chess cells must expose square, piece color, and lowercase piece code. `GameRuleError` must include a stable code from `not_found`, `stale_version`, `wrong_actor`, `illegal_move`, or `game_finished`.

Implement `ChessGame.create(gameId, playerColor)`, `snapshot()`, and `play(actor, move, expectedVersion)` using `chess.js`. Accept lowercase UCI notation with optional promotion (`e7e8q`), derive actor ownership from `playerColor` and current turn, reject stale calls before all other mutation, increment `stateVersion` once per legal move, and return a complete snapshot. Legal moves must be sorted UCI strings. Detect checkmate, draw, and game over without inventing chess rules.

- [ ] **Step 5: Add the in-memory store**

Implement `GameStore` with `put`, `get`, and `replace` methods over `Map<string, GameSession>`. `get` must throw `GameRuleError("not_found", ...)`. The `GameSession` interface must be the common `snapshot()`/`play()` contract implemented by both games.

- [ ] **Step 6: Run tests and typecheck GREEN**

Run `npm run test --workspace server -- chess-game.test.ts` and `npm run typecheck --workspace server`. Expected: all chess tests pass and TypeScript exits zero.

- [ ] **Step 7: Commit**

```bash
git add .gitignore .env.example package.json tsconfig.base.json server
git commit -m "feat: add chess game domain"
```

## Task 2: 9x9 Go rules and unified game service

**Files:**
- Create: `server/src/domain/go-game.ts`
- Create: `server/src/tool-service.ts`
- Create: `server/tests/go-game.test.ts`
- Create: `server/tests/tool-service.test.ts`
- Modify: `server/src/domain/types.ts`
- Modify: `server/src/game-store.ts`

- [ ] **Step 1: Write failing Go rule tests**

Create `server/tests/go-game.test.ts` covering all of the following with real moves:

```ts
it("starts a 9x9 board with black to move and pass available", () => {
  const state = GoGame.create("go-1", "black").snapshot();
  expect(state.board).toHaveLength(9);
  expect(state.board.flat().every((point) => point === null)).toBe(true);
  expect(state.turn).toBe("black");
  expect(state.legalMoves).toContain("pass");
});

it("captures a surrounded stone", () => {
  const game = GoGame.create("go-1", "black");
  game.play("player", "B2", 0);
  game.play("gpt", "A2", 1);
  game.play("player", "J9", 2);
  game.play("gpt", "B1", 3);
  game.play("player", "J8", 4);
  game.play("gpt", "B3", 5);
  game.play("player", "J7", 6);
  const state = game.play("gpt", "C2", 7);
  expect(state.board[7][1]).toBeNull();
  expect(state.captures.white).toBe(1);
});

it("rejects suicide and positional repetition", () => {
  const suicide = GoGame.create("suicide", "black");
  suicide.play("player", "J9", 0);
  suicide.play("gpt", "A2", 1);
  suicide.play("player", "J8", 2);
  suicide.play("gpt", "B1", 3);
  suicide.play("player", "J7", 4);
  suicide.play("gpt", "B3", 5);
  suicide.play("player", "J6", 6);
  suicide.play("gpt", "C2", 7);
  expect(() => suicide.play("player", "B2", 8)).toThrowError(GameRuleError);
  expect(suicide.snapshot().stateVersion).toBe(8);

  const ko = GoGame.create("ko", "black");
  ko.play("player", "C4", 0);
  ko.play("gpt", "D4", 1);
  ko.play("player", "D5", 2);
  ko.play("gpt", "C3", 3);
  ko.play("player", "E4", 4);
  ko.play("gpt", "E3", 5);
  ko.play("player", "J9", 6);
  ko.play("gpt", "D2", 7);
  ko.play("player", "D3", 8);
  expect(() => ko.play("gpt", "D4", 9)).toThrowError(GameRuleError);
  expect(ko.snapshot().stateVersion).toBe(9);
});

it("finishes after two consecutive passes and reports area score", () => {
  const game = GoGame.create("go-1", "black");
  game.play("player", "A1", 0);
  game.play("gpt", "pass", 1);
  const state = game.play("player", "pass", 2);
  expect(state.status).toBe("finished");
  expect(state.score).toEqual(expect.objectContaining({ komi: 6.5 }));
  expect(state.winner).toBeDefined();
});
```

- [ ] **Step 2: Verify Go tests RED**

Run `npm run test --workspace server -- go-game.test.ts`. Expected: module-not-found failure for `go-game.ts`.

- [ ] **Step 3: Implement `GoGame`**

Use a 9x9 array with standard columns `A B C D E F G H J` and rows `1...9` (row 1 is the bottom edge). `play` must validate the expected version and actor, accept `pass`, reject occupied points, remove adjacent opponent groups with no liberties, reject suicide, and reject any resulting board hash already in positional history. A legal action increments the version once. Two consecutive passes finish the game.

Compute Chinese-style area scoring at finish: stones plus fully surrounded empty territory, with white komi `6.5`. Return `captures: { black, white }`, `consecutivePasses`, and `score: { black, white, komi }` in `GoGameSnapshot`. Legal moves must include every legal coordinate plus `pass`, without mutating the live board while probing.

- [ ] **Step 4: Verify Go tests GREEN**

Run `npm run test --workspace server -- go-game.test.ts`. Expected: all Go tests pass.

- [ ] **Step 5: Write failing unified service tests**

Create `server/tests/tool-service.test.ts` that asserts `createGame` supports both kinds, generated IDs are distinct, `getGameState` returns the current snapshot, `playGameMove` forwards optimistic version checks, and `resetGame` keeps the same `gameId`, kind, and player color while returning version zero.

- [ ] **Step 6: Implement `ToolService` and verify GREEN**

Implement this public surface:

```ts
export class ToolService {
  constructor(private readonly store = new GameStore()) {}
  createGame(input: { game: GameKind; playerColor: StoneColor }): GameSnapshot;
  getGameState(input: { gameId: string }): GameSnapshot;
  playGameMove(input: {
    gameId: string;
    actor: GameActor;
    move: string;
    expectedVersion: number;
  }): GameSnapshot;
  resetGame(input: { gameId: string }): GameSnapshot;
}
```

Use `node:crypto` `randomUUID()` for IDs. Run `npm run test --workspace server` and `npm run typecheck --workspace server`; expected: all server tests pass.

- [ ] **Step 7: Commit**

```bash
git add server/src/domain server/src/game-store.ts server/src/tool-service.ts server/tests
git commit -m "feat: add go game and unified service"
```

## Task 3: MCP resources, focused tools, and browser preview API

**Files:**
- Create: `server/src/mcp-server.ts`
- Create: `server/src/http-app.ts`
- Create: `server/src/index.ts`
- Create: `server/tests/mcp-server.test.ts`
- Create: `server/tests/http-app.test.ts`
- Modify: `server/package.json`

- [ ] **Step 1: Write failing server contract tests**

Create tests that start the Express app on an ephemeral port and assert:

```ts
it("reports health without exposing configuration", async () => {
  await request(app).get("/health").expect(200, { ok: true });
});

it("supports standalone create, read, move, and reset calls", async () => {
  const created = await request(app)
    .post("/api/tools/create_game")
    .send({ game: "chess", playerColor: "white" })
    .expect(200);
  const gameId = created.body.structuredContent.gameId;
  await request(app)
    .post("/api/tools/play_game_move")
    .send({ gameId, actor: "player", move: "e2e4", expectedVersion: 0 })
    .expect(200);
  const current = await request(app)
    .post("/api/tools/get_game_state")
    .send({ gameId })
    .expect(200);
  expect(current.body.structuredContent.stateVersion).toBe(1);
});
```

Add an MCP initialization test that posts a valid JSON-RPC `initialize` request to `/mcp`, expects HTTP 200, parses the streamable HTTP response, and confirms the server name `gpt-game-arena` is present. Add a direct `tools/list` test through the MCP SDK client or a second JSON-RPC request that confirms exactly five named tools and their safety annotations.

- [ ] **Step 2: Verify server tests RED**

Run `npm run test --workspace server -- http-app.test.ts mcp-server.test.ts`. Expected: missing HTTP/MCP module failures.

- [ ] **Step 3: Implement MCP registration**

Register `ui://gpt-game-arena/v1/widget.html` with `RESOURCE_MIME_TYPE`. Read the built `web/dist/index.html` at resource-call time so development rebuilds are visible after server restart. Resource metadata must be:

```ts
_meta: {
  ui: {
    prefersBorder: true,
    csp: { connectDomains: [], resourceDomains: [] },
  },
  "openai/widgetDescription":
    "An interactive chess or 9x9 Go board for playing turn by turn against GPT.",
}
```

Register the five tools from the tool plan. Every description must start with `Use this when...`, every tool must declare an output schema matching the snapshot union, and every annotation must explicitly set `readOnlyHint`, `destructiveHint`, and `openWorldHint`; set `idempotentHint` for reads/render only. Link only `render_game` to the UI via `_meta.ui.resourceUri`, with optional `openai/outputTemplate` as a compatibility alias. Set `_meta.ui.visibility` so read/move/reset tools are callable from the app.

Tool results must contain concise `structuredContent`, one short text `content` item, and no secrets. Convert `GameRuleError` into an MCP error result that names the stable code and recoverable message.

- [ ] **Step 4: Implement Express and standalone routes**

`createHttpApp` must accept a `ToolService` dependency, parse JSON with a safe size limit, expose `/health`, `/preview`, the five `/api/tools/:name` calls, and stateless streamable HTTP MCP at `/mcp`. The preview route must return `503` with a clear build instruction when `web/dist/index.html` is absent. Unknown standalone tools return 404; rule errors return 409; validation errors return 400. Do not log request bodies.

`server/src/index.ts` must read `PORT` safely, listen on `0.0.0.0`, print only the local preview and MCP URLs, and handle startup failure without exposing environment variables.

- [ ] **Step 5: Verify GREEN and runtime health**

Run:

```bash
npm run test --workspace server
npm run typecheck --workspace server
npm run build --workspace server
```

Then start the server on an unused local port and confirm `GET /health` returns `{"ok":true}` and `/mcp` responds to initialize. Stop the process after the check.

- [ ] **Step 6: Commit**

```bash
git add server
git commit -m "feat: expose game arena MCP server"
```

## Task 4: Responsive React widget, GPT turn bridge, and project handoff

**Files:**
- Create: `web/package.json`
- Create: `web/tsconfig.json`
- Create: `web/vite.config.ts`
- Create: `web/index.html`
- Create: `web/src/types.ts`
- Create: `web/src/bridge.ts`
- Create: `web/src/bridge.test.ts`
- Create: `web/src/game-client.ts`
- Create: `web/src/components/ChessBoard.tsx`
- Create: `web/src/components/GoBoard.tsx`
- Create: `web/src/components/GameChrome.tsx`
- Create: `web/src/App.tsx`
- Create: `web/src/App.test.tsx`
- Create: `web/src/main.tsx`
- Create: `web/src/styles.css`
- Create: `web/src/test-setup.ts`
- Create: `README.md`
- Modify: `package.json`

- [ ] **Step 1: Add the web package and failing bridge tests**

Configure Vite to emit a self-contained `web/dist/index.html` using `vite-plugin-singlefile`. Add React, ReactDOM, Vitest, jsdom, Testing Library, and TypeScript. In `bridge.test.ts`, prove that the bridge:

- resolves JSON-RPC responses by request ID;
- accepts only events from `window.parent` with `jsonrpc: "2.0"`;
- extracts `structuredContent` from `ui/notifications/tool-result`;
- uses `/api/tools/<name>` in standalone mode;
- sends host follow-ups with `ui/message` and never falls back to HTTP for that method.

Run `npm run test --workspace web -- bridge.test.ts`; expected: missing bridge module failure.

- [ ] **Step 2: Implement bridge-first client logic**

`bridge.ts` must expose `callTool`, `sendMessage`, and `subscribeToToolResults`. In an iframe, use JSON-RPC over `postMessage` for `tools/call` and `ui/message`; in a top-level browser, use same-origin `POST /api/tools/:name` for tools. Feature-detect `window.openai.toolOutput` only as initial/compatibility state, not as the primary transport. Add a 15-second timeout to bridge requests and remove pending entries on timeout.

`game-client.ts` must wrap the five tool names with typed methods. After a player move:

- in ChatGPT, send one concise message instructing GPT to call `get_game_state`, choose exactly one entry from `legalMoves`, and call `play_game_move` with `actor: "gpt"` and the current `stateVersion`;
- poll `get_game_state` once per second for at most 15 seconds and stop when the version increases or the game finishes;
- in standalone mode, pick the middle item from sorted legal moves (prefer a non-pass move) and submit it as the GPT move.

- [ ] **Step 3: Write failing component behavior tests**

Use a dependency-injected `GameClient` fake and real React rendering to prove:

```tsx
it("submits a chess move after selecting source and destination", async () => {
  render(<App client={clientWithChessState()} />);
  await user.click(screen.getByRole("button", { name: /white pawn on e2/i }));
  await user.click(screen.getByRole("button", { name: /empty e4/i }));
  expect(client.playPlayerMove).toHaveBeenCalledWith("game-1", "e2e4", 0);
});

it("submits a Go coordinate from a board intersection", async () => {
  render(<App client={clientWithGoState()} />);
  await user.click(screen.getByRole("button", { name: /play at D4/i }));
  expect(client.playPlayerMove).toHaveBeenCalledWith("game-1", "D4", 0);
});

it("disables the board while waiting for GPT", async () => {
  render(<App client={clientWhoseGptTurnIsPending()} />);
  await user.click(screen.getByRole("button", { name: /white pawn on e2/i }));
  expect(screen.getByText(/GPT is thinking/i)).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: / on |empty|play at/i })[0]).toBeDisabled();
});
```

Run `npm run test --workspace web -- App.test.tsx`; expected: component modules are missing.

- [ ] **Step 4: Implement accessible boards and game chrome**

Render every chess square and Go intersection as a real `<button>` with an exact descriptive `aria-label`. Chess interaction is two-click source/destination selection with legal-target highlighting; Go interaction is one click. Add buttons for New Chess, New Go, Pass (Go only), Reset, and Refresh. Show player/GPT colors, whose turn it is, last move, captures for Go, status/winner, and a compact move list.

Use a warm arcade-club visual system rather than a generic dashboard: ink/navy background, cream board frame, coral action color, jade accents, subtle paper texture made only with CSS gradients, and large geometric headings. Meet phone widths down to 320px, respect safe-area insets, avoid horizontal scrolling, keep tap targets at least 40px, support dark/light host themes with CSS variables, and honor `prefers-reduced-motion`.

Do not load images, fonts, analytics, or third-party assets; the resource CSP remains empty.

- [ ] **Step 5: Verify web GREEN and build**

Run:

```bash
npm run test --workspace web
npm run typecheck --workspace web
npm run build --workspace web
```

Expected: component and bridge tests pass, TypeScript exits zero, and `web/dist/index.html` is self-contained.

- [ ] **Step 6: Write the README and complete local loop**

Document:

- what GPT Game Arena does and why no `OPENAI_API_KEY` is required;
- the five tool contracts and the GPT-turn sequence;
- `npm install`, `npm test`, `npm run build`, `npm run dev`, and `/preview`;
- MCP Inspector against `http://localhost:8000/mcp`;
- current ChatGPT developer-mode path: Settings → Security and login → Developer mode, then ChatGPT Plugins → plus → public/tunneled URL ending in `/mcp`;
- metadata refresh after tool/resource changes;
- production requirements: stable HTTPS, streaming `/mcp`, exact CSP/domain, logs/metrics, and secret management;
- known demo limits: in-memory games disappear on restart, no authentication, no hosted deployment, and ChatGPT host testing still required.

Credit the official `openai/openai-apps-sdk-examples` Cards Against AI server as the closest architectural blueprint and link the current OpenAI plugin docs used.

- [ ] **Step 7: Run full validation and commit**

Run:

```bash
npm test
npm run typecheck
npm run build
```

Start the built server and execute this acceptance path in `/preview`: create chess, play `e2e4`, observe one legal fallback reply; create Go, play `D4`, observe one legal fallback reply; reset and confirm version zero. Also initialize `/mcp`, list tools, and verify `render_game` returns the widget resource URI.

Commit:

```bash
git add web README.md package.json package-lock.json
git commit -m "feat: add responsive GPT game widget"
```

## Final review contract

After every task, a fresh spec reviewer must inspect actual code against the full task text. Only after spec approval, a fresh code-quality reviewer must inspect the task commit range. The implementer fixes every Critical or Important issue and the appropriate reviewer rechecks it. After Task 4, run one final whole-branch review covering game-rule correctness, optimistic concurrency, MCP metadata, host/standalone behavior, accessibility, responsive layout, test evidence, and documentation truth.

The build is complete only when all automated checks pass and the local standalone plus MCP acceptance paths have executed. A local pass does not claim hosted deployment, installed ChatGPT plugin validation, or public submission.
