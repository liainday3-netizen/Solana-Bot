# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Solana Trading Bot

A standalone Python trading bot in `solana-bot/`:

- **Language**: Python 3.11
- **Mode**: Paper trading (virtual $20 USDC) by default — no real money at risk until `.env` keys are present
- **Strategy**: Momentum — 6-cycle rolling window via Jupiter Quote API prices (SOL, JUP, BONK)
- **Safety**: 50% max risk per trade, $5 circuit breaker, 0.5% min signal threshold
- **Live trading**: Requires `WALLET_PUBLIC_KEY`, `PRIVATE_KEY`, and optionally `SOLANA_RPC_URL` as Replit Secrets
- **Files**: `bot.py` (main), `bot.log` (rotating log), `trades.json` (auto-created trade log)
- **Run**: "Solana Trading Bot" workflow (`cd solana-bot && python3 bot.py --live`)
- **Dependencies**: requests, python-dotenv, base58, solana, solders
- **Deployment**: VM target (always-running process); Jupiter API calls require outbound internet (works in deployed env, blocked in dev sandbox)

### Required Secrets (for live mode)

| Secret | Purpose |
|---|---|
| `WALLET_PUBLIC_KEY` | Solana wallet public key |
| `PRIVATE_KEY` | Wallet private key (base58) — never share |
| `SOLANA_RPC_URL` | RPC endpoint (defaults to public mainnet if absent) |

### Session summary

Printed on every exit (Ctrl+C or circuit breaker):
- Mode, runtime, cycles run
- Starting vs ending portfolio value
- P&L in USD and %
- Total trades this session + all-time trade count

## Structure

```text
artifacts-monorepo/
├── solana-bot/             # Solana trading bot (Python)
│   ├── bot.py              # Main bot logic
│   ├── bot.log             # Rotating log file
│   └── trades.json         # Trade history (auto-created)
├── artifacts/              # Deployable applications
│   └── api-server/         # Express API server
├── lib/                    # Shared libraries
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM schema + DB connection
├── scripts/                # Utility scripts (single workspace package)
│   └── src/                # Individual .ts scripts
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── tsconfig.json
└── package.json
```

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. The root `tsconfig.json` lists all packages as project references. This means:

- **Always typecheck from the root** — run `pnpm run typecheck` (which runs `tsc --build --emitDeclarationOnly`).
- **`emitDeclarationOnly`** — we only emit `.d.ts` files during typecheck; actual JS bundling is handled by esbuild/tsx/vite.
- **Project references** — when package A depends on package B, A's `tsconfig.json` must list B in its `references` array.

## Root Scripts

- `pnpm run build` — runs `typecheck` first, then recursively runs `build` in all packages that define it
- `pnpm run typecheck` — runs `tsc --build --emitDeclarationOnly` using project references

## Packages

### `artifacts/api-server` (`@workspace/api-server`)

Express 5 API server. Routes live in `src/routes/` and use `@workspace/api-zod` for request and response validation and `@workspace/db` for persistence.

- Entry: `src/index.ts` — reads `PORT`, starts Express
- App setup: `src/app.ts` — mounts CORS, JSON/urlencoded parsing, routes at `/api`
- Routes: `src/routes/index.ts` mounts sub-routers; `src/routes/health.ts` exposes `GET /health`
- Depends on: `@workspace/db`, `@workspace/api-zod`

### `lib/db` (`@workspace/db`)

Database layer using Drizzle ORM with PostgreSQL.

- `src/index.ts` — creates a `Pool` + Drizzle instance, exports schema
- `drizzle.config.ts` — Drizzle Kit config (requires `DATABASE_URL`)

### `lib/api-spec` (`@workspace/api-spec`)

Owns the OpenAPI 3.1 spec (`openapi.yaml`) and the Orval config. Running codegen produces output into two sibling packages.

Run codegen: `pnpm --filter @workspace/api-spec run codegen`

### `lib/api-zod` (`@workspace/api-zod`)

Generated Zod schemas from the OpenAPI spec.

### `lib/api-client-react` (`@workspace/api-client-react`)

Generated React Query hooks and fetch client from the OpenAPI spec.

### `scripts` (`@workspace/scripts`)

Utility scripts package. Run via `pnpm --filter @workspace/scripts run <script>`.
