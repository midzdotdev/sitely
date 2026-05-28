# Consuming the HTTP API

This page documents sitely's HTTP API directly — the request shapes, response bodies, status codes, and edge cases. If you're calling sitely from TypeScript or JavaScript, the [TypeScript client](./using-the-client) wraps all of this with typed methods, retries, and pagination helpers — use that first. The HTTP API is the right starting point if you're calling from another language, debugging the client, or building your own integration.

sitely is a thin envelope over [extraction](/overview/glossary#extract): you send a URL, the server finds the matching [site package](/overview/glossary#site-package), runs the package's `extract` function, and returns the typed result. URLs whose hostname isn't covered by an installed package return `status: "no_matching_site"` — sitely doesn't guess at unknown sites.

This page assumes you have a server URL (default `http://localhost:3000`) and want a working integration.

## Authentication

Every protected route requires an API key in the `Authorization` header:

```
Authorization: Bearer sitely_sk_...
```

API keys are plaintext bearer tokens prefixed with `sitely_sk_`. They are stored only as hashes on the server — a lost key can be replaced, not recovered.

### Getting a key

`POST /v1/auth/signup` creates a consumer account and returns its first key. The key is returned exactly once; save it.

```bash
curl -X POST http://localhost:3000/v1/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email": "you@example.com", "name": "Your Name"}'
```

Response:

```json
{
  "consumerId": "8f4c2e4b-...",
  "apiKey": "sitely_sk_live_a1b2c3..."
}
```

Set `Authorization: Bearer sitely_sk_live_a1b2c3...` on every subsequent request.

### Additional keys

A consumer can hold several keys at once — one per environment, per worker, per teammate. Issue them with `POST /v1/auth/keys`:

```bash
curl -X POST http://localhost:3000/v1/auth/keys \
  -H "Authorization: Bearer sitely_sk_..." \
  -H "Content-Type: application/json" \
  -d '{"label": "staging-worker"}'
```

The response includes the plaintext key (once) plus an opaque key id. Remove a key with `DELETE /v1/auth/keys/:id`. A removed key returns `401` from the next request that uses it.

## The two extract routes

There are two ways to ask for data. They go through the same pipeline and return the same shape; the only difference is how you address the request.

### `GET /v1/extract?url=...` — URL-driven

You have a URL and want sitely to dispatch it to the right [site package](/overview/glossary#site-package). The server looks at the hostname, finds the matching package, and runs it. If no package matches, the response is `status: "no_matching_site"` — no extraction happens.

```bash
curl "http://localhost:3000/v1/extract?url=https://en.wikipedia.org/wiki/TypeScript" \
  -H "Authorization: Bearer sitely_sk_..."
```

Response (truncated):

```json
{
  "status": "success",
  "data": {
    "article": {
      "@type": "Article",
      "headline": "TypeScript",
      "articleBody": "TypeScript is a free and open-source...",
      "datePublished": "2012-10-01",
      "author": [{ "@type": "Organization", "name": "Microsoft" }]
    }
  },
  "site": { "domain": "en.wikipedia.org", "name": "Wikipedia" },
  "cached": false,
  "extractedAt": "2026-05-28T14:22:01Z",
  "extractedAt": "2026-05-28T14:22:01Z"
}
```

Use this route when you have URLs from somewhere else (a feed, a sitemap, a search result) and don't want to think about which site package is involved.

### `GET /v1/sites/:domain/:resource?<params>` — resource-driven

You know the site and the [resource](/overview/glossary#resource) you want. You pass the resource's parameters as query string values. The server constructs the canonical URL from the site definition's [page](/overview/glossary#page) pattern and proceeds through the same pipeline.

```bash
curl "http://localhost:3000/v1/sites/en.wikipedia.org/article?title=TypeScript" \
  -H "Authorization: Bearer sitely_sk_..."
```

Use this route when you're building a typed client — you can validate inputs ahead of time, you know what you'll get back, and you don't have to construct URLs yourself. Discover what's available with the discovery routes below.

### `POST /v1/extract` — batched

Send an array of requests in one call. Each entry can be either URL-driven or resource-driven; the server processes them independently and returns an array of results. The TypeScript client uses this transparently — calls made within the same microtask are coalesced into one POST.

```bash
curl -X POST http://localhost:3000/v1/extract \
  -H "Authorization: Bearer sitely_sk_..." \
  -H "Content-Type: application/json" \
  -d '{
    "requests": [
      { "url": "https://en.wikipedia.org/wiki/TypeScript" },
      { "site": "en.wikipedia.org", "resource": "article", "params": { "title": "JavaScript" }, "version": "1.2.0" },
      { "url": "https://news.example.com/article/foo" }
    ]
  }'
```

Response:

```json
{
  "results": [
    { "status": "success", "data": { ... }, ... },
    { "status": "success", "data": { ... }, ... },
    { "status": "error", "data": null, ... }
  ]
}
```

Per-entry semantics: each request gets its own response slot with its own `status`, `data`, etc. One failed entry doesn't poison the batch — other entries still process. A site-version mismatch on one entry returns `409` in that slot only; the rest succeed normally. See [Site versioning](#site-versioning) below.

Per-API-key rate limits apply to the number of entries, not the number of POSTs.

### When to pick which

| Situation | Route |
|---|---|
| You have a URL from somewhere else | `GET /v1/extract` |
| You're integrating one specific site and want type safety | `GET /v1/sites/:domain/:resource` |
| You're issuing many calls at once | `POST /v1/extract` (the client uses this automatically) |
| You want to know up front whether a site is supported | `GET /v1/sites` to list installed packages |

## The response shape

Every extract response — both routes, success or otherwise — has the same envelope:

```ts
{
  status:
    | "success"
    | "stale"
    | "no_matching_site"
    | "blocked"
    | "forbidden_by_robots"
    | "rate_limited"
    | "error",
  data: Record<string, unknown> | null,
  site?: { domain: string, name: string },
  cached: boolean,
  extractedAt: string,                        // ISO-8601 — when this data was produced
  cachedAt?: string,                          // ISO-8601 — when the cache row was written; present iff cached
  pagination?: {
    pagesReturned: number,
    hasMore: boolean,
    cursor: string | null,
    totalPages: number | null,
    totalItems: number | null
  },
  error?: { kind: string, ...extra }          // present when status carries structured failure info
}
```

A few details worth knowing up front:

- **`data` is always keyed by resource name.** A page that produces one `article` resource returns `{ "article": {...} }`. A page that produces both `category` and `itemList` returns `{ "category": {...}, "itemList": [...] }`. The wire shape is uniform; the TypeScript client unwraps `data` for resource-driven calls as a convenience — see [Using the client → the data shape](./using-the-client#the-data-shape) for the per-call-style contract.
- **`extractedAt`** is when the extraction actually ran (the wall-clock answer to "how old is this data?"). Same value across cached and fresh responses for the same row.
- **`cachedAt`** is when the cache row was written. Present iff `cached: true`. Equal to `extractedAt` for the row that produced the cache entry.
- **Every successful response is typed.** sitely doesn't carry generic-extraction fallbacks; `data` either conforms to the matching [site package](/overview/glossary#site-package)'s declared [schemas](/overview/glossary#schema), or the response is a non-success status (most commonly `no_matching_site` for URLs no package covers).
- **`cached: true` means the response came from the [cache](/overview/glossary#cache).** It does not mean the data is necessarily stale; a fresh hit on the hot cache is still `cached: true`. Use `extractedAt` to know the data's age regardless of cache hit/miss.

Status-level outcomes are produced from the [framework errors](/overview/glossary#framework-errors) site packages throw during extraction — `RateLimitedError`, `BlockedError`, `CaptchaError`, `TransientError`, `PermanentError`, `BadResponseError`. The mapping is documented in the [glossary entry](/overview/glossary#framework-errors).

### A successful response

```json
{
  "status": "success",
  "data": {
    "article": {
      "@type": "Article",
      "headline": "Hello world",
      "datePublished": "2024-01-15T10:00:00Z",
      "author": [{ "@type": "Person", "name": "Jane Doe" }]
    }
  },
  "site": { "domain": "blog.example.com", "name": "Example Blog" },
  "cached": false,
  "extractedAt": "2026-05-28T14:22:01Z"
}
```

A cache-hit success carries both timestamps:

```json
{
  "status": "success",
  "data": { "article": { ... } },
  "site": { "domain": "blog.example.com", "name": "Example Blog" },
  "cached": true,
  "extractedAt": "2026-05-28T14:00:00Z",
  "cachedAt": "2026-05-28T14:00:00Z"
}
```

### A `no_matching_site` response

```json
{
  "status": "no_matching_site",
  "data": null,
  "cached": false,
  "extractedAt": "2026-05-28T14:22:01Z",
  "error": { "kind": "no_matching_site", "hostname": "unknown.example.com" }
}
```

The URL's hostname doesn't match any installed [site package](/overview/glossary#site-package). The fix is to install a package for that site (`pnpm add @sitely/site-unknownsite` or a community equivalent) or write one — see [Writing a site package](/guide/writing-a-site). sitely doesn't fall back to JSON-LD / OpenGraph guesses; every response that returns data is typed against a declared schema.

### A `stale` response

The live re-extraction failed, but a cached row exists and your `acceptStale` preference allowed the fallback (default behaviour):

```json
{
  "status": "stale",
  "data": { "article": { ... } },
  "cached": true,
  "extractedAt": "2026-05-27T09:00:00Z",
  "cachedAt": "2026-05-27T09:00:00Z"
}
```

`extractedAt` tells you exactly how old the data is — useful for surfacing the staleness to your own users. Pass `acceptStale=false` to refuse this fallback; you'll get `status: "error"` instead of `stale` when re-extract fails and no fresh-enough data is available.

### A `forbidden_by_robots` response

```json
{
  "status": "forbidden_by_robots",
  "data": null,
  "site": { "domain": "private.example.com", "name": "Example Private" },
  "cached": false,
  "extractedAt": "2026-05-28T14:22:01Z"
}
```

The target site's `robots.txt` disallows access to that URL. There is no override; see [What if](#what-if). `extractedAt` here is the time the robots-check decision was made.

### A `rate_limited` response

HTTP status `429`, with a `Retry-After` header carrying an integer number of seconds (per [RFC 7231](https://datatracker.ietf.org/doc/html/rfc7231#section-7.1.3)):

```
HTTP/1.1 429 Too Many Requests
Retry-After: 12
Content-Type: application/json

{
  "status": "rate_limited",
  "data": null,
  "cached": false,
  "extractedAt": "2026-05-28T14:22:01Z"
}
```

Rate limits cover two things: your own per-key budget, and the per-site outbound rate sitely respects on the target site's behalf. The response doesn't say which one fired — just sleep for `Retry-After` seconds and try again.

## Status values explained

The `status` field is the single dimension you should be switching on. There are seven values; nothing else can come out.

| `status` | What it means | What to do |
|---|---|---|
| `success` | Fresh-or-cache-fresh extraction; `data` populated. Check `cached` to know which. | Use the data. |
| `stale` | Live extraction failed; a cached value past TTL (or past your `?maxAge=`) was returned because `acceptStale` allowed it. `data` populated, `cached: true`. Only emitted when `acceptStale=true` (the default). | Use with caution. `extractedAt` tells you the age. |
| `no_matching_site` | The URL's hostname doesn't match any installed [site package](/overview/glossary#site-package). `data: null`. | Install or write a package for that site. There is no generic fallback. |
| `blocked` | The upstream site blocked the fetch (CAPTCHA, 403, anti-bot). `data` is `null` or partial. | Don't retry immediately. The site has decided you can't have this. |
| `forbidden_by_robots` | The target site's `robots.txt` disallows access. | Stop. There is no consumer-side override. |
| `rate_limited` | Either your per-key budget or the per-site outbound rate is exceeded. HTTP `429`, `Retry-After` set. | Wait `Retry-After` seconds. |
| `error` | Anything else — transient cache failure, framework crash, schema validation failure, unexpected upstream shape, or `acceptStale=false` with a failed re-extract and only stale cache available. | Retryable with backoff; see [Errors and retries](#errors-and-retries). |

Note that a `stale` response still returns useful data — the server treats "any data is better than no data" as the default when extraction fails but a cached row exists. Pass `acceptStale=false` to flip that policy: stale-cache fallback is suppressed and you get `status: "error"` instead.

## Pagination

A few site packages declare pagination on a [page](/overview/glossary#page). When you call the resource-driven route with `paginate=true` and a `maxPages` budget, the server walks subsequent pages and merges the results.

```bash
curl "http://localhost:3000/v1/sites/en.wikipedia.org/category?slug=Software&paginate=true&maxPages=5" \
  -H "Authorization: Bearer sitely_sk_..."
```

Response includes a `pagination` block:

```json
{
  "status": "success",
  "data": { "category": {...}, "itemList": [...] },
  "pagination": {
    "pagesReturned": 5,
    "hasMore": true,
    "cursor": "eyJwYWdlIjo2fQ==",
    "totalPages": 24,
    "totalItems": 1200
  }
}
```

- `pagesReturned` is how many pages the server actually walked.
- `hasMore` is `true` if there's more data beyond what was returned.
- `cursor` is an opaque token. Pass it back as `cursor=<value>` to continue from where you stopped. Don't decode it; the shape is internal.
- `totalPages` and `totalItems` are populated when the site itself exposes them; otherwise `null`.

To continue from a cursor:

```bash
curl "http://localhost:3000/v1/sites/en.wikipedia.org/category?slug=Software&paginate=true&maxPages=5&cursor=eyJwYWdlIjo2fQ==" \
  -H "Authorization: Bearer sitely_sk_..."
```

### How the walk merges pages

When `paginate=true&maxPages=N`, the server walks up to `N` pages and merges their `data` into a single response:

- **Array-typed resources are concatenated** across the walk. A page that provides `itemList` gets all items from every walked page in one array.
- **Scalar (object-typed) resources are taken from the first page only.** A page that provides `category` (one object per page) returns the category from page 1; later pages are ignored for that field. The reasoning: scalar resources usually describe the page header, which is the same across the walk.
- **`pagination.pagesReturned`** reflects the actual number of pages walked, not the budget.

If you need per-page scalars across the walk, use the manual or cursor-by-cursor style instead of `paginate=true`.

### Pagination gotchas

- **`maxPages` is a budget, not a guarantee.** The server stops when it reaches `maxPages`, runs out of upstream pages, or hits its own time budget.
- **Each walked page is a separate live extraction.** Five pages = five fetches modulo cache hits, and each fetch counts against the per-site rate limit.
- **Cursors are not durable across versions.** A new release of a site package can invalidate cursors. Don't store them long-term.
- **Per-page rate limits apply.** The per-site rate limit gates each page fetch; a `maxPages=20` over a site with `requestsPerSecond: 1` takes 20 seconds.

## Freshness

Every [resource](/overview/glossary#resource) declares a default [TTL](/overview/glossary#ttl) plus `min` and `max` bounds — the *author's* cache policy. As a consumer, you express your *own* freshness needs with three knobs: `fresh`, `ttl`, and `acceptStale`.

### Reading the freshness from a response

Every response includes:

- **`extractedAt`** (always) — when the underlying extraction ran. The wall-clock answer to "how old is this data?"
- **`cachedAt`** (iff `cached: true`) — when the cache row was written.
- **`cached`** — whether the response came from the cache. Distinct from "is the data stale": a cache hit *within* the resource's TTL is `cached: true, status: "success"`.

### `fresh=true` — force a live extraction

Pass `fresh=true` to bypass the cache regardless of age:

```bash
curl "http://localhost:3000/v1/extract?url=https://blog.example.com/posts/hello-world&fresh=true" \
  -H "Authorization: Bearer sitely_sk_..."
```

The new value is written back to the cache after extraction, so subsequent requests see the fresh data.

### `maxAge=<duration>` — consumer freshness constraint

Pass `maxAge=<duration>` to require that the data is at most that old:

```
?maxAge=15m       # data must be ≤ 15 minutes old
?maxAge=2h        # ≤ 2 hours
?maxAge=1d        # ≤ 1 day
```

Behaviour:

- If the cached row's `extractedAt` is within the requested age → served from cache.
- If older → the server re-extracts.
- If older and re-extract fails → see `acceptStale` below.

The duration is **clamped to the resource's `[min, max]` bounds**. A resource declaring `{ default: "1h", min: "5m", max: "24h" }` accepts max-age requests between 5 minutes and 24 hours; values outside that range clamp to the nearest bound.

**Note:** `maxAge` is a *consumer freshness* constraint, not a "cache this with this TTL" instruction. The cache's TTL is exclusively the resource author's concern — declared on the resource and rotated on the author's schedule.

### `acceptStale` — fall back to stale on failure?

Default `true`. Controls the stale-cache fallback when re-extraction fails:

- `acceptStale=true` (default) → return the cached value with `status: "stale"` even if it's past `maxAge` or the resource's TTL. Matches "any data is better than no data".
- `acceptStale=false` → return `status: "error"` instead. Data older than your freshness constraint is never returned.

### `fresh` + `maxAge` compose

Passing both is equivalent to `fresh=true` — a fresh request always re-extracts, regardless of age constraint.

## Rate limits

There are two rate limits in play, and they're independent.

### Per-API-key (your usage)

Inbound — how many requests *you* can send to the sitely server in a window. Defaults are operator-configured. When you exceed your budget, the server returns `429 Too Many Requests` with `Retry-After: <seconds>` before any extraction work happens. This protects the server from a single noisy consumer.

### Per-site (sitely respecting the target)

Outbound — how often sitely is willing to fetch from a given target site. Declared by the [site definition](/overview/glossary#site-definition) (`rateLimit: { maxConcurrent, requestsPerSecond }`), enforced around every outbound fetch. When the per-site limit is exhausted, requests queue briefly; if they can't be served promptly, the server returns `rate_limited`.

Per-site limits are an author-declared courtesy to the target site. There is no consumer override.

### Coalescing

If N concurrent requests for the same URL arrive simultaneously, sitely fetches once, extracts once, and serves all N callers from the single result. From the rate-limiting view, this counts as **one** request against the per-site limit; each caller still uses one slot of their per-key budget.

This means batching is implicit: ten clients hammering the same URL don't multiply outbound load. It also means the per-site limit doesn't punish popular URLs the way naive rate limiting would.

Coalescing applies within a single server process. Two replicas behind a load balancer each coalesce their own traffic.

## Site discovery routes

Four routes describe what sitely can do — useful for building a typed client, a schema-typed index, or a "which sites cover this schema?" lookup. All four are pure in-process reads — fast and cheap, no upstream network access.

### `GET /v1/sites`

List every installed [site package](/overview/glossary#site-package):

```bash
curl http://localhost:3000/v1/sites \
  -H "Authorization: Bearer sitely_sk_..."
```

Response:

```json
{
  "sites": [
    {
      "domain": "en.wikipedia.org",
      "name": "Wikipedia",
      "resources": [
        { "name": "article", "schema": "Article", "params": { "title": { "type": "string", "required": true } } },
        { "name": "category", "schema": "Category", "params": { "slug": { "type": "string", "required": true } } }
      ]
    }
  ]
}
```

### `GET /v1/sites/:domain`

Detail for one site — resources, schemas, locale strategy, rate-limit declaration.

### `GET /v1/schemas`

List every schema type across loaded sites. Useful for "I want articles; which sites have them?":

```json
{
  "schemas": [
    { "name": "Article", "sites": ["en.wikipedia.org", "blog.example.com", "news.example.com"] },
    { "name": "Product", "sites": ["shop.example.com"] }
  ]
}
```

### `GET /v1/schemas/:type/sites`

Reverse lookup — "which sites provide `Article`?" with resource-level detail:

```json
{
  "sites": [
    { "domain": "en.wikipedia.org", "name": "Wikipedia", "resource": "article" },
    { "domain": "blog.example.com", "name": "Example Blog", "resource": "post" }
  ]
}
```

## Errors and retries

Status code summary:

| HTTP | Meaning | Retry? |
|---|---|---|
| `200` | The request reached the orchestrator and a response is in the body. Check `status` in the body. | Depends on body `status`. |
| `400` | Malformed request — missing required params, unparseable JSON, etc. | No — fix the call. |
| `401` | Missing, invalid, or removed API key. | No — fix auth first. |
| `403` | Admin route accessed without `X-Admin-Secret`. | No. |
| `404` | The URL's hostname has no matching installed site package. Body carries `status: "no_matching_site"`. | No — install a package for that site. |
| `409` | Site-version mismatch — the client's imported site differs from the server's loaded version in the major position. | No — align versions. See [Site versioning](#site-versioning). |
| `429` | Per-key rate limit exceeded. | Yes, after `Retry-After`. |
| `500` | Server-side error not caught by the orchestrator. | Yes, with backoff. |

The unusual property of sitely is that **most extraction failures still return `200`** with a `status` field other than `"success"`. That's because the response shape is uniform: a `403` from the target site, a robots.txt deny, and a cached-stale fallback all flow back as JSON, not HTTP errors. Switch on the body's `status` for extraction-level decisions; use HTTP status codes for transport-level decisions.

### Retryable vs not

| Body `status` | Retryable? |
|---|---|
| `success` | N/A |
| `stale` | Yes, but back off — the underlying extraction is failing for some reason. |
| `no_matching_site` | **No** — the host has no installed package. Retrying won't change that. Install one and try again. |
| `blocked` | No — the site rejected the fetch. Retrying immediately doesn't help. |
| `forbidden_by_robots` | **No** — the target site has disallowed access. There is no override. |
| `rate_limited` | Yes, after `Retry-After`. |
| `error` | Yes — usually transient. Use exponential backoff. |

Server-side retries on connection-level failures happen automatically inside one extract call (3 attempts, 250ms → 1s → 4s, ±25% jitter). By the time you see `status: "error"`, the server has already exhausted its retries — your client-side retry covers the client↔server hop, not the server↔target hop. See [retry topology](/overview/glossary#retry-topology).

### A sample backoff

```ts
async function extractWithRetry(url: string, key: string, attempts = 4): Promise<ExtractResult> {
  let delay = 500;
  for (let i = 0; i < attempts; i++) {
    const res = await fetch(`http://localhost:3000/v1/extract?url=${encodeURIComponent(url)}`, {
      headers: { Authorization: `Bearer ${key}` },
    });

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("Retry-After") ?? "1");
      await sleep(retryAfter * 1000);
      continue;
    }

    const body = await res.json();

    // Stop on non-retryable statuses.
    if (body.status === "forbidden_by_robots" || body.status === "blocked") {
      return body;
    }

    if (body.status === "success" || body.status === "stale") {
      return body;
    }

    // error — back off and retry.
    await sleep(delay);
    delay *= 2;
  }
  throw new Error("exhausted retries");
}
```

## Reference: every route

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/healthz` | none | Liveness probe. Returns 200 once the server is ready. |
| `POST` | `/v1/auth/signup` | none | Create a consumer; receive the first API key. |
| `POST` | `/v1/auth/keys` | bearer | Issue an additional API key. |
| `DELETE` | `/v1/auth/keys/:id` | bearer | Remove an API key. |
| `GET` | `/v1/extract?url=...` | bearer | Extract by URL. Returns `no_matching_site` when the hostname has no installed package. |
| `POST` | `/v1/extract` | bearer | Batched extract — accepts `{ "requests": [...] }`. Each entry can be URL-driven or resource-driven; each gets its own response slot. Used by the TypeScript client for transparent batching. |
| `GET` | `/v1/sites` | bearer | List installed site packages. |
| `GET` | `/v1/sites/:domain` | bearer | Site detail — resources, schemas, locale strategy. |
| `GET` | `/v1/sites/:domain/:resource` | bearer | Extract a specific resource on a known site. |
| `GET` | `/v1/schemas` | bearer | List schema types across sites. |
| `GET` | `/v1/schemas/:type/sites` | bearer | Reverse-lookup sites by schema. |

Optional query string parameters supported by the extract routes:

| Param | Type | Routes | Effect |
|---|---|---|---|
| `fresh` | `bool` | `/v1/extract`, `/v1/sites/:d/:r` | Skip the cache; force live extraction regardless of age. |
| `maxAge` | `duration` | `/v1/extract`, `/v1/sites/:d/:r` | Consumer freshness — require data ≤ this old. Clamped to the resource's `[min, max]`. Re-extracts if the cached row is older. See [Freshness](#freshness). |
| `acceptStale` | `bool` | `/v1/extract`, `/v1/sites/:d/:r` | Default `true`. When `false`, returns `status: "error"` instead of `"stale"` if re-extract fails and only stale-cache data is available. |
| `locale` | `string` | `/v1/extract`, `/v1/sites/:d/:r` | Override the locale for sites that serve multiple. |
| `resources` | `comma-separated` | `/v1/extract`, `/v1/sites/:d/:r` | Filter the response to a subset of the page's provided resources. Server still extracts everything (cache stays uniform); filter is applied to the response shape. |
| `paginate` | `bool` | `/v1/sites/:d/:r` | Walk subsequent pages and merge results. |
| `maxPages` | `int` | `/v1/sites/:d/:r` | Page budget when `paginate=true`. |
| `cursor` | `opaque` | `/v1/sites/:d/:r` | Continue from a previous paginated response. |

## Site versioning

Every typed call (resource-driven via `/v1/sites/:domain/:resource` or a batched POST with `site` + `resource`) carries the consumer's *imported* site package version. The server checks against its own loaded version:

- **Match** (including minor/patch differences) → process normally.
- **Major version mismatch** → return `409 Conflict` with details.

For a batched request, the `409` lives in that entry's slot only; other entries process normally.

The response body for a 409:

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

The fix is alignment: update your installed `@sitely/site-wikipedia` to a compatible major, or have the operator upgrade their server. The check exists to avoid silent shape drift: a v2 of a site package may have removed a field your typed code expects.

URL-driven calls (`GET /v1/extract?url=...`) don't carry a version — the client doesn't pre-commit to which site package handles the URL. If the server's matching package is a major version ahead of what your code expects, you might still parse the response loosely; for strict typing, use the resource-driven route instead.

## CORS

sitely sets CORS headers on every response based on the server's `CORS_ORIGINS` environment variable (see [Self-hosting](/guide/self-hosting#environment-variables)). The default is `*` for local-dev convenience; production deployments should pin to known origins.

`OPTIONS` preflights succeed without consuming a request slot. The `Authorization` header is allowed on every CORS preflight, so a browser-side client can send the bearer key after the preflight clears.

Browser-side callers should still route through their own backend rather than calling sitely directly with a long-lived API key. Browser-safe keys (issued by the operator with tighter limits) are out of scope today — see the [client guide](/guide/using-the-client#what-if-i-want-to-call-sitely-from-a-browser-without-exposing-my-api-key) for the recommended pattern.

## What if?

A grab-bag of edge cases that come up in practice.

### What if the URL has no matching site package?

The response is `status: "no_matching_site"` with `data: null`. sitely doesn't carry a generic-extraction fallback — every response that returns data is typed against a declared schema.

```json
{
  "status": "no_matching_site",
  "data": null,
  "cached": false,
  "extractedAt": "2026-05-28T14:22:01Z",
  "error": { "kind": "no_matching_site", "hostname": "unknown.example.com" }
}
```

To add coverage for that site, install an existing package (`GET /v1/sites` lists what's installed) or write one — see [Writing a site package](/guide/writing-a-site).

### What if a fetch is slow or times out?

sitely sets a server-side fetch timeout per outbound request. When it fires, you get `status: "error"`; on a retry the server may serve a `stale` cached value if one exists. Long upstream pages don't propagate as long client responses — the server fails fast and returns a structured failure.

### What if I get `forbidden_by_robots`?

The target site's `robots.txt` disallows the URL. There is no consumer-side override — no header, no query parameter, no admin flag. This is a deliberate rule of the runtime, not a configuration. If you have a legitimate need (you're the site owner, or you have a contractual arrangement), the right answer is to work with the target site to update their robots.txt.

For URLs that fall through to the fallback path, sitely currently has a known gap in robots enforcement. This will close; treat the gap as a bug, not a feature.

### What if the cached data is stale?

Two situations:

- `cached: true, status: "success"` — the row is fresh within its TTL (or within the `?maxAge=` you asked for). Use it.
- `cached: true, status: "stale"` — the row is past TTL, served because a live re-extraction failed and `acceptStale` is `true`. The `extractedAt` field tells you exactly how old it is.

If you want fresher data, pass `fresh=true`. If you want to *refuse* old data when the re-extract fails, pass `acceptStale=false` — you'll get `status: "error"` instead of `"stale"`. If you keep getting `stale` for the same URL, the underlying extraction is broken — file an issue on the site package.

### What if I want to extract from a URL that needs JavaScript to render?

The default driver is [Cheerio](/overview/glossary#driver), which is static HTML only. A site package can declare a different driver, but as of today no JS-rendering driver ships with sitely. JS-heavy URLs return either an empty extraction (the static HTML had nothing) or a fallback response.

### What if I want to override the rate limit?

You can't, as a consumer. Per-key limits are operator-configured (see the [self-hosting guide](/guide/self-hosting)). Per-site limits are baked into the [site definition](/overview/glossary#site-definition) by the author — they reflect what the site's owners would consider reasonable, and the runtime honours that. If you need more headroom on a site, run your own server, set a higher per-key limit, and write site packages whose declared rate limits match your arrangement with the target.

### What if my API key was lost?

Keys are stored as hashes; they cannot be recovered. Sign up again or use one of your other keys to issue a replacement, then remove the lost key with `DELETE /v1/auth/keys/:id`.

### What if I want a webhook or push delivery?

sitely is request-response. There is no push surface. If you want change detection on a URL, poll with `fresh=true` on a schedule and diff the responses yourself.

### What if the response is huge?

Responses include the full `data` payload — there's no truncation or chunking. A site package extracting a long article returns the full article body. If you're memory-constrained, request specific resources (resource-driven route) rather than fetching by URL, and avoid `paginate=true` with a high `maxPages`.

### What if the server returns `200` but the JSON is malformed?

This shouldn't happen — the server's centralised error handler shapes all responses through the standard envelope. If it does, file an issue with the request, response, and timestamp.

### What if two of my requests for the same URL race?

The server coalesces them: one fetch, one extraction, two responses from a single underlying result. Each request is independently charged against your per-key budget, but only one upstream fetch happens.

### What if I want to test against fixtures without hitting live sites?

Site packages ship [fixtures](/overview/glossary#fixture) — checked-in HTML snapshots with their expected extraction output. You can run a site package's test suite locally with `pnpm sitely test`. That doesn't help you test your own integration against the live server, but it does let you verify a package's behaviour without network access.

## Read next

- [Self-hosting the server](/guide/self-hosting) — run your own instance.
- [Writing a site package](/guide/writing-a-site) — add coverage for a site sitely doesn't already handle.
- [Glossary](/overview/glossary) — every term used in this page.
