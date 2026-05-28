# Self-hosting the server

This guide is for operators running `@sitely/server` themselves — on your own machine, your own Docker host, or your own cloud. It covers installation, configuration, monitoring, scaling, and the edge cases you'll hit in practice.

The server is a Hono application running on Node. It reads from Postgres (consumer accounts, API keys, usage logs, cold cache) and Redis (hot cache, rate-limit state, request coalescing). It loads [site packages](/overview/glossary#site-package) from your `node_modules` at boot and serves them under a stable HTTP API.

You don't need to fork or patch the server to add site coverage. You install site packages as npm dependencies; the server discovers them.

## What you need

- **Node 22 or newer.** The server uses ESM and `fetch` features that landed in 22.
- **Postgres 14 or newer.** Connection string in `DATABASE_URL`.
- **Redis 6 or newer.** Connection string in `REDIS_URL`. A single instance is fine for self-host; cluster URLs work if you have one.
- **Optional: Docker.** A working `docker-compose.yml` is at the bottom of this page.
- **A package manager** (`pnpm`, `npm`, or `yarn`) for installing the server and site packages. Curated site packages live under `@sitely/site-*`; community ones use `<author>-site-*`. Both are public on npm — no account needed to install.

The server is one process. Scaling is horizontal — run more instances behind a load balancer.

## Installation

### From npm

```bash
mkdir my-sitely-server
cd my-sitely-server
pnpm init
pnpm add @sitely/server
```

Add your site packages as dependencies:

```bash
pnpm add @sitely/site-wikipedia @sitely/site-hackernews some-author-site-foo
```

The server discovers installed site packages at boot by scanning `node_modules` for packages whose `package.json` declares the site-package shape (a `sitely.manifest` pointer plus the `dist/manifest.json` file). You don't have to register them anywhere.

Provide environment variables (see [Environment variables](#environment-variables)), then:

```bash
# Run migrations once (and on every upgrade).
pnpm sitely-server migrate

# Start the server.
pnpm sitely-server
```

The server listens on `PORT` (default `3000`). `GET /healthz` returns `200` once it's accepting traffic.

### From the repo

If you want to track main or hack on the server itself:

```bash
git clone https://github.com/midzdotdev/sitely
cd sitely
pnpm install
pnpm --filter @sitely/server build

# In a separate terminal or as a service.
pnpm --filter @sitely/server start
```

## Environment variables

`@sitely/server` reads configuration from environment variables only — there is no config file. Everything is listed below.

### Required

| Var | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string (e.g. `postgres://user:pass@host:5432/sitely`). Used by both the runtime client and the `migrate` command. |
| `REDIS_URL` | ioredis connection string (e.g. `redis://localhost:6379`). Cluster URLs work. |
| `ADMIN_SECRET` | Shared secret expected in the `X-Admin-Secret` header for `/v1/admin/*` routes. **Set a long random value.** If unset, the admin routes refuse all requests. |

### Common

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP listen port. |
| `LOG_LEVEL` | `info` | Pino level: `debug`, `info`, `warn`, `error`. |
| `NODE_ENV` | `production` | Affects pino formatting (pretty in `development`, JSON in `production`). Use a separate flag for feature gating; don't overload `NODE_ENV`. |
| `CORS_ORIGINS` | `*` | Comma-separated list of origins allowed by CORS. Set explicitly in production. |
| `REQUEST_TIMEOUT_MS` | `30000` | Max time for an inbound request to complete end-to-end. |
| `FETCH_TIMEOUT_MS` | `15000` | Per-outbound-fetch timeout (the [http-client](/architecture/server)). |
| `FETCH_MAX_REDIRECTS` | `5` | Outbound redirect cap. |
| `FETCH_MAX_BYTES` | `5242880` | Outbound response size cap (5 MiB default). Larger responses fail with `error`. |
| `FETCH_USER_AGENT` | `sitely/<version> (+https://sitely.dev)` | User agent sent on every outbound fetch. Set a custom string if your deployment needs to identify itself differently to target sites. Site packages can override the UA per-fetch via `ctx.fetch(url, { headers: { "user-agent": "..." } })`. |

### Rate limits

| Var | Default | Purpose |
|---|---|---|
| `RATE_LIMIT_PER_KEY_PER_MINUTE` | `60` | Default inbound per-API-key cap. Operators can override per consumer (see [Per-consumer rate limits](#configuration-per-consumer-rate-limits)). |
| `RATE_LIMIT_PER_KEY_BURST` | `10` | Burst size on top of the per-minute rate. |

The per-site outbound rate limit is **not** an env var. It comes from each [site definition](/overview/glossary#site-definition)'s declared `rateLimit` block. The server honours whatever the site author declared.

### Cache

| Var | Default | Purpose |
|---|---|---|
| `CACHE_STALE_GRACE_MS` | `604800000` | How long past TTL the cold cache keeps rows for the `stale` fallback. (7 days default.) |
| `CACHE_HOT_MAX_BYTES` | `268435456` | Redis hot-cache memory budget; entries past this are evicted LRU. (256 MiB default.) |

Per-resource TTLs are declared by site packages directly via the `TTL.<preset>` constants or a custom `{ default, min, max }` block — there's no operator-side default. Consumer overrides via `?ttl=` are clamped to the resource's `[min, max]`. Server-side validation runs on every fresh extraction before persisting to cache; no env flag.

### Throughput

| Var | Default | Purpose |
|---|---|---|
| `SERVER_MAX_INFLIGHT_EXTRACTIONS` | `100` | Global cap on concurrent outbound extractions across all hosts. Replica-local; independent of per-site rate limits — whichever limit is more restrictive at the moment governs. Protects the server itself from a stampede. |

### Telemetry

| Var | Default | Purpose |
|---|---|---|
| `ENABLE_TELEMETRY` | `false` | When `true`, sample-based drift detection sends anonymised signals upstream. Default off. See [Telemetry](#telemetry-opt-in). |

### Database

| Var | Default | Purpose |
|---|---|---|
| `DATABASE_POOL_MAX` | `10` | Max connections per server process. |
| `DATABASE_POOL_IDLE_MS` | `30000` | Idle connection timeout. |

## Loading site packages

At boot, the server walks `node_modules` looking for packages that declare the site-package shape — a `sitely.manifest` pointer in `package.json` plus a readable `dist/manifest.json`. For each found package, it:

1. Reads the [manifest](/overview/glossary#manifest).
2. Cross-checks the manifest against runtime expectations: declared origins parse, the framework version range covers the running framework, and the site's `version` is recorded for `409`-on-mismatch.
3. Calls `registerSite(siteDefinition)`, indexing the package by every hostname it declares (locale-in-host sites register under each locale's hostname).
4. Logs the registration at `info`.

A package that fails the cross-check is **refused at load** — the server logs the reason and continues without that package. This rejects when ambiguous rather than silently running a misconfigured package.

You can list what loaded with `GET /v1/sites` once the server is up.

### Updating site packages

There is no hot-reload. Bump the version in your `package.json`, run `pnpm install`, and restart the server. A rolling restart across replicas behind a load balancer is a graceful update.

### Two packages claiming the same hostname

If two installed packages register under the same hostname, **load order wins** and the loader logs a warning. Don't depend on this — pick one or use [families](/overview/glossary#family) if both packages handle the same HTML.

### Manifest framework-version mismatch

A package whose manifest declares a framework version range that doesn't include your running framework version is refused at load. The log line names the package, declared range, and actual version. Pin compatible versions in your `package.json`, or upgrade the server.

## Configuration: rate limits

Two limits, both Redis-backed so they work across replicas.

### Inbound — per API key

Defaults come from `RATE_LIMIT_PER_KEY_PER_MINUTE` and `RATE_LIMIT_PER_KEY_BURST`. The middleware checks this **before** any extraction work begins, so a noisy consumer can't extract a Postgres lookup from the server beyond the API-key validation step.

To override per consumer or per tier, write to the `auth_tier_overrides` table (managed via the admin route in the next section). A consumer's effective rate is `tier.rate_limit_per_minute ?? RATE_LIMIT_PER_KEY_PER_MINUTE`.

When the limit fires, the consumer sees `HTTP 429` with `Retry-After: <seconds>`.

### Outbound — per site

Declared in each site definition's `rateLimit` block:

```ts
rateLimit: { maxConcurrent: 2, requestsPerSecond: 1 }
```

The server acquires a slot before every outbound fetch and releases it after. State lives in Redis under `sitely:sem:*` and `sitely:ratelimit:*` so replicas share it. You **don't** override these from the server side — they reflect the site author's judgement of what the target site considers reasonable. If you have a contractual arrangement with a target site that allows more, write a custom site package with the higher numbers.

### Coalescing

If N concurrent requests hit the same URL, the server fetches once. This is per-process — each replica coalesces its own traffic but doesn't share in-flight state across replicas. The reduction is significant in practice; replicas sharing isn't required.

## Configuration: cache TTLs

The cache has two layers:

- **Hot layer:** Redis. Sub-millisecond reads. Holds the most recent entries within its `CACHE_HOT_MAX_BYTES` budget; LRU eviction.
- **Cold layer:** Postgres (`cached_resources` table). Persistent. Holds every entry until its TTL plus `CACHE_STALE_GRACE_MS` expires.

A read checks hot first; a hot miss falls through to cold; a cold miss triggers a fresh extraction. On extraction failure, the server checks for any cached value past TTL within the grace window and returns it as `status: "stale"`. This is the universal fallback — degraded service is better than no service.

### Per-resource TTLs

Each resource declares its own:

```ts
ttl: { default: "1h", min: "5m", max: "24h" }
```

The default is what the server uses absent a consumer override. The `[min, max]` bounds clamp any `?maxAge=` consumer freshness requests. The build validates these — a site can't ship a resource with `min > max`.

### Tuning the hot tier

If hit rate is low and Redis memory budget is large, increase `CACHE_HOT_MAX_BYTES`. If memory is tight, decrease it — the cold tier still serves, just slower.

If hit rate is low and memory is fine, the bottleneck is probably URL normalisation in the site packages. Cache keys are the normalised URL — a site that doesn't strip `?ref=...` or similar tracking parameters caches each variant separately. File issues against site packages that look like they're caching poorly.

## Configuration: per-consumer rate limits

The default signup flow at `POST /v1/auth/signup` creates a consumer with the default per-API-key rate limit (set via `RATE_LIMIT_PER_KEY_PER_MINUTE`). If you want some consumers to have higher or lower limits, add rows to the `auth_tier_overrides` table mapping `consumerId` to per-consumer rate-limit settings. Run inside a transaction.

The server itself stays minimal — multi-tenant billing, usage metering, and tier management belong in a layer above. The hosted-service direction in [future direction](/future/) covers what that might look like.

## Operational concerns

### Health endpoint

`GET /healthz` returns `200` with `{"status": "ok"}` once the server is ready to serve. It does **not** check Postgres or Redis on every poll — that would amplify load checks. Instead, it reports the state the server last observed on its background health pinger.

When Postgres or Redis is unhealthy, `/healthz` returns `503` with a brief body describing what's down. Load balancers should pull degraded instances out of rotation.

### Logs

The server logs in JSON to stdout via pino. Key fields:

- `level` — `info`, `warn`, `error`, `debug`.
- `req` — request id, method, path, status, duration.
- `consumerId`, `apiKeyId` — set on protected routes.
- `site`, `resource` — set when an extract is dispatched.
- `cached` — `true` if the response came from the cache.
- `outboundFetch` — set when an outbound fetch occurs, with `url`, `status`, `bytes`, `durationMs`.

`LOG_LEVEL=debug` adds per-pipeline-stage logs for the orchestrator — useful when chasing why a specific URL is failing.

### Metrics

The server emits a small set of Prometheus-style metrics on `GET /metrics` (no auth; restrict at the load balancer if you don't want them public):

- `sitely_requests_total{route,status}` — counter.
- `sitely_request_duration_ms{route}` — histogram.
- `sitely_extractions_total{site,definition_type,status}` — counter.
- `sitely_cache_hits_total{layer}` — counter (`layer` is `hot` or `cold`).
- `sitely_outbound_fetches_total{site,status}` — counter.
- `sitely_rate_limit_blocks_total{kind}` — counter (`kind` is `per_key` or `per_site`).

These are the basics. If you need more, the codebase is small — adding a counter is one line.

### Database migrations

Versioned via Drizzle migrations under `drizzle/` in the server package. Run with:

```bash
pnpm sitely-server migrate
```

The migrate command is idempotent — running it twice in a row is a no-op. Run it once per upgrade, before starting any replica on the new version.

The schema is the on-disk contract: tables exist for `consumers`, `api_keys`, `cached_resources`, `robots_txt_cache`, plus `auth_tier_overrides` if you've added it. There are no foreign-key cascades — deletes are rare and handled in application code.

### Backups

- **Postgres holds everything durable** — accounts, keys, usage history, cold cache. Take regular backups. The cold cache is rebuildable from live extractions but losing the rest is meaningful.
- **Redis is cache only.** You don't need to back it up. A cold start re-warms over time.

If you're restoring from a backup, run `pnpm sitely-server migrate` first — your schema should match before you point the server at the restored database.

## Trust model

The server loads every site package it finds in `node_modules`. Self-hosters trust their `package-lock.json` to constrain what's installed — that's the trust boundary, the same as any npm dependency. Site code runs in-process with the server; there is no sandbox.

If you want to filter packages by [status](/overview/glossary#status) (skip [unverified](/overview/glossary#unverified) or [drift suspected](/overview/glossary#drift-suspected) entries), do it in your `package.json` — don't install the package version in the first place. The directory shows status; self-host trust is determined by which versions you `pnpm add`.

For deployments where you don't fully trust the packages you install (e.g. running community packages on operator infrastructure with multiple tenants), wait for the managed/hosted service — see [future direction](/future/) for the isolation story there.

## Common deployment topologies

### Single-node Docker Compose

The simplest deployment: one box, one server process, Postgres and Redis as siblings. See [Reference: docker-compose.yml](#reference-docker-compose-yml) below.

Trade-offs: simple to run, no scale-out, single point of failure for the box. Fine for personal use and small projects.

### Horizontal scaling behind a load balancer

Multiple server replicas, one Postgres, one Redis (or Redis Sentinel/Cluster for HA).

- **Statelessness:** server processes are stateless. All state is in Postgres and Redis. Add replicas, remove replicas, no coordination required.
- **Coalescing is per-process.** Two replicas behind a load balancer don't share in-flight requests. If you're load-balancing to a hot URL across replicas, each replica coalesces independently — you'll see N fetches for N replicas rather than 1 fetch total. In practice this is rarely a problem; if it is, sticky-session routing by URL hash collapses it.
- **Redis-backed rate limits work across replicas.** Both per-key and per-site limits read and write through Redis, so a per-site limit declared as `requestsPerSecond: 1` is system-wide, not per-replica.
- **Database connections.** Each replica opens up to `DATABASE_POOL_MAX` connections. Don't run 50 replicas against a Postgres with 100 max connections.

### Behind a CDN

Extract responses are cacheable in principle — same URL, same locale, same `?fresh=false` flow returns the same data within TTL. The response is identical across consumers (no per-consumer fields), so an upstream HTTP cache could be plugged in if you really want it; sitely's own two-layer cache covers the common case.

If you want CDN caching:

- Strip per-consumer fields (`cost`) before caching at the edge.
- Vary by `Authorization` if you want per-consumer isolation (defeats most of the benefit).
- Or skip CDN caching and rely on the server's hot cache, which is already sub-millisecond.

Most operators run without a CDN. The hot cache is fast enough.

## Telemetry, opt-in

When `ENABLE_TELEMETRY=true`, the server samples live extractions and compares results against declared schemas. Divergences (an extraction missing a declared field, or producing an unexpected one) are reported as anonymised signals — no URL content, no consumer data, just package id + version + field-level drift indicators.

The signal is what feeds the [drift suspected](/overview/glossary#drift-suspected) status for community packages. Self-hosters opt in because the data is useful for everyone; self-hosters opt out because their traffic is private.

Default is `false`. If you turn it on, document it in your privacy posture.

## Edge cases / What if?

### What if Redis is down?

The server still works — degraded. Reads fall through hot cache to cold (Postgres). Coalescing breaks down (each request fetches independently). Rate limits stop working — both per-key and per-site checks fail open. The server logs `error` events for the Redis failure on every check.

Don't run for long without Redis. The rate-limit gap means a noisy consumer can hammer your upstream sites faster than the per-minute cap would allow.

### What if Postgres is down?

Auth fails — the server can't validate any API keys. Every protected request returns `401` after the auth middleware can't reach the database. `/healthz` reports degraded (`503`).

The server is effectively unusable without Postgres. Plan for HA at the Postgres layer if uptime matters.

### What if a site package's manifest declares a framework version that doesn't match mine?

The package is refused at load. The log line names the package, the declared range, and the running framework version. Either pin the package to a compatible version in your `package.json` or upgrade `@sitely/server` (which pulls a matching `@sitely/framework`).

### What if two site packages claim the same hostname?

Load order wins. The loader logs a warning identifying the conflict and which package took the slot. Resolve by removing one of the two, or by using a [family](/overview/glossary#family) if they're meant to be one package.

### What if I want to update a site package mid-run?

Restart the server. There is no hot-reload of site packages. A rolling restart across replicas is graceful — in-flight requests drain on `SIGTERM`, new requests go to the replicas already running on the new version.

### What if a site package starts crashing the server?

A crash in a package's `extract` function is caught by the framework and recorded as `status: "error"` for that request. Crashes are logged with the package id; if one package is repeatedly failing, the orchestrator increments a per-package error counter visible in metrics, and the [circuit breaker](/overview/glossary#circuit-breaker) may open for that hostname.

A persistent crash isn't a server bug — it's a site package bug. File against the package, and consider removing it from your `package.json` until it's fixed.

### What if Redis fills up?

Redis evicts LRU within `CACHE_HOT_MAX_BYTES`. If you've configured Redis with `maxmemory-policy noeviction`, writes start failing — the server falls back to the cold tier on reads but writes log errors. Configure `allkeys-lru` or `volatile-lru` on the Redis side.

### What if I'm seeing high `forbidden_by_robots` rates?

The target sites are denying you. There is no override. Check the URLs against the target's `robots.txt` directly. If many sites are denying, your user agent might be on a block list — the http-client's UA is set per-deployment; check `FETCH_USER_AGENT` or build a configured custom string.

### What if I need a feature that's not in the env vars?

The configuration surface is intentionally small. Things absent from the env-var table are absent on purpose. If you need something else, the codebase is small enough to fork and patch; PRs upstream are welcome.

## Reference: docker-compose.yml

A minimal stack you can drop in. Adjust passwords and secrets before deploying.

```yaml
version: "3.9"

services:
  sitely:
    image: ghcr.io/midzdotdev/sitely-server:latest
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    environment:
      DATABASE_URL: postgres://sitely:sitely@postgres:5432/sitely
      REDIS_URL: redis://redis:6379
      ADMIN_SECRET: "${ADMIN_SECRET}"
      PORT: "3000"
      LOG_LEVEL: info
      CORS_ORIGINS: "https://your-frontend.example.com"
      SERVER_MAX_INFLIGHT_EXTRACTIONS: "100"
      ENABLE_TELEMETRY: "false"
    ports:
      - "3000:3000"
    command: >
      sh -c "pnpm sitely-server migrate && pnpm sitely-server"

  postgres:
    image: postgres:16
    restart: unless-stopped
    environment:
      POSTGRES_USER: sitely
      POSTGRES_PASSWORD: sitely
      POSTGRES_DB: sitely
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U sitely"]
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7
    restart: unless-stopped
    command: ["redis-server", "--maxmemory", "256mb", "--maxmemory-policy", "allkeys-lru"]
    volumes:
      - redis-data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  postgres-data:
  redis-data:
```

Save as `docker-compose.yml`, set `ADMIN_SECRET` in your environment or a `.env` file, then:

```bash
docker compose up -d
curl http://localhost:3000/healthz
```

Once `/healthz` returns `200`, sign up your first consumer:

```bash
curl -X POST http://localhost:3000/v1/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email": "you@example.com"}'
```

Save the returned API key and start calling the [API](/guide/consuming-the-api).

### Customising the image

The default image bundles `@sitely/server` and no site packages. To bake site packages in, build your own image:

```dockerfile
FROM node:22-alpine

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

COPY . .

EXPOSE 3000
CMD ["sh", "-c", "pnpm sitely-server migrate && pnpm sitely-server"]
```

Your `package.json` lists every site package you want loaded. The server discovers them at boot.

## Read next

- [Consuming the API](/guide/consuming-the-api) — what your users will use.
- [Architecture: @sitely/server](/architecture/server) — the internals: route topology, request lifecycle, module-by-module.
- [@sitely/framework](/architecture/framework) — what site packages can declare and how the runtime invokes them.
- [Glossary](/overview/glossary) — every term used in this page.
