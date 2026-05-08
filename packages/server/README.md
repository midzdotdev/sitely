# @wapi/server

HTTP API server for WAPI.

## Overview

`@wapi/server` is the runtime that serves the WAPI REST API. It is not a library — it's the application entry point that wires together the framework, site definitions, database, cache, and HTTP layer.

## Architecture

- **Hono** — HTTP framework with CORS, auth middleware, and structured error responses
- **PostgreSQL** — persistent storage for consumers, API keys, cached resources, usage logs, robots.txt cache
- **Redis** — hot cache layer, rate limiting (sliding window + semaphore), robots.txt cache
- **Drizzle ORM** — type-safe database access
- **Pino** — structured JSON logging

## Responsibilities

- API key authentication (SHA-256 hashed storage)
- Per-site rate limiting + per-API-key rate limiting
- Request coalescing (deduplicate in-flight extractions)
- Multi-layer caching (Redis hot + Postgres cold, stale fallback on errors)
- robots.txt enforcement (3-tier cache: memory, Redis, Postgres)
- Generic fallback extraction (JSON-LD, OpenGraph, Twitter Cards, meta tags)
- Usage tracking (token cost estimation and logging)
- Graceful shutdown (SIGTERM/SIGINT with 10s drain)

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `REDIS_URL` | Yes | Redis connection string |
| `PORT` | No | Server port (default: `3000`) |
| `ADMIN_SECRET` | No | Secret for admin endpoints (e.g. grant-tokens) |

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/healthz` | No | Health check |
| `POST` | `/v1/auth/signup` | No | Create account |
| `POST` | `/v1/auth/keys` | Yes | Create API key |
| `DELETE` | `/v1/auth/keys/:id` | Yes | Revoke API key |
| `GET` | `/v1/auth/balance` | Yes | Token balance |
| `GET` | `/v1/extract?url=` | Yes | Extract from any URL |
| `GET` | `/v1/sites` | Yes | List sites |
| `GET` | `/v1/sites/:domain` | Yes | Site metadata |
| `GET` | `/v1/sites/:domain/:resource` | Yes | Extract resource |
| `GET` | `/v1/schemas` | Yes | List schemas |
| `GET` | `/v1/schemas/:type/sites` | Yes | Sites by schema |
| `POST` | `/v1/admin/grant-tokens` | Admin | Grant tokens |

## Not in TypeDoc

This package is excluded from generated API documentation because it's a runtime application, not an importable library. Its internal types (`Db`, `AppEnv`) are not part of the public API.
