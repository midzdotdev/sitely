# @sitely/server

`@sitely/server` is the HTTP runtime. It loads [site packages](/overview/glossary#site-package) by hostname, runs extractions through a cache → robots → fetch → extract pipeline, and returns the result as typed JSON.

It is a Hono application on Node, backed by Postgres (accounts, API keys, usage logs, cold [cache](/overview/glossary#cache)) and Redis (hot cache, rate-limit counters, in-flight request state). You self-host it: a docker-compose stack plus the env vars in [Configuration](#configuration) is enough.

## Top-level architecture

```mermaid
flowchart TB
    Client["HTTP client"]

    subgraph hono["Hono app — packages/server/src/app.ts"]
        direction TB
        MwGlobal["Global middleware<br/>(CORS + context injection: db, redis, logger)"]
        Public["Public routes<br/>/healthz, /v1/auth/signup"]
        MwProtect["Protected middleware<br/>authMiddleware -> per-API-key rate limit"]
        Protected["/v1 sub-app<br/>auth · extract · sites · schemas · admin"]
        MwGlobal --> Public
        MwGlobal --> MwProtect --> Protected
    end

    subgraph services["services/"]
        direction TB
        Extract["extract-service<br/>orchestrator + coalescing"]
        Cache["cache-service<br/>Redis hot · Postgres cold"]
        Robots["robots-service<br/>fetch · parse · decision cache"]
        Rate["rate-limiter<br/>per-site outbound · per-key inbound"]
        Auth["auth-service<br/>signup · keys"]
        Http["http-client<br/>fetchPage"]
    end

    subgraph registry["site-loader registry"]
        direction TB
        Loader["site-loader<br/>(hostname -> SiteDefinition)"]
        Access["site-accessors<br/>(v1-shaped reads)"]
        SiteDefs["loaded SiteDefinitions<br/>(@sitely/site-*)"]
    end

    subgraph framework["@sitely/framework runtime surface"]
        FwCtx["ExtractionContext + CheerioDriver<br/>validate(ctx) + extract(ctx)"]
    end

    subgraph data["Data layer"]
        direction LR
        Redis[("Redis")]
        Postgres[("PostgreSQL")]
    end

    Client --> hono
    Protected --> Extract
    Protected --> Auth
    Protected --> Bill
    Extract --> Cache
    Extract --> Robots
    Extract --> Rate
    Extract --> Http
    Extract --> Loader
    Loader --> SiteDefs
    SiteDefs --> FwCtx
    Extract --> Bill
    Auth --> Postgres
    Bill --> Postgres
    Cache <--> Redis
    Cache <--> Postgres
    Robots <--> Redis
    Robots <--> Postgres
    Rate <--> Redis
    Http --> External(("external HTTP"))

    classDef external fill:#2a3a4a,stroke:#88c0d0,stroke-width:1px,color:#fff
    class External external
```

Requests fan **in** through middleware, **down** through the extract orchestrator, **out** to data stores or the network, and back **up** through the same orchestrator. Discovery routes (`/sites`, `/schemas`) bypass the orchestrator and read the registry directly — pure in-process reads.

## Route topology

The route table is the architectural shape of the server. The single source of truth is [`packages/server/src/app.ts`](https://github.com/midzdotdev/sitely/blob/main/packages/server/src/app.ts); the table below mirrors what's registered there.

### Public

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/healthz` | none | Liveness probe — returns 200 once the app is ready. |
| `POST` | `/v1/auth/signup` | none | Create an account and return its first API key. The plaintext key is returned exactly once. |

### Protected — `/v1` sub-app (authMiddleware + per-API-key rate limit)

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/v1/auth/keys` | Issue an additional API key for the authenticated account. |
| `DELETE` | `/v1/auth/keys/:id` | Remove an API key by id. |
| `GET` | `/v1/extract?url=...` | Extract structured data from a URL. Dispatches to a site definition by hostname; returns `status: "no_matching_site"` when no installed package matches. |
| `POST` | `/v1/extract` | Batched extract. Body: `{ requests: ExtractRequest[] }`. Response: `{ results: ExtractResult[] }`. Each entry is processed independently; one bad entry doesn't poison the batch. Used by the TypeScript client for transparent auto-batching. |
| `GET` | `/v1/sites` | List every registered site (in-process registry read). |
| `GET` | `/v1/sites/:domain` | Site detail — resources, schemas, rate-limit declaration. |
| `GET` | `/v1/sites/:domain/:resource` | Resource-shaped extraction. Inputs are URL params + query — the orchestrator builds the canonical URL from the site definition's `pages` patterns. |
| `GET` | `/v1/schemas` | List schema types across all loaded sites. |
| `GET` | `/v1/schemas/:type/sites` | Reverse lookup — "which sites provide `Article`?" |

The `/v1` prefix is the API version envelope. A future v2 surface mounts as a sibling sub-app, leaving v1 callers undisturbed.

## The request lifecycle

This is what happens between `GET /v1/extract?url=…` arriving and the JSON response leaving. See also [Data flow — runtime flow](./data-flow#runtime-flow-—-a-consumer-s-http-request) for the cross-package view.

```mermaid
sequenceDiagram
    autonumber
    participant C as HTTP client
    participant H as Hono (middleware)
    participant Auth as authMiddleware
    participant RL as rate-limiter (per-key)
    participant Ex as extract-service
    participant Ca as cache-service
    participant R as robots-service
    participant Site as site-loader
    participant Net as http-client
    participant Fw as framework (validate + extract)

    C->>H: GET /v1/extract?url=…
    H->>Auth: validate Authorization: Bearer
    Auth->>RL: checkApiKeyRateLimit(apiKeyId)
    RL-->>Auth: allowed
    Auth->>Ex: extractFromUrl(url, opts, auth)

    Ex->>Ca: cacheGet(normalizedUrl)
    alt fresh cache hit
        Ca-->>Ex: CachedResource
        Ex-->>C: 200 { cached: true, ... }
    else miss or stale
        Ex->>Site: getSite(hostname)
        Site-->>Ex: SiteDefinition | undefined
        alt no site matches
            Ex-->>C: 200 status: "no_matching_site"
        else
            Ex->>R: isAllowedByRobots(url)
            R-->>Ex: allowed | denied
            Ex->>RL: SiteRateLimiter.acquire(domain, ...)
            RL-->>Ex: granted
            Ex->>Net: fetchPage(url)
            Net-->>Ex: HTML + status
            Ex->>Fw: checkResponse + page.validate(ctx) + page.extract(ctx)
            Fw-->>Ex: schema-shaped data
            Ex->>RL: SiteRateLimiter.release(domain)
            Ex->>Ca: cacheSet(...)
            Ex-->>C: 200 { cached: false, ... }
        end
    end

    Note over Ex,Ca: On extract failure (acceptStale=true): cacheGetStale → status:"stale"
```

A few non-obvious properties:

- **Request [coalescing](/overview/glossary#coalesce).** N concurrent identical requests trigger one fetch and one extraction. The orchestrator deduplicates in-flight requests by normalised URL; later callers attach to the same in-flight promise instead of racing.
- **Per-API-key rate limit precedes any database work beyond key lookup.** A client over its inbound budget gets a 429 before any further DB work happens.
- **Per-site rate limit gates the outbound fetch.** It comes from `SiteDefinition.rateLimit` and is enforced as an acquire/release pair around `fetchPage`. The acquire is Redis-backed so it works across server replicas.
- **Stale cache is the universal fallback for live-extract failure** (when `acceptStale` allows it). Cache miss → fetch fails → `cacheGetStale` → return `status: "stale"`. With `acceptStale: false` the same situation surfaces `status: "error"` — the cached row is suppressed because it's outside the consumer's freshness constraint. Robots denies → return `status: "forbidden_by_robots"`. Rate-limited → return `status: "rate_limited"`. No matching site → `status: "no_matching_site"` (no stale fallback because there's no cached row to serve).

## Edge cases and failure modes

These are the boundary conditions the server contract pins down.

### Cache and storage failures

- **Redis is unreachable.** The server logs and proceeds without the [hot cache](/overview/glossary#cache). The [cold cache](/overview/glossary#cache) (Postgres) is still consulted on the read path, and `cacheSet` still writes there. If extraction fails and there is nothing in cold cache, the server returns the error — there is no stale fallback to draw from.
- **Postgres is unreachable.** Authenticated routes fail fast: the auth middleware can't validate the API key, so requests return 503 before reaching the orchestrator. Public routes (`/healthz`, `/v1/auth/signup`) still serve, except signup itself which writes to Postgres and fails. The hot cache remains readable, but durability and audit are gone for the duration.
- **Stale row exists but Redis is empty.** Reads fall through to Postgres normally; the entry warms Redis on the way back up.

### Robots.txt

- **`robots.txt` fetch times out.** `robots-service` returns "allowed" with a warning log. The server is biased toward serving over blocking when a robots fetch fails; this is intentional, since a flaky robots endpoint should not take a site offline for callers.
- **Robots denies the URL.** The orchestrator returns `status: "forbidden_by_robots"`. No fetch happens. There is no per-request override on this path; see [Robots on the request path](#robots-on-the-request-path) below.

### Fetch results

- **Target returns 429.** The result is `status: "rate_limited"` with no data. The response is not cached — caching a 429 would amplify the upstream's back-pressure.
- **Target returns any other non-2xx.** The status is captured in the result. Non-success statuses do not write to cache; the next request retries the fetch.
- **Target times out or the connection fails.** The orchestrator tries `cacheGetStale`. If a stale row exists, the response is `status: "stale"`. Otherwise `status: "error"`.

### Concurrency and coalescing

- **Two requests for the same URL arrive 1 ms apart.** They are coalesced into one fetch and one extraction. Both responses are served from the same in-flight promise. The cache is written once.
- **Coalescing is per-process.** Two server replicas behind a load balancer each coalesce their own traffic but don't share in-flight state across replicas.

### Site dispatch

- **Hostname matches a site package but `validate(ctx)` returns `false`.** The HTML doesn't fit the page pattern (captcha, removed-content stub, login wall, redirect). The orchestrator returns `status: "error"` with `error: { kind: "page_validation_failed", page: "<pattern>" }`. There is no generic-extraction fallback — every successful response is typed against a declared schema. The fetched HTML is still cached briefly to deduplicate re-fetches on the same URL within a short window.
- **Pagination — a `next(ctx)` call throws.** The orchestrator returns the pages collected so far with `pagination: { hasMore: true, cursor: null }`. The error is logged; the partial result is still cached.
- **Two loaded packages claim the same hostname.** Load order wins: the first `registerSite` for a hostname keeps it. The second is logged as a conflict and otherwise ignored. The runtime continues to serve.
- **A package declares a framework version range the server doesn't satisfy.** The site-loader refuses to register the package and logs the mismatch. The server starts normally; that hostname is simply unmapped.

## Robots on the request path

The server has no per-request override for robots.txt. Every site-definition extraction is gated on `isAllowedByRobots(url)`; a deny returns `status: "forbidden_by_robots"` and that is the only outcome on the deny side.

Author-side tools (`sitely snapshot`, `crawl.respectRobotsTxt: false`) have documented per-action opt-outs — those are explicit author-initiated actions on the author's own machine.

Every site-definition path is gated on robots — there's no other extraction path that bypasses the check.

## Module-by-module — top level

### `index.ts` — process entrypoint

The boot order is the architecture:

1. Construct the logger (pino).
2. Connect Postgres (postgres-js) and wrap it in Drizzle (`Db`).
3. Connect Redis (ioredis).
4. Run schema bootstrap (Drizzle migrations).
5. Dynamically import every site definition package from `../../sites/*` and call `registerSite()` for each.
6. Call `createApp(db, redis, logger)` to assemble the Hono app.
7. Hand the app to `@hono/node-server`'s `serve()` and listen on `PORT`.

`SIGTERM`/`SIGINT` triggers a graceful shutdown: stop accepting new connections, drain in-flight requests, close Redis, close the SQL pool, exit.

### `app.ts` — Hono app builder

The single source of truth for route topology. `createApp(db, redis, logger)` builds a `Hono<AppEnv>` and:

1. Mounts global middleware — CORS, then a context-injection middleware that sets `db`, `redis`, and `logger` on `c.var`.
2. Registers the public routes (`/healthz`, `/v1/auth/signup`).
3. Builds a `/v1` sub-app, mounts `authMiddleware()` + the per-API-key rate limiter on it, then registers every protected route.
4. Calls `app.route("/v1", api)` to splice the sub-app in.
5. Registers `app.onError(...)` — a centralised handler that converts unhandled errors to a JSON 500 with a stable shape.

Handler bodies are thin glue: each handler calls a service function and shapes the response.

### `types.ts` — shared types

```ts
export type Db = PostgresJsDatabase<typeof schema>;

export type AppEnv = {
    Variables: {
        db: Db;
        redis: Redis;
        logger: Logger;
        consumerId: string;
        apiKeyId: string;
    };
};
```

`Db` is the typed Drizzle handle. `AppEnv` is Hono's typed-context envelope: `db`, `redis`, `logger` are set by the context-injection middleware on every request; `consumerId` and `apiKeyId` are set by `authMiddleware()` on protected routes. Handlers read these via `c.get("...")`.

### `http-client.ts` — outbound fetch

```ts
export interface FetchPageResult {
    html: string;
    status: number;
    headers: Record<string, string>;
    url: string;        // final URL after redirects
    sizeBytes: number;
}

export interface FetchPageOptions {
    url: string;
    timeoutMs?: number;
    maxRedirects?: number;
    logger?: Logger;
}
```

The single outbound HTTP primitive. Owns user-agent rotation, retry policy, redirect handling, timeouts, and size caps. Called by `extract-service` on both the site-definition and fallback paths; also handed to the framework's extraction context as `ctx.fetch`.

`http-client` enforces server-side hygiene (timeout, redirect cap, UA, size limit) and integrates with the per-host [rate limit](/overview/glossary#rate-limit) and [circuit breaker](/overview/glossary#circuit-breaker) for politeness toward target sites.

**Edge cases:**

- A redirect chain exceeding `maxRedirects` returns the partial result with the final URL set to the last seen Location and `status` set to the redirect status. The orchestrator treats this as a non-2xx and doesn't cache.
- Response bodies past the size limit are truncated; the result carries `sizeBytes` as the truncated size.
- DNS failures and TLS handshake failures both surface as `status: 0` with the error string on the result. The orchestrator treats these as fetch failures.

### `site-loader.ts` — hostname → SiteDefinition registry

```ts
export function registerSite(site: SiteDefinition, logger?: Logger): void;
export function getSite(hostname: string): SiteDefinition | undefined;
export function getSiteById(id: string): SiteDefinition | undefined;
export function getAllSites(): SiteDefinition[];
```

In-memory registry. `index.ts` calls `registerSite()` once per loaded package at boot; the orchestrator calls `getSite(hostname)` on every extract request.

Two indexes are maintained: by hostname (the request-time lookup) and by site id (for discovery). A single site can register under multiple hostnames when `locales.source === "host"` — `getAllHostnames()` from the framework expands the [locale](/overview/glossary#locale) matrix, and each expanded hostname maps to the same `SiteDefinition`.

At `registerSite` time, the loader cross-checks the package's [manifest](/overview/glossary#manifest) against runtime expectations: declared origins parse cleanly, the framework version range covers the running framework, and the site's `version` is recorded for the per-request `409` mismatch check. A package failing the cross-check is refused at load.

**Edge cases:**

- **Hostname collision between two packages.** The first registration wins. The loader logs a warning and continues; the second package is otherwise silent.
- **Framework version mismatch.** The package is refused at load. The server logs the declared range vs the running version and continues without that package. Other packages are unaffected.
- **Rate-limit block malformed.** The package is refused at load with the parse error logged.

### `site-accessors.ts` — v1-shaped reads

```ts
export function siteDomain(site: SiteDefinition): string; // primary hostname
export function siteName(site: SiteDefinition): string;   // display name
```

Thin adapters that exist because the current `SiteDefinition` shape uses `site.origins[]` + `site.site.displayName` rather than `site.domain` / `site.name` scalars. The response payload and log lines still want a single hostname and a single name; these accessors compute them in one place.

Pure functions, no I/O.

## Module-by-module — services/

### `extract-service.ts` — the orchestrator

The pipeline. Reads cache (with freshness decision), coalesces in-flight requests, runs the site definition's [`checkResponse`](/overview/glossary#checkresponse) before per-page `validate(ctx)` / `extract(ctx)`, checks robots, acquires a per-site rate-limit slot, fetches, validates, extracts, paginates, writes cache, logs usage. Stale cache is the configurable fallback on every failure — see [Freshness decision](#freshness-decision) below.

The result shape:

```ts
export type ExtractionStatus =
    | "success"
    | "stale"
    | "no_matching_site"
    | "blocked"
    | "forbidden_by_robots"
    | "rate_limited"
    | "error";

export interface ExtractResult {
    status: ExtractionStatus;
    data: Record<string, unknown> | null;
    site?: { domain: string; name: string };
    cached: boolean;
    extractedAt: string;          // ISO-8601, always present
    cachedAt?: string;             // ISO-8601, present iff cached
    pagination?: PaginationMeta;
    error?: { kind: string; [field: string]: unknown };
}

export interface PaginationMeta {
    pagesReturned: number;
    hasMore: boolean;
    cursor: string | null;
    totalPages: number | null;
    totalItems: number | null;
}
```

`ExtractionStatus` is the contract that pins down the orchestrator's decision space. There are seven possible outcomes; nothing else can come out. A client switches on `status` and knows its alternatives are bounded.

`ExtractResult.cached` is `true` when the response came from the cache. `extractedAt` is the wall-clock moment the underlying extraction ran; `cachedAt` records when the cache row was written and is omitted when the response is fresh. Every `success` response is data from a typed [site package](/overview/glossary#site-package) — there is no generic-extraction path. URLs whose hostname doesn't match any installed package return `no_matching_site` instead.

#### Freshness decision

The orchestrator decides between cache-hit, re-extract, and freshness-rejected before any outbound fetch happens.

```mermaid
flowchart TB
    Start(["incoming request"])
    HasCache{cache hit?}
    Fresh{"fresh: true?"}
    MaxAge{"?maxAge= passed?"}
    InAge{"cached row<br/>extractedAt within<br/>requested age?"}
    Inside{"cached row<br/>inside resource TTL?"}
    Return["return cached row<br/>status: success<br/>cached: true"]
    Reextract["live extract"]
    Success["status: success<br/>cached: false"]
    Failed{"re-extract<br/>failed?"}
    AcceptStale{"acceptStale<br/>(default true)?"}
    Stale["status: stale<br/>cached: true"]
    Err["status: error<br/>data: null"]

    Start --> Fresh
    Fresh -- yes --> Reextract
    Fresh -- no --> HasCache
    HasCache -- no --> Reextract
    HasCache -- yes --> MaxAge
    MaxAge -- yes --> InAge
    MaxAge -- no --> Inside
    InAge -- yes --> Return
    InAge -- no --> Reextract
    Inside -- yes --> Return
    Inside -- no --> Reextract
    Reextract --> Failed
    Failed -- no --> Success
    Failed -- yes --> AcceptStale
    AcceptStale -- yes --> Stale
    AcceptStale -- no --> Err
```

The decision tree treats consumer `?maxAge=` as a freshness constraint, *not* a cache-TTL override. The resource's own `{ default, min, max }` is the author's policy; `?maxAge=` is the consumer asking "I want it at most this old", clamped to the policy's bounds. See [glossary → freshness](/overview/glossary#freshness).

Two entry points:

```ts
extractFromUrl(db, redis, url, opts, auth, logger): Promise<ExtractResult>
getResource(db, redis, domain, resourceName, params, opts, auth, logger): Promise<ExtractResult>
```

`extractFromUrl` is the URL-driven path used by `/v1/extract`. `getResource` is the resource-driven path used by `/v1/sites/:domain/:resource`: the orchestrator looks up the site, finds the resource, constructs the canonical URL from the resource's page pattern + params, then proceeds through the same pipeline.

Three pure registry queries live alongside the orchestrator because they share the loader dependency:

```ts
listSites(): Array<{ domain; name; resources: Array<{ name; schema; params }> }>;
listSchemas(): Array<{ name; sites: string[] }>;
findSitesForSchema(schemaType): Array<{ domain; name; resource }>;
```

These are pure in-process reads — no DB, no Redis, no network. The `/sites`, `/schemas`, and `/schemas/:type/sites` handlers are thin wrappers over them.

**Edge cases the orchestrator handles directly:**

- **Built-in CAPTCHA detection** runs *before* the author's [`checkResponse`](/overview/glossary#checkresponse). When the framework matches a known anti-bot service signature (Cloudflare, Datadome, PerimeterX, Incapsula, Akamai), it throws `CaptchaError({ service })` automatically and `checkResponse` doesn't run. Author can opt out per service via `detectCaptcha: { cloudflare: false }`. See [framework → Built-in CAPTCHA detection](./framework#built-in-captcha-detection).
- **[`checkResponse`](/overview/glossary#checkresponse) throws a [framework error](/overview/glossary#framework-errors).** The error maps to `status` per the table in [Retry topology](#retry-topology). `RateLimitedError` and `TransientError` may trigger retry inside the same call; others surface immediately. Counts toward the [circuit breaker](/overview/glossary#circuit-breaker) for response-error subtypes.
- **`validate(ctx)` returns `false`.** The HTML doesn't fit the page pattern. Return `status: "error"` with `error: { kind: "page_validation_failed", page: "<pattern>" }`. There's no generic-extraction fallback.
- **`extract(ctx)` throws.** Apply the [freshness decision](#freshness-decision): if the consumer's `acceptStale` allows stale fallback (default), try `cacheGetStale` and return `status: "stale"` if a row exists; otherwise (no cached row, or `acceptStale: false`) return `status: "error"`. The error is logged with the page pattern and URL.
- **`paginate.next(ctx)` throws midway through pagination.** Return what's collected so far with `hasMore: true, cursor: null`. The partial result is cached normally.
- **`paginate` declares a hard page cap that's reached.** Return collected data with `hasMore: true, cursor: <continuation>`.
- **`getResource` called with params that don't satisfy the resource's `params` schema.** Return `status: "error"` with a parameter-validation message. No fetch happens.

### `cache-service.ts` — two-layer cache

```ts
export interface CachedResource {
    data: Record<string, unknown>;
    extractionStatus: string;
    extractedAt: Date;             // when the underlying extraction ran
    cachedAt: Date;                // when this cache row was written (== extractedAt for the row that produced the entry)
    dataSizeBytes: number;
}

export async function cacheGet(db, redis, normalizedUrl): Promise<CachedResource | null>;
export async function cacheGetStale(db, normalizedUrl): Promise<CachedResource | null>;
export async function cacheSet(db, redis, opts: CacheSetOptions): Promise<void>;
```

Redis is the hot tier. Postgres (`cached_resources`) is the durable cold tier *and* the stale-serving tier when Redis has evicted the entry but the row is still around. Reads check Redis first; misses fall through to Postgres and warm Redis on the way back up.

The cache key is the **normalised URL** produced by the site definition (or the raw URL for the fallback path). Normalisation is the site author's responsibility — it's how `?ref=newsletter` and the canonical URL collapse to a single cache entry.

[TTL](/overview/glossary#ttl) is shared across layers. Each resource declares a default TTL and `[min, max]` bounds in its manifest (`ManifestResource.ttl`). Consumer freshness requests (`?maxAge=`) are clamped to those bounds before the freshness check. The bounds are validated at build time — a site can't ship a resource whose `min` exceeds its `max`.

`cacheGetStale` is the fallback path the orchestrator uses when re-extraction fails and the consumer's [`acceptStale`](/overview/glossary#freshness) preference allows it. It reads from Postgres only; Redis state is irrelevant because stale rows are by definition past their TTL.

**Edge cases:**

- **Redis is down.** `cacheGet` falls through to Postgres directly; `cacheSet` still writes Postgres and logs the Redis write failure. Hit rate drops; correctness is intact.
- **Postgres is down.** `cacheGet` and `cacheSet` both fail. The orchestrator treats `cacheGet` as a miss and proceeds; `cacheSet` failures are logged and swallowed. `cacheGetStale` returns `null`. If a fetch then fails, the orchestrator has nothing to fall back to and returns `status: "error"`.
- **A row exists in Postgres but Redis has stale data with a different `fetchedAt`.** The reader trusts Redis if its entry is within TTL; otherwise Redis is treated as a miss and Postgres wins. Writers always write both. A race window where Redis is fresher than Postgres exists for the duration of a single `cacheSet` call.

### `robots-service.ts` — robots.txt fetcher + decision cache

```ts
export async function isAllowedByRobots(db, redis, url, logger?): Promise<boolean>;
```

Per-origin. The service wraps the framework's `parseRobotsTxt` + `RobotsChecker` (the actual parser) with HTTP fetch and a layered cache:

1. In-process `Map` — fastest, reused per request.
2. Redis — shared across replicas.
3. Postgres (`robots_txt_cache`) — durable, survives Redis evictions.
4. Network — last resort, populates all the above.

Called by the extract orchestrator before every outbound fetch, including the per-page fetch during pagination. There is no opt-out on this code path.

**Edge cases:**

- **`robots.txt` fetch times out.** The service returns `true` (allowed) with a warning log. The bias is toward serving over blocking when robots is flaky.
- **`robots.txt` fetch returns a non-2xx.** Treated as "no robots.txt published" — allowed. This matches Google's documented behaviour.
- **`robots.txt` is malformed.** The parser returns a best-effort result; anything the parser can't make sense of is treated as no rule.
- **Cache TTL expires mid-request.** A request in flight that read a stale-but-pre-expiry cached decision proceeds with that decision. The next request triggers a refresh.

### `rate-limiter.ts` — per-site and per-API-key

```ts
export class SiteRateLimiter {
    async acquire(domain, maxConcurrent, requestsPerSecond): Promise<boolean>;
    async release(domain): Promise<void>;
}

export async function checkApiKeyRateLimit(
    redis, apiKeyId, maxPerMinute?,
): Promise<{ allowed: boolean; remaining: number; resetMs: number }>;
```

Two distinct limiters, both Redis-backed, both designed for horizontal scale.

`SiteRateLimiter` is the **outbound** limiter — it gates how fast `extract-service` may hit a given site. The limits come from the site definition's `rateLimit` block (concurrency + RPS); the acquire/release pair brackets each `fetchPage`. Per-site limits are an author-declared courtesy that the runtime honours.

`checkApiKeyRateLimit` is the **inbound** limiter — it gates how often a given API key may call the server. The middleware chain in `app.ts` checks this before any work happens on a protected route.

State lives in Redis under `sitely:ratelimit:*`, `sitely:sem:*`, and `sitely:apilimit:*` key prefixes. There is no in-memory state; restarts and replica adds are transparent.

**Edge cases:**

- **`acquire` succeeds but the request crashes before `release`.** The acquire is a counter with a TTL; the slot is released when the TTL expires, capping the leak. The TTL is generous enough that legitimate slow extractions don't get force-released mid-flight.
- **Redis is down during `acquire`.** The limiter conservatively fails the acquire — the orchestrator returns `status: "rate_limited"` rather than risk hammering an upstream site without limits. This is the one path where Redis downtime degrades the user-facing experience for site-definition extractions.
- **Two concurrent acquires bump the counter past `maxConcurrent` due to a Redis race.** The limiter uses `INCR` with a check-and-decrement, so the second acquire sees the over-cap value and returns `false`; the orchestrator returns `status: "rate_limited"`.

### `auth-service.ts` — accounts, keys, balances

```ts
export interface SignupResult {
    consumerId: string;
    apiKey: string;       // plaintext, returned exactly once
}

export async function signup(db, email, name?): Promise<SignupResult>;
export async function createApiKey(db, consumerId, label?): Promise<{ apiKey: string; keyId: string }>;
export async function removeApiKey(db, consumerId, keyId): Promise<boolean>;
```

Account lifecycle and API key issuance. Plaintext keys are returned to the client **once** at creation; the server only persists the hash (see `middleware/auth.ts → hashApiKey`). A lost key cannot be recovered, only removed and replaced.

**Edge case:** `removeApiKey` marks the key as removed by setting `removedAt`. Subsequent `authMiddleware` calls reject the key. An in-flight request using that key when removal happens still completes — the auth check is per-request at entry.

## Module-by-module — middleware/

### `auth.ts` — API key validation

```ts
export function hashApiKey(key: string): string;
export function authMiddleware(): (c, next) => Promise<Response | void>;
```

Validates `Authorization: Bearer <key>` on every protected route. Hashes the incoming key with the same function used at issuance (`hashApiKey`), looks it up in `api_keys`, refuses removed/missing keys with `401`. On success, sets `consumerId` and `apiKeyId` on the Hono context and touches `last_used_at` on the row.

`hashApiKey` is exported and used by `auth-service.createApiKey` — sharing the hash function across issuance and validation paths is structural, not coincidental. If the algorithm ever changes, both sides change together.

Public routes (`/healthz`, `/v1/auth/signup`) live *outside* the `/v1` sub-app so they bypass this middleware. Mounting boundaries are how the server distinguishes "authenticated" from "public" — there is no per-handler `if (apiKey)` check.

**Edge case:** the `last_used_at` write is best-effort; failures don't fail the request.

## Module-by-module — db/

### `schema.ts` — Drizzle table definitions

| Table | Purpose |
|---|---|
| `consumers` | Accounts. One row per signup. |
| `api_keys` | Bearer tokens issued to an account. Hash-only storage, supports `removedAt` and `lastUsedAt`. Indexed by `consumerId`. |
| `cached_resources` | The Postgres cold tier of the cache. Keyed by `normalizedUrl` (unique). Carries `data`, `params`, `extractionStatus`, `expiresAt`, `extractedAt`, `cachedAt`, and a lookup index on `(siteDomain, resourceType, paramsHash)` for resource-driven reads. |
| `robots_txt_cache` | One row per domain. `expiresAt` governs refresh; `content` is the raw text the parser runs against. |

All tables use `uuid` primary keys with server-side defaults; timestamps default to `now()`. There are no foreign-key cascades — deletes are rare and handled in application code with explicit ordering.

### `drizzle.config.ts` — migrations config

```ts
export default defineConfig({
    schema: "./src/db/schema.ts",
    out: "./drizzle",
    dialect: "postgresql",
    dbCredentials: {
        url: process.env.DATABASE_URL ?? "postgres://sitely:sitely@localhost:5432/sitely",
    },
});
```

Build-time config for the Drizzle Kit CLI. The compose-default URL is local-dev convenience; production deploys override `DATABASE_URL` via env.

## Configuration

Environment variables consumed by `index.ts`:

| Var | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string. Same value passed to Drizzle's runtime client and to `drizzle-kit` for migrations. |
| `REDIS_URL` | ioredis connection string. Single instance is fine for self-host; cluster URLs work for larger deployments. |
| `PORT` | HTTP listen port. Defaults to `3000`. |
| `LOG_LEVEL` | pino level — `debug`, `info`, `warn`, `error`. |
| `ADMIN_SECRET` | Shared secret expected in `X-Admin-Secret` for the `/v1/admin/*` routes. Required if admin endpoints are reachable in your deployment. |

A working local stack is in `docker-compose.yml` at the repo root: Postgres, Redis, and the server image. `pnpm dev` runs the server against those services in watch mode. For production, `pnpm build && node dist/index.js` plus the env vars above is sufficient — the server is a single process and scales horizontally behind a load balancer (state lives in Postgres and Redis).

## Retry topology

Two layers, disjoint conditions, no double-retry.

```mermaid
flowchart LR
    Consumer["Consumer code"]
    Client["@sitely/client"]
    Server["sitely server<br/>(extract-service)"]
    Target["target website"]

    Consumer --> Client
    Client -- "Hop 1" --> Server
    Server -- "Hop 2" --> Target

    classDef hop fill:#3a2a4a,stroke:#b48ead,stroke-width:1px,color:#eceff4
    class Client,Server hop
```

**Hop 1 — client ↔ sitely server.** The [TypeScript client](/guide/using-the-client)'s `retry` config covers transport failures between the consumer's code and the sitely server itself. Default: 3 attempts, exponential backoff 250ms → 5s. Fires on:

- Network unreachable, DNS failure, TCP reset reaching the sitely server.
- `5xx` from the sitely server (server crashed, dependency down, etc. — *not* a target-site failure).
- `429` from the sitely server (consumer's per-API-key rate limit was hit), retried after `Retry-After`.

Does **not** fire on `status: "error"` / `"stale"` / `"blocked"` / `"forbidden_by_robots"` / `"rate_limited"` / `"no_matching_site"` body shapes — those are 200/404 responses with a structured outcome the server has already decided is final.

**Hop 2 — sitely server ↔ target website.** `extract-service` retries internally on connection-level failures and 5xx from the target site, before the response goes back to the client. The client never sees Hop 2 retries; by the time it gets a response, Hop 2 is done.

| Trigger | Retry behaviour |
|---|---|
| [`TransientError`](/overview/glossary#framework-errors) (DNS, TCP reset, timeout, target 5xx) | 3 attempts, exponential backoff 250ms → 1s → 4s, ±25% jitter. ~5.5s worst-case added latency before the failure surfaces. |
| [`RateLimitedError`](/overview/glossary#framework-errors) (target 429 / `Retry-After` / `checkResponse` 429 rule) | No same-call retry. Adaptive backoff kicks in at the rate-limiter (50% bucket drop, 1-minute window, linear recovery). The current request waits in the rate-limiter queue up to **5s**; if it can't be served in time, returns `status: "rate_limited"`. |
| [`BlockedError`](/overview/glossary#framework-errors), [`CaptchaError`](/overview/glossary#framework-errors) | No retry. Counts toward the per-host [circuit breaker](/overview/glossary#circuit-breaker). Returns `status: "blocked"`. |
| [`PermanentError`](/overview/glossary#framework-errors), [`BadResponseError`](/overview/glossary#framework-errors) | No retry. Returns `status: "error"` with the error reason in the response envelope. |
| `ExtractionError` (author bug — `MissingDataError` / `MalformedDataError` / schema validation failure) | No retry. Returns `status: "error"`. |

**No double-retry guarantee.** Layer 1 fires on disjoint conditions from Layer 2: Layer 1 watches transport between consumer and sitely; Layer 2 watches transport between sitely and the target. They cannot stack — a client-side retry of a 200-with-status-error response is wasted work because the server has already exhausted Hop 2.

**Author surface.** Site authors interact with Hop 2 by throwing the right framework error from `checkResponse` / field functions. `TransientError` is the only one that triggers automatic retry; everything else is a single decision the framework records and surfaces.

## Implementation notes

Engineer-facing details that don't appear in user-facing docs but matter for sitely contributors.

### Token bucket (outbound rate limit)

Each declared per-site `rateLimit: { maxConcurrent, requestsPerSecond }` translates to two Redis-backed primitives at the orchestrator's outbound path:

- **Semaphore** for `maxConcurrent`. Redis key `rl:sem:<host>` is an `INCR`/`DECR` counter with a TTL fallback so a crashed handler's slot reclaims automatically. The TTL is `(declared extract timeout) + 30s`, comfortably longer than a healthy extraction.
- **Token bucket** for `requestsPerSecond`. Redis key `rl:bucket:<host>` is a hash `{ tokens, lastRefillMs }`. Atomic refill + take via a small Lua script. Bucket size = `max(1, requestsPerSecond)` tokens; refill rate = `requestsPerSecond` tokens/sec.

Adaptive backoff: on each `429` / `Retry-After` / network-reset response from the target, the token bucket's effective rate drops by 50% for the next minute, then linearly recovers to the declared rate. The drop persists in Redis under `rl:adaptive:<host>` with a TTL.

### Circuit breaker (per host)

Tracks recent response outcomes per hostname:

- Redis sorted set `cb:errors:<host>` keyed by `(timestamp, requestId)`, with members trimmed to a 60-second rolling window.
- A failure threshold of 50% over the last 20 requests (configurable internally; not exposed to authors) trips the breaker.
- Tripped state: Redis hash `cb:state:<host>` → `{ state: "open", openedAtMs, cooldownMs }`. Defaults: cooldown 30s.
- After cooldown: `state: "half-open"`. One probe request is allowed through. Success closes the breaker (back to `closed`); failure re-opens with double the cooldown (capped at 5 minutes).
- Only `ResponseError` counts toward the threshold — `ExtractionError` is author bug, not site outage.

### Server-wide cap

`SERVER_MAX_INFLIGHT_EXTRACTIONS` (default 100) is a process-local counter (not Redis) limiting total concurrent outbound extractions across all hosts. Independent of per-site limits; protects the server itself from a stampede.

### Auto-batching backend

`POST /v1/extract` accepts an array of requests; the orchestrator dispatches each entry through the same per-entry pipeline as a `GET /v1/extract` would. Per-entry coalescing applies: if two entries in the same batch (or two concurrent batches) target the same URL + locale, they share one fetch and one extraction.

The response slot's order matches the request slot's order. A failed entry's slot carries `status: "error"` and the framework-error payload; successful entries carry their full `ExtractResult`.

### Site-version mismatch

The `site-loader` records each loaded package's version (from the manifest's `site.version`) in an in-memory map. Every typed entry in a batched or resource-driven request carries `version`; the orchestrator compares with the loaded version. Major-version difference → that entry's slot returns:

```json
{
  "status": "error",
  "data": null,
  "error": {
    "kind": "site_version_mismatch",
    "site": "en.wikipedia.org",
    "clientVersion": "1.2.0",
    "serverVersion": "2.0.1"
  }
}
```

The HTTP status remains `200` (the request reached the orchestrator); the per-slot HTTP status mapping is for single-entry calls where the orchestrator promotes the mismatch to a top-level `409`.

## Read next

- [Data flow](./data-flow) — the cross-package view of the runtime, build, and author flows.
- [The build manifest](./manifest) — the contract the server cross-checks at load.
- [@sitely/framework](./framework) — the DSL the server loads and invokes.
- [Glossary](/overview/glossary) — terms used throughout these pages.
