# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

VexorNode is an AI-powered trading platform monorepo. The primary working directory for the frontend is `packages/web`; the backend API lives in `packages/api`.

## Monorepo Structure

```
packages/
  web/                   # React/Vite/TypeScript frontend (primary focus)
  api/                   # Fastify backend API
  core/                  # @transaction-auth-engine/core — shared business logic
  shared/                # @transaction-auth-engine/shared — common utilities
  webtransport-server/   # Real-time price data server (WebTransport/Geckos/WS/UDP)
```

## Common Commands

All commands run from the repo root unless otherwise noted.

```bash
# Install all workspace dependencies
npm install

# Run everything in dev mode
npm run dev

# Build all packages
npm run build

# Clean all build artifacts
npm run clean
```

**Frontend only** (from `packages/web`):
```bash
npm run dev       # Vite dev server on :5173
npm run build     # tsc + vite build → dist/
npm run lint      # ESLint
npm run preview   # Preview production build
```

**API only** (from `packages/api`):
```bash
npm run dev       # ts-node/tsx watch on :3001
npm run build     # tsc → dist/
npm run start     # node dist/index.js
```

**WeTransport server** (from `packages/webtransport-server`):
```bash
npm run start           # WebTransport (HTTPS)
npm run start:geckos    # Geckos.io UDP variant
npm run start:ws        # WebSocket variant
npm run start:udp       # Raw UDP variant
npm run start:mt5       # MetaTrader 5 bridge
```

No test runner is currently configured.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend framework | React 19, React Router 6, TypeScript 5.9 |
| Build tool | Vite 8 + @tailwindcss/vite 4 |
| Backend framework | Fastify 5 |
| Auth | Supabase (ES256 JWT) with HS256 fallback |
| Databases | PostgreSQL (pg), Redis (ioredis), Oracle ADB (oracledb) |
| Message queue | Kafka (kafkajs) |
| Real-time | WebSocket, WebTransport, Geckos.io, LiveKit |
| AI/LLM | Ollama (local), MiniMax API |
| Market data | BRAPI (Brazilian stocks), MercadoBitcoin (BTC), TradingView webhooks |
| Deployment | Vercel (frontend), local/OCI (backend) |

## Architecture

### Frontend (`packages/web/src/`)

- **Routing**: `App.tsx` defines all routes; `pages/Terminal.tsx` is the shell for the trading terminal with nested routes under `pages/terminal/`.
- **Auth flow**: `lib/appwrite.ts` (misnamed — it's actually Supabase) handles sign-up/login. `lib/auth.ts` manages localStorage tokens (`userId`, `accountId`, `accessToken`, `email`).
- **API calls**: `lib/api.ts` exposes `apiGet`/`apiPost` helpers that attach the Bearer token from localStorage and default to `http://127.0.0.1:3001`.
- **Real-time hooks**: Each protocol has its own hook (`useWebSocket`, `useWebTransport`, `useGeckos`, `useLiveKit`, `useUDP`). Use the appropriate hook depending on latency requirements.
- **Config**: `lib/config.ts` centralises all service ports and URLs; values can be overridden via `VITE_PUBLIC_*` env vars.

### Backend (`packages/api/src/`)

- **Entry point**: `app.ts` builds the Fastify app; `index.ts` calls `buildApp()` and starts listening.
- **Auth middleware**: `infrastructure/auth.ts` exports `requireAuth()`. It first tries Supabase JWT verification (`infrastructure/supabase-jwt.ts`, ES256), then falls back to HS256. Attach `requireAuth` as a `preHandler` on protected routes.
- **Database**: PostgreSQL pool is initialised in `app.ts` with retry logic (`PG_STARTUP_ATTEMPTS`). Redis is optional — the app starts in degraded mode if Redis is unreachable. Oracle is also optional.
- **Routes**: Registered in `app.ts` by importing from `routes/`. Each route file receives `{ app, pgPool, redis }` via a context object. The `/api/v1/` prefix is conventional.
- **NEXUS-CORE** (`routes/nexus-core/`): 8-layer AI trading engine. Layers 1–8 map to: Sources → Workers → Normalizer → Memory → AI-Core → Agents → Risk Engine → Execution. Doctrine strategies live in `routes/nexus-core/doctrine/`.
- **Static serving**: Fastify serves the built frontend from `packages/web/dist/`; all unknown paths return `index.html` for SPA routing.

### Shared Packages

- `packages/shared` exports: `createLogger`, `MercadoBitcoinClient`, `BrapiClient`, `RedisCacheService`, `OperationLockService`.
- `packages/core` exports: `Transaction` class and authentication utilities.
- Import these as `@transaction-auth-engine/shared` and `@transaction-auth-engine/core` from within the monorepo.

## Environment Variables

**API** (`.env` in `packages/api`):
```
PORT=3001
JWT_SECRET=
DATABASE_URL=postgres://...
REDIS_URL=redis://localhost:6379
KAFKA_BROKERS=localhost:9092
BRAPI_TOKEN=
MINIMAX_API_KEY=
ORACLE_CLIENT_LIB=C:\oracle\instantclient_21_12
CORS_ORIGINS=          # comma-separated extra allowed origins
COOKIE_SECURE=false    # set true in production
```

**Frontend** (`.env.local` in `packages/web`):
```
VITE_PUBLIC_API_URL=http://127.0.0.1:3001
VITE_PUBLIC_PYTHON_URL=http://127.0.0.1:8765
VITE_PUBLIC_LIVEKIT_WS=ws://127.0.0.1:7880
```

## Key Conventions

- The Supabase client is in `src/lib/appwrite.ts` (legacy name) — do not rename it without updating all imports.
- Vite proxies `/api` → `:3000` and `/python` → `:8765` in dev, but the default API base in `lib/api.ts` points directly to `:3001`. Prefer direct ports during development to avoid proxy ambiguity.
- The API gracefully degrades when optional services (Redis, PostgreSQL, Oracle) are unavailable. Check `app.ts` startup logs to confirm which services connected successfully.
- TypeScript `tsconfig.json` in `packages/api` explicitly excludes `src/routes/auth-oracle.ts` from compilation.
- `vercel.json` in `packages/web` is present but currently empty — Vercel deployment is configured at the project level, not via this file.
