# Glossary

Every term sitely uses has one definition. This page is that definition. Other pages link here instead of re-explaining, and where two words could mean the same thing, only the one defined here is correct.

If you find a term in the docs that isn't here, that's a bug — open an issue.

## Read this first

A handful of terms carry most of the conceptual weight. Read them in this order before browsing the alphabetical list:

1. [Site package](#site-package) — an npm package for one website.
2. [Site definition](#site-definition) — the declarative object inside that package, assembled via the [builder](#builder).
3. [Resource](#resource) and [Page](#page) — the two main things a site definition declares.
4. [Schema](#schema) — what a resource's data looks like.
5. [URL pattern](#url-pattern) — how URLs and params bind together.
6. [Manifest](#manifest) — the build output that summarises everything.
7. [Fixture](#fixture) — the HTML files the test suite runs against.
8. [Extract](#extract), [Validate](#validate), and [Field function](#field-function) — what each page declares to produce data.

The alphabetical list follows.

---

## Admin secret

**What it is:** a long random string the operator sets in the `ADMIN_SECRET` env var. Every request to an `/v1/admin/*` route must carry it in the `X-Admin-Secret` header in addition to a normal Bearer API key. Without the secret, admin routes refuse every request.

**Edge case:** if `ADMIN_SECRET` is unset, admin routes refuse all requests — the secret has no default. This is deliberate: an empty default would silently re-enable admin operations after a redeploy that forgot to set the variable.

**Related:** [API key](#api-key).

## API key

**What it is:** the bearer token a consumer sends in the `Authorization` header on every protected request. Plaintext keys are prefixed with `sitely_sk_` and are returned exactly once at creation (signup or `POST /v1/auth/keys`). The server only stores hashes — a lost key can be removed and replaced, never recovered.

**One consumer, many keys.** A consumer can hold several keys at once (per environment, per worker, per teammate). Removing one key with `DELETE /v1/auth/keys/:id` doesn't affect the others.

**Edge case:** an in-flight request that's already past the auth check completes even if the key is removed mid-request. The next request with that key fails with `401`.

**Related:** [Admin secret](#admin-secret), [Rate limit](#rate-limit).

## Asset

**What it is:** a URL pointing to a binary or plaintext file referenced by a [resource](#resource) — images, videos, audio, PDFs, attachments. Declared inline in the schema via the `asset("image" | "video" | "audio" | "document")` brand:

```ts
const InstagramPost = z.object({
    caption: z.string(),
    images: z.array(asset("image")),      // array of image assets, named by field
    authorAvatar: asset("image"),          // single image, named by field
});
```

**Why it's typed.** Wire format is still a URL string; the brand is metadata the runtime introspects (for "discover all assets on this resource" tooling and a future `?expand=assets` flag that inlines bytes). Consumers read `post.authorAvatar` like any string field — the asset-ness is transparent unless you ask for it.

**Not lazy-loaded today.** Sitely returns URLs; consumers fetch the bytes themselves. The brand exists so a future inline-bytes mode has a clean place to land without re-shaping the data.

**Related:** [Resource](#resource), [Schema](#schema).

## Build

**The verb:** to run `sitely build` and produce the [build output](#build-output) for a [site package](#site-package). Use "build" only for this action; for the live extraction the server performs, use [extract](#extract).

**Related:** [Build output](#build-output), [Manifest](#manifest), [Test](#test).

## Build output

**What it is:** the `dist/` directory inside a [site package](#site-package), produced by [build](#build). Contains:

- `dist/index.js` — the compiled site definition with `version` injected from `package.json`. Consumers (server + TypeScript client) import this.
- `dist/manifest.json` — the [manifest](#manifest), with the same `version` embedded.
- `dist/schemas/<Name>.json` — one JSON Schema per [schema](#schema) referenced from the site definition.
- `dist/baseline-manifest.json` — the previously-published manifest, used by [`semver-discipline`](#semver-discipline) to detect breaking changes.

Everything in `dist/` is committed to git so downstream tools can read without running the build.

**Related:** [Manifest](#manifest), [Schema](#schema), [semver-discipline](#semver-discipline).

## Builder

**What it is:** the chainable pattern `defineSite({...})` returns. Each `.resource(...)`, `.page(...)`, `.use(segment)`, `.checkResponse(fn)` call accumulates types into the next step so cross-references stay type-safe; `.build()` produces the final [site definition](#site-definition).

```ts
defineSite({ site: { id: "blog", displayName: "Blog", version: pkg.version }, origins: [{ hostname: "blog.example.com" }] })
    .resource("article", { schema: Article, url: articleUrl, ttl: TTL.daily })
    .resource("comments", { schema: CommentList, derivedFrom: "article", extract: ..., ttl: TTL.short })
    .page(articleUrl, { extract: ..., validate: ..., fixtures: [...] })
    .build();
```

**Why a builder, not a literal object.** Cross-references — `derivedFrom: "article"`, `extract`'s return keys, [segment](#segment) imports — need types to flow as each step adds resources. A literal object can't typecheck a key against another key in the same object; a builder threads `TResources` through each call.

**Related:** [Site definition](#site-definition), [Segment](#segment).

## Cache

**What it is:** the server's two-layer store for past [extract](#extract) results.

- **Hot layer:** Redis. Sub-millisecond reads, in-memory, holds the most recent results.
- **Cold layer:** Postgres. Persistent, holds everything until its TTL expires, then for up to the [grace window](#grace-window) past TTL so stale fallback has something to serve.

A miss on hot falls through to cold; a miss on cold triggers a fresh extraction. On extraction failure, the server returns the stale cached value if there is one, marked `cached: true` in the response (subject to the consumer's [`acceptStale`](#freshness) preference).

**Each cached row carries `extractedAt` and `cachedAt`.** `extractedAt` is when the underlying extraction actually ran (the wall-clock answer to "how old is this data?"); `cachedAt` is when the cache row itself was written. They are equal for the row that produced the cache entry. Both surface in the response envelope — see [freshness](#freshness).

**Edge case:** the cache key always includes [locale](#locale). A site that serves the same URL in two languages caches them separately. The cache is uniform across requests — all extracted resources are cached regardless of any [resource filter](#resource-filter) on the request; filtering is response-time projection only.

**Related:** [TTL](#ttl), [Coalesce](#coalesce), [Grace window](#grace-window), [Resource filter](#resource-filter), [Freshness](#freshness).

## Circuit breaker

**What it is:** the per-hostname guard that stops the server from hammering a target site that's failing. Tracks [framework response errors](#framework-errors) (rate-limit, blocked, transient) in a sliding window; trips open when the error rate exceeds a threshold; after a cooldown, probes with a single request before closing again.

**Why per-hostname:** an outage on `api.example.com` shouldn't stop us hitting `cdn.example.com` even when both are listed in the package's `origins[]`. Each hostname is tracked independently.

**No exposed knobs.** The defaults (failure threshold, window size, cooldown) live in the framework, not the [site definition](#site-definition). Authors don't tune the breaker.

**Always active.** Even at `maxConcurrent: 1`, the breaker matters — it stops sequential hammering of a dead site.

**Related:** [Framework errors](#framework-errors), [Rate limit](#rate-limit).

## checkResponse

**What it is:** an optional [builder](#builder) step that runs *before* per-page `validate(ctx)` / `extract(ctx)`. Receives a parsed [response snapshot](#response-snapshot) and throws a [framework error](#framework-errors) when the response itself looks bad (rate-limit page, anti-bot challenge, "something went wrong" stub, etc.).

```ts
defineSite({...})
    .checkResponse((response) => {
        if (response.status === 200 && response.includes("Something went wrong")) {
            throw new RateLimitedError({ retryAfter: 60_000 });
        }
        if (response.has(".captcha-banner")) {
            throw new CaptchaError();
        }
    })
    .use(articleSegment);
```

**When it runs:** only for parseable responses. Connection-level failures (DNS, TCP reset, TLS, timeout) bypass `checkResponse` entirely — the framework treats those as [`TransientError`](#framework-errors) automatically with backoff retry.

**Separation of concerns:** `checkResponse` decides whether the response itself is good. Per-page [validate](#validate) decides whether a *good* response matches the page pattern's intent. [Extract](#extract) produces data from a response we've accepted as good.

**Related:** [Framework errors](#framework-errors), [Response snapshot](#response-snapshot), [Validate](#validate).

## Coalesce

**What it is:** when the server merges several in-flight requests for the same URL into a single fetch + [extract](#extract). If ten clients ask for the same URL at the same time, the server fetches once, extracts once, and returns the result to all ten.

**Edge case:** coalescing applies within a single server process. Two server instances behind a load balancer each coalesce their own traffic but don't share in-flight state.

**Related:** [Cache](#cache).

## ctx.lazy

**What it is:** a memoised producer helper available on the [extract context](#extract-context). Wraps a function whose result you want to share across multiple [field functions](#field-function) — runs once on first call, returns the cached value on subsequent calls.

```ts
const jsonLd = ctx.lazy(() => ctx.jsonLd("Article")[0]);

extract: async (ctx) => ({
    post: {
        headline: () => jsonLd().headline ?? ctx.$("h1").text(),
        author:   () => jsonLd().author?.name,
        date:     () => jsonLd().datePublished,
    }
})
```

**Async producers** are supported: `ctx.lazy(async () => ...)` returns a `() => Promise<T>` that's awaited at each call site but only resolves once.

**Error handling:** if the producer throws, the error is memoised and re-thrown on every subsequent call. Every dependent field sees the *same* error instance — telemetry attributes failures to the upstream cause rather than to each consumer.

**Related:** [Extract context](#extract-context), [Field function](#field-function).

## Cursor

**What it is:** an opaque string the server returns in `pagination.cursor` so the consumer can continue a [paginated](#pagination) walk. The shape is internal; don't decode it. Pass it back as `cursor=<value>` on the next request to resume from where the previous walk stopped.

**Edge case:** cursors are not durable across versions. Publishing a new version of a [site package](#site-package) can invalidate cursors mid-walk; the consumer gets `status: "error"` for a stale cursor and starts a fresh walk.

**Related:** [Pagination](#pagination).

## Discovery routes

**What it is:** the read-only routes that describe what a server has installed without doing extraction: `GET /v1/sites`, `GET /v1/sites/:domain`, `GET /v1/schemas`, `GET /v1/schemas/:type/sites`. They never hit the upstream network, and serve from the in-process site registry.

**Why they require auth.** Bearer tokens are still required so the server can attribute requests and apply per-key rate limits — even free reads can be a denial-of-service vector when uncapped.

**Related:** [API key](#api-key), [Rate limit](#rate-limit).

## Driver

**What it is:** an implementation of the [page driver](#page-driver) interface. The default driver is `CheerioDriver` (static HTML parsing). Future drivers could use JSDOM (closer-to-spec HTML5 parsing) or Playwright (full JavaScript execution); they're not currently included.

**Related:** [Page driver](#page-driver), [Page element](#page-element).

## Drift

**What it is:** the gap between what a [site package](#site-package) extracts today and what it extracted when it was published. Sites change layouts; selectors break; field meanings shift. Drift is the signal that something has changed *on the website* in a way that the package needs to catch up with.

**Detected by:** sampling live extractions, scheduled re-runs against example URLs, and consumer reports. See [Drift suspected](#drift-suspected) for the status that follows.

**Related:** [Drift suspected](#drift-suspected), [Extract](#extract).

## Drift suspected

**What it is:** a [site package](#site-package) status. Live behaviour has diverged enough from declared behaviour that automated checks have flagged the package. The package is still usable but consumers see a warning in the directory.

**Cleared by:** the maintainer publishing a new version that passes all checks against current live HTML.

**Related:** [Drift](#drift), [Removed](#removed), [Status](#status), [Unverified](#unverified), [Verified](#verified).

## Extract

**The verb:** to produce structured data from HTML. Every [page](#page) declares an `extract(ctx)` function that returns an object whose keys are resource names and whose values are objects of [field functions](#field-function).

**The noun (extraction):** one invocation of an `extract` function on a specific URL or [fixture](#fixture).

**Related:** [Extract context](#extract-context), [Field function](#field-function), [Validate](#validate).

## Extract context

**What it is:** the object passed to a [page](#page)'s `validate` and `extract` functions. Carries:

- `$(selector)` and `$$(selector)` — DOM queries returning [page elements](#page-element)
- `jsonLd(type?)` — parsed JSON-LD blocks on the page
- `params` — values parsed from the page's [URL pattern](#url-pattern), typed against its `TParams`
- `url`, `canonical`, `status`, `headers`, `locale` — request metadata
- `fetch(url, opts)` — outbound HTTP fetch; obeys the site's [rate limit](#rate-limit) and [circuit breaker](#circuit-breaker)
- `lazy(fn)` — see [`ctx.lazy`](#ctx-lazy)

**Related:** [Page driver](#page-driver), [Page element](#page-element), [URL pattern](#url-pattern), [ctx.lazy](#ctx-lazy).

## Family

**What it is:** a way of declaring that one [site package](#site-package) handles several origins because they share literal HTML structure. Stack Exchange (`stackoverflow.com`, `superuser.com`, `serverfault.com`, …) is the canonical example.

**Constraints:**

- Literal HTML structural identity is required, checked by an automated test.
- Each origin has its own [verified](#verified) status — adding an origin to a family doesn't inherit verification.
- The default is per-origin (one package per site). Families are an opt-in case for genuine HTML twins.

**Related:** [Origin](#origin), [Site package](#site-package).

## Field function

**What it is:** a zero-argument function that produces a single field's value during [extract](#extract). Every leaf in an extract return is a function — including constants — so the framework can compute fields lazily, isolate per-field errors, and tag telemetry by field name:

```ts
extract: async (ctx) => ({
    post: {
        headline: () => ctx.$("h1").text(),
        author:   () => ctx.$(".author").text(),
        date:     () => ctx.$("time").attr("datetime"),
        type:     () => "Article",   // even a constant is a function
    },
}),
```

**Async fields** are supported: a field function may return `T` or `Promise<T>`. The framework awaits each before validating the resource against its schema.

**Error handling.** A throw in one field doesn't tank the others. The framework records `undefined` for the field, reports the error to drift telemetry tagged with the field name, then continues. Schema validation downstream decides whether the absence is permitted (it is, for [presence-annotated](#presence-annotation) optional fields).

**Sparse selection.** When the request includes [`?resources=`](#resource-filter), unrequested resources' field functions aren't invoked at all.

**Related:** [Extract](#extract), [ctx.lazy](#ctx-lazy), [Presence annotation](#presence-annotation), [Resource filter](#resource-filter).

## Fixture

**What it is:** a captured HTML snapshot of a real page, used by the test suite as deterministic input. Each fixture is declared by its `params` against the page's [URL pattern](#url-pattern); the framework derives the canonical URL via `urlPattern.toUrl(params)`. Files live under `fixtures/<page-key>/<params-hash>.html` and are committed to git.

A page declares its fixtures inline:

```ts
.page(articleUrl, {
    fixtures: [
        { params: { id: "hello-world" } },                        // normal extraction fixture
        { params: { id: "removed-post" }, errorCase: true },      // validate must return false for this one
    ],
    ...
})
```

On disk, each fixture has up to three parts:

| File | Required? | Purpose |
|---|---|---|
| `<hash>.html` | Yes | The captured HTML body |
| `<hash>.expected.json` | Yes (non-error fixtures) | The data `extract(ctx)` should produce |
| `<hash>.meta.json` | Yes | When the fixture was captured, what URL it came from, response status + headers |

The fixture itself doesn't need a separate `examples` declaration — the URL is derived from `params` and the resource's URL pattern, and the live-check path re-fetches that URL.

**Why fixtures and not live HTTP for tests?** The test suite needs to be deterministic. Live sites change; checked-in fixtures don't. A fixture failing means the *site package* needs updating, not that the test environment is flaky. Live re-validation runs separately via `sitely check --live`.

**Related:** [Snapshot](#snapshot), [Test](#test), [URL pattern](#url-pattern).

## Framework errors

**What it is:** the typed error hierarchy authors throw from [`checkResponse`](#checkresponse) or [extract](#extract) to signal specific failure modes. The framework catches them uniformly and maps to the response envelope's `status`.

**Response errors** (about the response itself being bad — typically thrown from `checkResponse`, but `extract` can throw them too):

| Error | Meaning | Consumer `status` | Retry? |
|---|---|---|---|
| `RateLimitedError({ retryAfter? })` | Site is throttling. | `rate_limited` | Yes, after `retryAfter` (default 60s). Triggers backoff. |
| `BlockedError({ retryAfter? })` | Site is refusing access (anti-bot, IP block). | `blocked` | No by default; if `retryAfter` is set, after that. |
| `CaptchaError({ service?, retryAfter? })` (extends `BlockedError`) | Specifically a CAPTCHA. Auto-thrown when the framework's [built-in detection](/architecture/framework#built-in-captcha-detection) matches Cloudflare, Datadome, PerimeterX, Incapsula, or Akamai — authors don't need to detect those manually. `service` carries the matched service name. | `blocked` | No. |
| `TransientError({ retryAfter? })` | Temporary failure — network reset, timeout, 5xx. Framework auto-creates from connection-level failures; authors can throw for content-level transient signals. | `error` | Yes, exponential backoff. |
| `PermanentError({ reason })` | Won't heal — content removed, page deleted, structurally wrong. | `error` | No. |
| `BadResponseError({ reason })` | Generic "this response is not right but I'm not sure why". | `error` | No. |

**Extraction errors** (about extracting from a good response — only thrown from `extract` or field functions):

| Error | Meaning |
|---|---|
| `MissingDataError({ field, reason })` | Required data wasn't found on a page we accepted. |
| `MalformedDataError({ field, reason })` | Data was present but structurally wrong. |

**Internal:**

| Error | Meaning |
|---|---|
| `ValidationError` | Framework throws after extract when the result fails schema validation. Authors don't throw it. |

**Circuit-breaker interaction:** only response errors count toward opening the per-host [circuit breaker](#circuit-breaker). Extraction errors are author bugs, not site outages.

**Related:** [checkResponse](#checkresponse), [Circuit breaker](#circuit-breaker), [Extract](#extract).

## Freshness

**What it is:** the contract by which a consumer expresses how recent the data needs to be, and what the server returns.

Every extract response carries two timestamps:

- **`extractedAt`** (always present, ISO-8601). When the underlying extraction ran. Same value across cached and fresh responses for the same row — the answer to "how old is this data?"
- **`cachedAt`** (present iff `cached: true`). When the cache row was written. Equal to `extractedAt` for the row that produced the cache entry.

Consumers control freshness through three knobs:

- **`?maxAge=15m`** — "I need data ≤ 15 minutes old." If the cached row's `extractedAt` is within the requested age, the server serves it. If older, the server re-extracts. Unrelated to the resource's own [TTL](#ttl) — that's the *author's* cache policy.
- **`?fresh=true`** — force a live re-extraction, regardless of cache age.
- **`acceptStale`** — controls the stale-cache fallback when re-extraction fails. `acceptStale: true` (default) returns the cached value with `status: "stale"` even if it's past `maxAge` or the resource's TTL. `acceptStale: false` makes the call fail with `status: "error"` instead — data older than your freshness constraint is never returned.

`fresh: true` and `maxAge: "Xm"` compose: a fresh request always re-extracts; a maxAge-constrained request only re-extracts when the cache is too old.

**Related:** [Cache](#cache), [TTL](#ttl), [Status](#status), [Grace window](#grace-window).

## Grace window

**What it is:** how long past its [TTL](#ttl) a [cached](#cache) row remains servable as a stale fallback. Configured server-side via `CACHE_STALE_GRACE_MS` (default 7 days). After the grace window expires, the cold cache row is no longer returned on extraction failure.

**Edge case:** the grace window applies to stale fallback only. A successful fresh extraction overwrites the row regardless of whether the previous value was inside the grace window.

**Related:** [Cache](#cache), [TTL](#ttl).

## Identity bucket

**What it is:** a tag attached to a [site package](#site-package) telling consumers what kind of site it scrapes. One of:

- `reputable` — clear terms of service, public site, no anti-scraping posture.
- `gray` — ambiguous terms or posture.
- `hostile` — explicit anti-scraping policy. Consumer-beware.

**What it is not:** a moral judgement. It's routing information so a consumer can decide whether they want to use the package given their own constraints.

**Surfacing:** assigned by a human reviewer during [verification](#verified) and stored in the [manifest](#manifest). The directory and `GET /v1/sites/:domain` expose it for consumers who want to filter or warn before calling.

**Related:** [Site package](#site-package), [Verified](#verified).

## JSON Schema

**What it is:** the static build-time export of each [schema](#schema) a [site definition](#site-definition) declares. Written to `dist/schemas/<Name>.json`. Used by tools that need to introspect a Resource's output shape without depending on whichever validation library the author chose.

**Distinct from:** [Standard Schema](#standard-schema). Standard Schema is the *runtime* interface every validator implements; JSON Schema is the *static*, language-agnostic export. Both come from the same source schema in the site definition — the build converts one into the other.

**The `schema-emission-roundtrip` test** ensures the two stay in agreement: it validates extraction output against the emitted JSON Schema and fails if the emitted shape can't accept what the runtime validator accepts.

**Related:** [Schema](#schema), [Standard Schema](#standard-schema).

## JSON-LD

**What it is:** structured data embedded in HTML pages using `<script type="application/ld+json">`. Common on news, e-commerce, and recipe sites. The [extract context](#extract-context) exposes `jsonLd(type?)` for reading it from inside a [site package](#site-package)'s `extract` function.

**Related:** [Extract context](#extract-context).

## Locale

**What it is:** how a site serves multiple languages or regions, declared in the [site definition](#site-definition):

```ts
locales: {
    source: 'host' | 'path' | 'query',  // where the locale appears in the URL
    values: ['en', 'fr', 'de'],          // accepted values
    default: 'en'
}
```

**Effects:**

- The [cache](#cache) key always includes locale.
- Robots.txt is per-[origin](#origin), so locale-in-host means one robots.txt per locale; locale-in-path means one shared robots.txt.
- [Test](#test) enforces fixtures across at least two declared locales (the locale-matrix check).

**Related:** [Origin](#origin), [Site definition](#site-definition).

## Manifest

**What it is:** the file `dist/manifest.json` inside every [site package](#site-package)'s [build output](#build-output). Describes the package in declarative form: site identity + version, origins, resources, pages, locale strategy, framework version range, source commit. Produced by [build](#build); never written by hand.

**Why it exists:** to give every downstream tool a single, language-agnostic document to read. The server cross-checks it on load. The directory renders from it. The [`manifest-integrity`](#test) check asserts that rebuilding produces the same bytes.

**Baseline copy.** A previous manifest is committed to `dist/baseline-manifest.json` and used by the [`semver-discipline`](#semver-discipline) check to detect breaking changes between releases.

**Edge case:** the manifest must regenerate byte-for-byte identically from source. This rules out timestamps from `Date.now()`, unsorted object keys, locale-dependent number formatting.

**Related:** [Build output](#build-output), [Schema](#schema), [semver-discipline](#semver-discipline).

## NULL_ELEMENT

**What it is:** the singleton [page element](#page-element) returned by `.first()` (and similar) when the selection is empty. Every operation on `NULL_ELEMENT` returns a safe default — `""` from `.text()`, `null` from `.attr()`, `[]` from `.children()`, `false` from `.exists()`.

**When to use it:** rarely. `ctx.$("h1")?.text() ?? ""` is the idiomatic missing-element handling for extract functions. `NULL_ELEMENT` is plumbing for driver implementations that compose elements internally; site code should let `$()` return `null` for "no match" and handle it with `?.`.

**Related:** [Page element](#page-element).

## OpenAPI spec

**What it is:** the OpenAPI 3.1 document `generateOpenApiSpec(sites)` emits from a list of site definitions. Every resource becomes a `/v1/sites/{host}/{resource}` route; the generic `/v1/extract`, `/v1/sites`, `/v1/schemas`, and `/healthz` endpoints are added uniformly. The CLI runs the generator via `sitely openapi`.

**Edge case:** a resource whose [URL pattern](#url-pattern) carries params not covered by the page's pattern parser is rejected by the emitter — the URL template would be ill-formed.

**Related:** [Resource](#resource), [URL pattern](#url-pattern).

## Origin

**What it is:** a protocol + host pair that a [site package](#site-package) operates on. One package can have several origins (multi-language sites with locale-in-host; [families](#family)).

**Related:** [Family](#family), [Locale](#locale), [Site package](#site-package).

## Page

**What it is:** a [URL pattern](#url-pattern) declared in a [site definition](#site-definition) plus the functions that operate on matching responses. A page declares:

- `validate(ctx)` — does this HTML belong to this page pattern?
- `extract(ctx)` — produce resource data via [field functions](#field-function)
- `paginate?` — optional pagination behaviour (`next(ctx) => string | null`)
- `fixtures` — typed `{ params, errorCase? }` entries that drive the test suite

The page's *first argument* is the URLPattern itself: `.page(articleUrl, { ... })`. The pattern provides `ctx.params` typing inside `validate` and `extract`. Which resources a page yields is derived automatically from the keys of `extract`'s return — no separate `provides` declaration.

**Pages map URL patterns → N resources.** One page (`/wiki/:title`) can produce one resource (`article`); another page (`/category/:slug`) can produce two (`category` + `itemList`).

**Related:** [Resource](#resource), [Site definition](#site-definition), [Extract](#extract), [Validate](#validate), [URL pattern](#url-pattern).

## Page driver

**What it is:** the interface a [driver](#driver) implements. Defines `$(selector)` and `$$(selector)` plus the methods on [page element](#page-element). The framework uses a driver — not Cheerio directly — so that future implementations (JSDOM, Playwright) can be drop-in replacements.

**Related:** [Driver](#driver), [Page element](#page-element).

## Page element

**What it is:** the read-only DOM-node abstraction returned by `ctx.$(selector)` and the items in `ctx.$$(selector)`. Defines methods like `.text()`, `.attr(name)`, `.find(selector)`, `.exists()`. Read-only by design — [extract](#extract) functions don't mutate the DOM.

**Related:** [Page driver](#page-driver), [Extract context](#extract-context), [NULL_ELEMENT](#null-element).

## Pagination

**What it is:** how the server walks a multi-page resource. A [page](#page) can declare `paginate.next(ctx)` returning the next URL; the orchestrator follows it until exhausted, the consumer's `maxPages` budget is hit, or a `next` returns `null`.

The response carries a `pagination` block: `{ pagesReturned, hasMore, cursor, totalPages?, totalItems? }`. `cursor` is an opaque [cursor](#cursor); pass it back to resume.

**Merge semantics for walk-many.** When the consumer passes `paginate=true&maxPages=N`, the server merges results across pages: array-typed resources are concatenated; scalar-typed resources are kept from the first page only. `pagination.pagesReturned` reflects the actual walk.

**Edge case:** `maxPages` is a budget, not a guarantee. The walk stops at the budget, at upstream exhaustion, or when the server's wall-time budget runs out — whichever comes first.

**Related:** [Cursor](#cursor), [Page](#page).

## Presence annotation

**What it is:** the `presence(schema, rate)` wrapper authors put around any [schema](#schema) field marked `.optional()`, `.nullable()`, or `.nullish()` to declare how often the field is expected to be present:

```ts
import { presence } from "@sitely/framework";

const Article = z.object({
    headline: z.string(),                                // required (implicit presence 1.0)
    author:   presence(z.string().nullable(), 0.9),      // present ~90% of the time
    abstract: presence(z.string().nullable(), 0.3),      // present ~30% of the time
});
```

**Mandatory for optional/nullable.** Build fails if any `.optional()` / `.nullable()` / `.nullish()` field lacks a `presence()` wrapper. The point: every author has to commit to "how often is this present?" rather than silently shipping a field that's always absent and never noticed.

**Runtime use.** Drift telemetry samples extractions and alerts when the observed rate diverges from the declared rate beyond a tolerance — catches the silent regression case ("the selector broke and now the field is always absent, but the schema still passes").

**Test-time use.** Independent of presence, the [`fixture-coverage`](#test) warning fires when fixtures don't cover both present-and-absent for any optional/nullable field.

**Related:** [Schema](#schema), [Test](#test).

## Rate limit

**What it is:** the two independent budgets sitely enforces around every request.

- **Inbound (per-API-key).** How many requests *you* can send the server in a window. Operator-configured via `RATE_LIMIT_PER_KEY_PER_MINUTE`. Exceeding it returns `429` with `Retry-After`.
- **Outbound (per-site).** How fast the server fetches from a target site, declared by the [site definition](#site-definition)'s `rateLimit: { maxConcurrent, requestsPerSecond }`. Token-bucket internally; adaptive backoff on `429`/`Retry-After`/network errors. Authors declare intent; framework handles deviation.

For sub-unitary rates, prefer the fraction form (`requestsPerSecond: 1/5`) over decimals (`0.2`) — it's self-documenting.

There's also a server-wide cap (`SERVER_MAX_INFLIGHT_EXTRACTIONS`) and a per-hostname [circuit breaker](#circuit-breaker) that the framework runs alongside these budgets.

All state is Redis-backed so limits work across replicas.

**Coalescing helps.** Ten clients calling the same URL count as one outbound request against the per-site limit; each caller is billed independently against their per-key budget.

**Related:** [API key](#api-key), [Circuit breaker](#circuit-breaker), [Coalesce](#coalesce).

## Removed

**What it is:** a [status](#status) for a [site package](#site-package) version. The package is no longer listed in the directory, and the server may refuse to load it depending on configuration. Use "removed" — not "revoked" — in user-facing docs.

**Reasons a package gets removed:**

- Proven malicious behaviour
- A supply-chain compromise (e.g. a compromised npm dependency)
- A formal removal request from the site owner (DMCA, GDPR right-to-erasure, regional equivalents)

**Edge case:** removal is per-version. A new version of the same package starts at [unverified](#unverified) and runs through checks again.

**Related:** [Status](#status), [Verified](#verified).

## Request coalescing

See [Coalesce](#coalesce).

## Resource

**What it is:** a typed thing a [site package](#site-package) produces. The primary unit a consumer asks for. Every Resource has:

- **a name** scoped to its site package — `wikipedia:article`, `nytimes:article`
- **a [URL pattern](#url-pattern)** — `url: urlPattern("/article/:id")` — that doubles as the param shape (via the literal pattern) and the URL builder/parser
- **a schema** — the [Standard Schema](#standard-schema) validator that describes the Resource's data shape and validates at runtime
- **a [TTL](#ttl)** — how long extractions of this Resource stay fresh

**Resources are sitely's own concept, not schema.org's.** A Resource's schema *may* compose one or more schema.org types — exposing `@type: "Article"` and the schema.org `Article` fields — but it isn't limited to them. A `wikipedia:article` Resource's schema can carry every schema.org `Article` field *plus* Wikipedia-specific fields (`pageId`, `revisionId`, `categories`, …), or no schema.org fields at all. Schema.org is an interop target where useful, not a ceiling.

**Resource identifiers are scoped to the package.** `wikipedia:article` and `nytimes:article` are different Resources; there's no global `article` namespace. This is so two packages can each have an `article` resource without colliding.

**Derived resources** declare `derivedFrom: "<resourceName>"` rather than a URL pattern — they piggyback on another resource's fetch. See [derivedFrom in the framework architecture](/architecture/framework).

**One [page](#page) can produce multiple Resources.** A category-listing page might yield both `category` and `itemList`.

**Wire shape vs client shape.** The HTTP API always keys `ExtractResult.data` by resource name — `{ "article": {...} }` or `{ "category": {...}, "itemList": [...] }`. The TypeScript client unwraps `data` to the named resource *iff* the call is resource-driven with no `include` option: `sitely.site(d).resource("article", params)` returns just the article. URL-driven calls (`sitely.extract({ url })`) and resource-driven calls with `include` return the keyed shape verbatim. The wire is the contract; the unwrap is a call-site convenience.

**Related:** [Page](#page), [Schema](#schema), [Site definition](#site-definition), [Standard Schema](#standard-schema), [URL pattern](#url-pattern).

## Resource filter

**What it is:** the `?resources=article,comments` HTTP query (or `{ include: [...] }` client option) that lets consumers restrict which resources a multi-resource page returns.

**Response-time projection only.** The server always runs extract fully and caches every resource declared by the page. The filter is applied when shaping the response. This keeps the cache uniform — different consumers asking for different subsets of the same page all hit the same cache row.

**Related:** [Cache](#cache), [Resource](#resource).

## Response snapshot

**What it is:** the object passed to [`checkResponse(fn)`](#checkresponse). Carries everything needed for a smoke-test of the fetched response without forcing a full DOM parse.

```ts
interface ResponseSnapshot {
    status: number;
    headers: Record<string, string>;
    body: string;                          // defaults to "" for empty responses
    url: string;                           // final URL after redirects
    has(selector: string): boolean;        // cheap exists-check on the parsed DOM
    includes(text: string): boolean;       // substring check on body text — cheaper than has()
}
```

Designed so `checkResponse` can answer "does this look like a rate-limit page?" in one or two cheap calls, before paying for full DOM parsing on the extract path.

**Related:** [checkResponse](#checkresponse).

## Retry topology

**What it is:** the two-layer model that describes where retries happen in sitely.

**Hop 1 — client ↔ sitely server.** The [TypeScript client](/guide/using-the-client)'s `retry` config retries transport failures (DNS, TCP reset, timeout) and `5xx` / `429` responses from the sitely server itself.

**Hop 2 — sitely server ↔ target website.** `extract-service` retries internally on [`TransientError`](#framework-errors) (DNS, TCP reset, timeout, 5xx from the target). Default: 3 attempts, exponential backoff (250ms → 1s → 4s) with ±25% jitter, ~5.5s worst-case added latency.

**No double-retry.** Hop 2 retries are invisible to Hop 1: by the time the client sees a response, the server is done retrying. The client does *not* retry on `status: "error"` / `"stale"` / `"blocked"` body shapes — those are successful HTTP exchanges that returned the server's final answer.

**Outcomes that bypass Hop 2 retries:** [`BlockedError`](#framework-errors), [`CaptchaError`](#framework-errors), [`PermanentError`](#framework-errors), [`BadResponseError`](#framework-errors). [`RateLimitedError`](#framework-errors) feeds adaptive backoff in the rate-limiter instead of retrying.

The canonical specification lives in [server.md → Retry topology](/architecture/server#retry-topology).

**Related:** [Framework errors](#framework-errors), [Rate limit](#rate-limit), [Circuit breaker](#circuit-breaker).

## Schema

**What it is:** a [Standard Schema](#standard-schema) validator that defines the shape of a [Resource](#resource)'s data. Site authors write schemas using their preferred validation library (Zod, Valibot, ArkType, …); the framework only interacts with the Standard Schema interface.

**Runtime validation is mandatory.** The server validates every fresh extraction against its resource's schema before persisting it; the [test suite](/guide/testing)'s `schema-conformance` check validates every fixture's extraction the same way. Bad data never enters the cache.

**Mandatory [presence](#presence-annotation) annotation** for any field marked `.optional()`, `.nullable()`, or `.nullish()`. The build fails otherwise — every author has to commit to "how often is this present?"

**Build emits each schema as JSON Schema** to `dist/schemas/<Name>.json`. Downstream tools read the JSON Schema and don't need to care which library the author used.

**Schemas can implement schema.org types but aren't limited to them.** A schema can structurally match schema.org's `Article` (carrying `@type: "Article"` plus the schema.org fields) *and* add fields beyond it. Schema.org is the interop target — what consumers can rely on across sites — not a ceiling. See [Resource](#resource) for the broader point.

**`@sitely/schemas`** provides base schemas for common schema.org types (`Article`, `Product`, `Person`, …). They are **generated** from schema.org's published vocabulary, not hand-maintained. Site authors compose or extend them rather than rewriting them. [Asset](#asset) fields use the `asset(...)` brand from this package.

**Related:** [Asset](#asset), [JSON Schema](#json-schema), [Presence annotation](#presence-annotation), [Resource](#resource), [Standard Schema](#standard-schema).

## Segment

**What it is:** a unit of [site definition](#site-definition) split out into its own file via `defineSegment()`. Lets authors keep `index.ts` small by relocating page/resource declarations and composing them back via `.use(segment)` on the main builder.

```ts
// pages/article.ts
export const articleSegment = defineSegment()
    .resource("article", { schema: Article, url: articleUrl, ttl: TTL.daily })
    .page(articleUrl, { ... });

// index.ts
export default defineSite({...})
    .use(articleSegment)
    .use(commentsSegment)
    .build();
```

**Strict ordering.** A segment carries a `requires` type describing which resources it depends on (via `derivedFrom` references). `.use()` is type-checked against what's accumulated so far — composing a segment before its dependency is a compile error.

**Related:** [Builder](#builder), [Site definition](#site-definition).

## semver-discipline

**What it is:** the test-suite check that diffs the freshly-built [manifest](#manifest) against the committed `dist/baseline-manifest.json` and asserts the version bump in `package.json` is appropriate for the changes:

- Breaking changes (resource removed, schema field removed, optional→required, type narrowed, page URL pattern changed) require a major bump.
- Additive changes (resource added, optional field added, type widened) require at least a minor bump.
- Patch bumps are fine for any cosmetic change.

The check is one of the eight must-pass checks; `sitely build` itself doesn't enforce SemVer — the build always succeeds. The check is what gates publish.

**Baseline file.** `dist/baseline-manifest.json` is committed alongside `dist/manifest.json` and rotated forward at publish time.

**Related:** [Manifest](#manifest), [Test](#test).

## Site definition

**What it is:** the object produced by the [builder](#builder) chain starting at `defineSite({...})` in a [site package](#site-package)'s `index.ts`. The single declarative description of how to extract data from one site. Contains: site identity (id, displayName, version), origins, locale strategy, resources (each with its own schema, URL pattern, TTL), pages, an optional [checkResponse](#checkresponse) step, rate-limit rule, and optionally a family or crawl configuration.

**Use "site definition" — not "site config", not "site spec".** These three terms used to drift in early drafts; the canonical name is "site definition".

**Related:** [Builder](#builder), [Segment](#segment), [Site package](#site-package), [Resource](#resource), [Page](#page), [Schema](#schema).

## Site package

**What it is:** an npm package that contains one [site definition](#site-definition), its [fixtures](#fixture), and the [build output](#build-output). Naming: `@sitely/site-<name>` for sitely-curated packages, or `<author>-site-<name>` for community packages.

**Layout:**

```
packages/<author>-site-foo/
├── package.json
├── src/
│   ├── index.ts             # defineSite({...}).use(...).build()
│   └── pages/
│       ├── article.ts       # defineSegment().resource(...).page(...)
│       └── ...
├── fixtures/
│   └── article/
│       ├── <hash>.html
│       ├── <hash>.expected.json
│       └── <hash>.meta.json
├── dist/                     # produced by `sitely build` — committed
│   ├── index.js              # compiled site, version injected from package.json
│   ├── manifest.json
│   ├── baseline-manifest.json
│   └── schemas/
│       └── Article.json
└── *.test.ts                # uses @sitely/framework/testing
```

**Related:** [Site definition](#site-definition), [Fixture](#fixture), [Manifest](#manifest).

## Snapshot

**The verb:** to fetch a live URL and save it as a [fixture](#fixture). `sitely snapshot <url>` does this. Snapshots ignore robots.txt because they're explicit author-initiated actions, not server-side traffic.

**The noun (snapshot):** the captured `<name>.html` file plus its `<name>.meta.json`.

**Related:** [Fixture](#fixture).

## Standard Schema

**What it is:** the validator-agnostic interop format defined at <https://standardschema.dev>. Validation libraries (Zod, Valibot, ArkType, Yup, Effect/Schema, …) implement it. sitely's framework only speaks Standard Schema, so it never has to know which library the author chose.

**Why it matters for sitely:** the framework needs to validate extracted data at runtime — against fixtures in `sitely test`, against example URLs during build, and (if telemetry is enabled) against live extractions. Standard Schema makes that validation library-agnostic: the same `validate(data)` call works whether the author wrote the schema in Zod or Valibot.

**Distinct from:** [JSON Schema](#json-schema). Standard Schema is the runtime interface for validators; JSON Schema is the static export format the build emits.

**Related:** [JSON Schema](#json-schema), [Schema](#schema).

## Status

**Two senses, two contexts.**

**Site-package status** — the version's current state in the directory. One of four:

| Status | Meaning |
|---|---|
| [Unverified](#unverified) | Just published; checks haven't completed yet, or haven't started |
| [Verified](#verified) | All checks pass; reviewed |
| [Drift suspected](#drift-suspected) | Live behaviour has diverged from declared behaviour |
| [Removed](#removed) | Taken down; reasons listed in the directory entry |

Status is per-version. A new version of the same package starts at unverified and works its way through.

**Response status** — the `status` field in every `ExtractResult`. One of seven, with HTTP 200 in every case unless noted:

| `status` | Meaning |
|---|---|
| `success` | Fresh or cache-fresh extraction; `data` populated. |
| `stale` | Cached value past TTL or past the consumer's `?maxAge=` constraint, returned because a re-extract failed and [`acceptStale`](#freshness) allowed the fallback. `data` populated, `cached: true`. Only emitted when `acceptStale` is true (the default). |
| `no_matching_site` | The URL's hostname doesn't match any installed [site package](#site-package). HTTP 404. `data: null`. No generic-extraction fallback; install or write a package. |
| `blocked` | The target site refused the fetch (anti-bot, CAPTCHA, 403). `data: null` or partial. |
| `forbidden_by_robots` | The target's `robots.txt` disallowed the URL. `data: null`. |
| `rate_limited` | Per-key or per-site rate limit fired. HTTP 429 with `Retry-After`. `data: null`. |
| `error` | Anything else — transient failure, schema validation failure, framework crash, or `acceptStale: false` with a failed re-extract and a stale cached row. `data: null`. |

**Related:** [Drift suspected](#drift-suspected), [Removed](#removed), [Unverified](#unverified), [Verified](#verified), [Freshness](#freshness), [Framework errors](#framework-errors).

## Templated origin

**What it is:** an entry in `origins[]` whose `hostname` carries a placeholder, marked with `templated: true`. Two patterns are supported:

- **`{locale}.example.com`** — locale substitution, expanded against `locales.values` at use-time. One package, one identity, many concrete hostnames.
- **`*.example.com`** — SaaS-style wildcard for multi-tenant cases. Any subdomain matches; the tenant identifier becomes part of the dispatch lookup but doesn't fan out into N concrete origins.

Both shapes flow into the manifest's `origins[]` with `templated: true` preserved. `getActiveOrigins()` returns the concrete list at use-time.

**Edge case:** a templated `{locale}` origin requires a `locales` block to expand against; a templated `*.x` origin doesn't. Mixing the two on one entry isn't supported.

**Related:** [Locale](#locale), [Origin](#origin).

## Test

**The verb:** to run `sitely test`, which executes the test suite against a [site package](#site-package)'s [fixtures](#fixture). The suite is eight must-pass checks (`fixture-extraction`, `schema-conformance`, `determinism`, `schema-emission-roundtrip`, `locale-matrix`, `error-path-coverage`, `manifest-integrity`, [`semver-discipline`](#semver-discipline)) plus warning-only checks (`fixture-freshness`, `performance-budget`, `ttl-plausibility`, `fixture-coverage`). See [Test suite](/guide/testing) for what each does.

**Related:** [Fixture](#fixture), [semver-discipline](#semver-discipline).

## TTL

**What it is:** "time to live" — how long a cached extraction stays fresh by the *author's* default. Each [resource](#resource) declares its TTL as a triple:

```ts
ttl: { default: "1h", min: "5m", max: "24h" }
```

**The three fields:**
- `default` — author's per-resource decision: how long a freshly-extracted row is considered fresh when the consumer doesn't override.
- `min` — floor for consumer max-age requests. Protects the upstream site from over-refresh — a consumer asking for `?maxAge=10s` against a resource with `min: "5m"` clamps to 5 minutes.
- `max` — ceiling. A consumer asking for `?maxAge=7d` against a resource with `max: "24h"` clamps to 24 hours.

**Authors must declare TTL per resource.** There's no operator-side default — the framework refuses to load a manifest with a resource missing a TTL. See [TTL preset](#ttl-preset) for the named common values.

**Distinct from consumer `?maxAge=`.** The resource's TTL is the author's policy; the consumer's `?maxAge=` is a freshness constraint clamped to that policy. See [freshness](#freshness) for the consumer side.

**Edge case:** when an extract fails, the server falls back to stale cache past the TTL, up to the [grace window](#grace-window), provided the consumer's [`acceptStale`](#freshness) preference allows it.

**Related:** [Cache](#cache), [Freshness](#freshness), [Resource](#resource), [TTL preset](#ttl-preset), [Grace window](#grace-window).

## TTL preset

**What it is:** the named common values exported from `@sitely/framework` for resource TTLs. Each preset is a `{ default, min, max }` triple sized for a common content cadence:

| Preset | `{ default, min, max }` | Use for |
|---|---|---|
| `TTL.realtime` | `{ "30s", "10s", "5m" }` | News tickers, live scores. |
| `TTL.short` | `{ "5m", "1m", "1h" }` | Listings, feeds. |
| `TTL.medium` | `{ "1h", "10m", "6h" }` | Articles, posts. |
| `TTL.daily` | `{ "24h", "1h", "7d" }` | Evergreen content, archives. |
| `TTL.weekly` | `{ "7d", "1d", "30d" }` | Reference pages, glossaries. |

Authors can still write `{ default, min, max }` explicitly for custom shapes; presets cover most cases.

**Related:** [TTL](#ttl), [Resource](#resource).

## Unverified

**What it is:** the default [status](#status) for a newly-published [site package](#site-package) version. The package is usable, but no automated checks have confirmed it works yet. Once checks complete, the status moves to [verified](#verified) or stays unverified if any check failed.

**Related:** [Status](#status), [Verified](#verified).

## URL pattern

**What it is:** a bidirectional URL primitive built from a literal template string. The helper `urlPattern(pattern, paramsSchema?)` returns a `URLPattern<TParams>` whose `TParams` is inferred from the `:segment` placeholders in the literal:

```ts
const articleUrl = urlPattern("https://blog.example.com/article/:id");
//        ^^^^^^^^^^ URLPattern<{ id: string }>

articleUrl.toUrl({ id: "hello-world" });            // → "https://blog.example.com/article/hello-world"
articleUrl.parseUrl("https://blog.example.com/article/hello-world");  // → { id: "hello-world" }
```

**Optional runtime validation** via a second argument — a Standard Schema over the params:

```ts
const articleUrl = urlPattern("https://blog.example.com/article/:id", {
    id: z.string().regex(/^[A-Za-z0-9_-]+$/),
});
```

A `URLPattern` is used in two places: as a [resource](#resource)'s `url` (replacing separate `params + resolve`), and as a [page](#page)'s first argument (binding `ctx.params` to the matched values).

**Related:** [Page](#page), [Resource](#resource).

## Validate

**The verb:** to check that a piece of HTML actually belongs to a particular [page](#page) pattern. Every page declares `validate(ctx)` returning `true` or `false`. Used to catch cases where the URL matches the pattern but the HTML is something else — a captcha, a "this page was removed" stub, a login wall.

**Edge case:** if `validate` returns `false`, the framework records the result and skips `extract`. The `error-path-coverage` test asserts that any fixture marked `errorCase: true` produces `validate === false`.

**Related:** [checkResponse](#checkresponse), [Extract](#extract), [Page](#page).

## Verified

**What it is:** a [status](#status) meaning all eight checks pass and a human has reviewed the package. Verified is per-version: a new version of the same package starts at [unverified](#unverified) again.

**The eight checks** are listed at [The test suite](/guide/testing). All eight must pass to leave [unverified](#unverified).

**Human review** covers three things automation can't see well: selector fragility, [identity bucket](#identity-bucket) assignment, and README sanity.

**Related:** [Drift suspected](#drift-suspected), [Removed](#removed), [Status](#status), [Unverified](#unverified).

---

## Words this glossary deliberately avoids

A few words appear in early drafts of sitely docs but are not used in current documentation. If you see them in a doc, that's a leftover to fix.

- **Capability, capabilities.** The runtime no longer enforces a declared capability surface — site packages run in the server process with full Node privileges. Trust comes from the operator's lockfile. A future managed/hosted service handles isolation at the service layer, not in the framework. See [future direction](/future/).
- **Sandbox, sandboxed, worker_threads.** Same reason as above — the framework doesn't sandbox extraction code.
- **`provides` (as a page field).** Derived automatically from `extract`'s return keys; not declared explicitly.
- **`examples` (as a page field).** Fixtures' typed `params` give the framework everything `examples` used to. No separate field.
- **`schemas` (as a top-level block).** Schemas live on each resource directly via `.resource("x", { schema: X, ... })`; no central registration.
- **MediaRef, `ctx.media(url)`.** Renamed to [Asset](#asset); declared via the `asset(...)` brand on schema fields, not via a runtime helper.
- **Revocation, revoked.** Use [removed](#removed) instead.
- **Constitutional, constitution.** Use "design rule" or just describe what the rule is.
- **Keystone, keystone artifact.** Use "single shared artifact" or refer to the [manifest](#manifest) by name.
- **Moat, corpus-as-moat, cache-as-moat.** Don't use. These were business-strategy framings that crept into early drafts.
- **Phase 1, Phase 2, deferred.** Describe what sitely does today; if a feature isn't available, link to the [future direction](/future/) page instead of attaching a phase label.
- **Endorsed tier, verified attestation.** Single tier for now; use [verified](#verified).
- **Provenance** (in the sense of npm provenance). When relevant, say "the chain of evidence linking a published package to its source commit" or similar.
- **Fail closed.** Use "rejects when ambiguous" or "defaults to denying."
