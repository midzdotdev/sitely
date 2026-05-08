# Getting Started

## Prerequisites

- Node.js 22+
- pnpm 9+
- Docker & Docker Compose

## Installation

```bash
# Clone the repository
git clone https://github.com/nicholasgriffintn/wapi.git
cd wapi

# Start Postgres and Redis
docker compose up -d postgres redis

# Install dependencies
pnpm install

# Build all packages
pnpm build
```

## API Usage

### Create an account

```bash
curl -X POST http://localhost:3000/v1/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "name": "User"}'
```

This returns an API key prefixed with `sitely_sk_`.

### Extract from a known site

```bash
curl http://localhost:3000/v1/sites/en.wikipedia.org/article?title=TypeScript \
  -H "Authorization: Bearer sitely_sk_..."
```

### Extract from any URL

```bash
curl "http://localhost:3000/v1/extract?url=https://example.com" \
  -H "Authorization: Bearer sitely_sk_..."
```

The generic extractor returns JSON-LD, OpenGraph, Twitter Cards, and meta tags from any URL.

### List available sites

```bash
curl http://localhost:3000/v1/sites \
  -H "Authorization: Bearer sitely_sk_..."
```

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/healthz` | No | Health check |
| `POST` | `/v1/auth/signup` | No | Create account, get API key |
| `POST` | `/v1/auth/keys` | Yes | Create additional API key |
| `DELETE` | `/v1/auth/keys/:id` | Yes | Revoke an API key |
| `GET` | `/v1/auth/balance` | Yes | Check token balance |
| `GET` | `/v1/extract?url=` | Yes | Extract from any URL |
| `GET` | `/v1/sites` | Yes | List registered sites |
| `GET` | `/v1/sites/:domain` | Yes | Get site metadata |
| `GET` | `/v1/sites/:domain/:resource` | Yes | Extract specific resource |
| `GET` | `/v1/schemas` | Yes | List available schema types |
| `GET` | `/v1/schemas/:type/sites` | Yes | Find sites providing a schema |
| `POST` | `/v1/admin/grant-tokens` | Admin | Grant tokens to a consumer |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `REDIS_URL` | Yes | Redis connection string |
| `PORT` | No | Server port (default: `3000`) |
| `ADMIN_SECRET` | No | Secret for admin endpoints |

## Development Commands

```bash
pnpm build            # Build all packages
pnpm typecheck        # Type-check all packages
pnpm test             # Run all tests
pnpm lint             # Lint with Biome
pnpm lint:fix         # Auto-fix lint issues
pnpm docs:dev         # Preview documentation site
```
