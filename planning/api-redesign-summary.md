# API redesign — decisions summary

The source of truth for what we decided across the discussion. Used as the reference when planning and executing the doc amend. If something below contradicts the docs after the amend, the docs are wrong and need fixing.

> Format: one section per concern. Each line is a decided position, not a question. Open questions live at the bottom under "Still open".

---

## Site-package authoring (DSL)

- **Builder pattern** as the primary shape. `defineSite({ site, origins })` returns a builder; `.resource(...)`, `.page(...)`, `.use(segment)`, `.checkResponse(...)`, `.build()` chain forward.
- **No `schemas` block.** Each resource carries its schema directly: `.resource("article", { schema: Article, url: articleUrl, ttl: TTL.daily })`.
- **No `provides`.** `extract`'s return type is constrained against registered resources via builder generics. `sitely build` populates the manifest by dry-running each page's extract on a fixture (union of returned keys).
- **No `examples`.** Fixtures carry typed `params`; `errorCase: true` replaces the `.error.html` filename convention. Live re-fetch uses the URLPattern.
- **No author-written `version`.** `sitely build` injects from `package.json` into the compiled bundle and the manifest.
- **No capabilities, no sandbox.** Dropped entirely. The `capabilities` block is removed from `defineSite`; the worker_threads runtime, loader hook, runtime lockdown, parent watchdog all go.
- **`urlPattern("/article/:id", { id?: ParamSchema })`** is the bidirectional URL primitive. Inferred params type from the literal pattern; optional runtime schema for tighter validation. Used both as the page's first arg and as the resource's `url` (replaces separate `params + resolve`).
- **Mandatory `presence()` annotation** for any field marked `.optional()` / `.nullable()` / `.nullish()`. Build fails otherwise.
- **Field functions everywhere on extract output.** `{ headline: () => ctx.$("h1").text() }` — function form enforced even for constants, for consistency. Per-field error isolation and per-field telemetry follow.
- **`ctx.lazy(fn)`** memoised shared computation. Captures and re-throws errors so downstream fields see the same error (telemetry attributes the upstream cause).
- **`derivedFrom`** strict ordering. Builder accumulates `TResources`; `derivedFrom: "article"` is typed against accumulated keys. Compose-out-of-order is a compile error.
- **Segment composition** via `defineSegment()` + `defineSite(...).use(segment)`. Each segment carries a `requires` type that must be satisfied by what's accumulated when `.use()`d.
- **`.checkResponse((response) => ...)`** site-level smoke test running before per-page validate/extract. Receives `{ status, headers, body, url, has(selector), includes(text) }`. Throws `ResponseError` subtypes for bad responses. Only runs when a parseable response exists — connection-level failures bypass it (framework auto-treats as `TransientError` with backoff retry).

## Framework errors

Two families plus internal.

**`ResponseError` family** (thrown from `checkResponse` primarily; `extract` may also throw):
- `RateLimitedError({ retryAfter? })`
- `BlockedError({ retryAfter? })`
- `CaptchaError({ retryAfter? })` extends `BlockedError`
- `BadResponseError({ reason })`
- `TransientError({ retryAfter? })`
- `PermanentError({ reason })`

**`ExtractionError` family** (only from `extract` or field functions):
- `MissingDataError({ field, reason })`
- `MalformedDataError({ field, reason })`

**Internal**: `ValidationError` — framework throws after extract when schema validation fails. Authors don't throw it.

Circuit breaker only counts `ResponseError` toward opening — extraction errors are author bugs, not site outages.

## Rate limiting

- **Site-level declaration** (`rateLimit: { maxConcurrent, requestsPerSecond }`). Per-page override possible but discouraged.
- **`requestsPerSecond: 1/5`** preferred over `0.2` when sub-unitary. Both are valid JS; the fraction is more self-documenting.
- **Token bucket internally** for RPS + burst handling, with **adaptive backoff** on `429` / `Retry-After` / network errors. Author declares intent; framework handles deviation.
- **Per-hostname circuit breaker** always on, no exposed knobs. Trips on threshold of `ResponseError` signals; cools down then probes.
- **Server-wide concurrency cap** (`SERVER_MAX_INFLIGHT_EXTRACTIONS`) independent of per-site limits.

## Caching

- **Per-resource TTLs** declared by author; `{ default, min, max }`. Named presets: `TTL.realtime`, `TTL.short`, `TTL.medium`, `TTL.daily`, `TTL.weekly`. Authors can still write the triple explicitly for custom values.
- **No blanket `CACHE_DEFAULT_TTL_MS`.** Authors must specify per resource.
- **Cache key**: `normalizeUrl(url) + locale`. Author manages collapse via `normalizeUrl`.
- **Cache is uniform** — all extracted resources cached regardless of resource filter on the request. Resource filter is response-time projection only.
- **Grace window** (`CACHE_STALE_GRACE_MS`) for stale fallback on extract failure.

## HTTP API

- **`POST /v1/extract`** accepts a single request object or an array. Client auto-batches consecutive calls within one tick.
- **`GET /v1/extract?url=...`** stays for curl-able single calls.
- **Per-batch-entry version mismatch** returns `409` in that slot; other entries process normally.
- **Resource filter** via `?resources=article,comments` for multi-resource pages. Response-time projection only; doesn't affect extraction or cache.
- **No field-level sparse selection.**
- **CORS** configured via env var; preflights consume no slot or token.

## TypeScript client

- **Auto-batching** transparent over one tick (one microtask coalesces). `createClient({ batch: false })` to disable.
- **Concurrency** via `createClient({ concurrency: { max, perSite? } })`. Default `max: 20`.
- **No runtime client-side validation.** Server validates each fresh extraction before persisting. Major-version mismatch returns `409`. Client trusts the wire.
- **Field-name parity** with the wire: `apiKey` and `balance` everywhere; no `secret` / `tokens` aliases.
- **`status === "success"` and `"stale"`** narrow `data` to non-null.
- **No React adapter** until the API stabilises.

## Versioning

- **Site packages SemVer-versioned** via `package.json`.
- **Client sends `site` + `version`** with every typed request.
- **Server returns `409`** on major-version mismatch.
- **`sitely build` injects version** into the bundled output and the manifest.
- **Breaking-change detection** via new `semver-discipline` check that diffs against a committed `dist/baseline-manifest.json`. Build passes; check fails if SemVer is violated.

## The eight checks (revised)

1. `fixture-extraction`
2. `schema-conformance`
3. `determinism`
4. `schema-emission-roundtrip`
5. `locale-matrix`
6. `error-path-coverage`
7. `manifest-integrity`
8. `semver-discipline` ← new; replaces `security-sandbox` (dropped with capabilities)

**Warning-only checks:**
- `fixture-freshness`
- `performance-budget`
- `ttl-plausibility`
- `fixture-coverage` — every optional/nullable field needs at least one fixture present and one absent.

## Documentation structure

- **Engineer-facing implementation notes** appear in an "Implementation notes" subsection at the end of relevant architecture pages (Redis key shapes, watchdog timings, internal state machines, token bucket parameters, circuit breaker thresholds).
- **`sitely dev`** gets a real tutorial in the authoring guide.
- **REST vs GraphQL** lands in `docs/future/` as an alternatives-considered note.
- **Browser extension** for site authoring lands in `docs/future/` as a future direction.
- **The framework errors** get a dedicated reference table with usage examples in the authoring guide.

## Dropped from current docs

- All capability and sandbox content (`worker_threads`, loader hook, runtime lockdown, parent watchdog, `security-sandbox` check, sandbox-policy page, sandbox architecture page).
- `schemas` block in `defineSite`.
- `provides` field on pages.
- `examples` field on pages.
- Manual `version` declaration in `defineSite`.
- `CACHE_DEFAULT_TTL_MS` env var.
- `VALIDATE_BEFORE_CACHE_WRITE` env var (server-side validation becomes mandatory).
- `--update-expected` flag spelling (`--update` is canonical).
- `secret` / `tokens` field-name aliases.

## Future-direction entries (kept or added)

- Hosted service + managed sandboxing.
- Directory webapp.
- Signing chain.
- Removal feed.
- Drift detection (telemetry + scheduled live re-runs + consumer reports) — augmented by presence-rate annotations.
- Two-tier verification.
- **GraphQL API surface** (new). Pros: native field selection, per-field errors, composition, introspection. Cons: codegen step required, heavier client, loses type-flow-from-imports. Tie on caching (batched POST opaque to CDN in both). Revisit if consumers want nested field selection, subscriptions, or per-field cost optimisation at scale.
- **Browser extension** for site authoring (new). Snapshot capture, selector picking, live extract preview.
- **Rate-limit discovery tool** (new). Long-running probe that reverse-engineers a site's apparent limits and suggests `rateLimit` values.

---

## Still open (small loose ends)

- **Breaking-change baseline source**: `dist/baseline-manifest.json` (offline, committed) is the default; `npm view` is the alternative. Configurable via flag.
- **Strict vs lenient on missing minor bump**: same as breaking changes (check fails), or warn-only for additive changes? Default to fail; let authors opt out.
- **`?resources=` syntax in client**: `sitely.site(d).resource("article", params, { include: ["comments"] })` vs `sitely.site(d).resources(["article", "comments"], params)`. Pick one when planning the client API page.
