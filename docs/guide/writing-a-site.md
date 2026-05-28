# Writing a site package

This page walks through writing a [site package](/overview/glossary#site-package) from scratch. By the end you'll have a working TypeScript file, a set of HTML fixtures, and a built manifest — enough to publish.

If you want the architecture-level view (why things are shaped the way they are), see [Site packages](/architecture/sites). This page is the hands-on companion.

## What you're going to write

A site package is, in practice, a TypeScript file plus a folder of HTML. You write a `src/index.ts` that chains `defineSite({...}).resource(...).page(...).build()`, you check in a few HTML [fixtures](/overview/glossary#fixture) under `fixtures/`, and `sitely build` produces the compiled `dist/index.js`, the [manifest](/overview/glossary#manifest), and JSON Schema sidecars for you. No code generation outside `sitely build`, no decorators, no boilerplate — the [builder](/overview/glossary#builder) declares your site step-by-step with type safety on every cross-reference.

## The package layout

A finished site package looks like this:

```
packages/<author>-site-foo/
├── package.json
├── src/
│   ├── index.ts            # defineSite(...).resource(...).page(...).build()
│   └── pages/
│       ├── article.ts      # defineSegment().resource(...).page(...) — optional segments
│       └── ...
├── fixtures/
│   └── article/
│       ├── <hash>.html
│       ├── <hash>.expected.json
│       └── <hash>.meta.json
├── dist/                   # produced by `sitely build` — committed
│   ├── index.js            # compiled site, version injected from package.json
│   ├── manifest.json
│   ├── baseline-manifest.json    # rotated forward at publish time
│   └── schemas/
│       └── Article.json    # one JSON Schema per declared schema
├── *.test.ts               # uses @sitely/framework/testing
└── README.md
```

Two things about the layout:

1. **`dist/` is checked in.** The [build output](/overview/glossary#build-output) is part of the package. Reviewers, the directory, and downstream tools read it without running the build. The `manifest-integrity` check regenerates the manifest and asserts it matches the committed copy byte-for-byte.
2. **Tests run against fixtures, not the live site.** Every check operates on the HTML you've captured. That's what makes the test suite deterministic — the website can change, your CI run doesn't. Live re-validation is a separate opt-in (`sitely check --live`).

The naming convention for the package itself is `@sitely/site-<name>` for sitely-curated packages or `<author>-site-<name>` for community packages. See [Publishing](/guide/publishing).

## A complete minimal example

Here's a working `src/index.ts` for a small blog site. Read it once top to bottom; the field-by-field walkthrough follows.

```ts
// src/index.ts
import { defineSite, urlPattern, presence, asset, TTL, RateLimitedError, CaptchaError } from "@sitely/framework";
import { z } from "zod";
import pkg from "../package.json" with { type: "json" };

const articleUrl = urlPattern("https://blog.example.com/article/:id");

const Article = z.object({
    "@type": z.literal("Article"),
    headline: z.string(),
    body: z.string(),
    author: presence(z.string().nullable(), 0.9),
    heroImage: presence(asset("image"), 0.7),
});

export default defineSite({
        site: {
            id: "example-blog",
            displayName: "Example Blog",
            version: pkg.version,
            homepage: "https://blog.example.com/",
        },
        origins: [{ hostname: "blog.example.com" }],
        rateLimit: { maxConcurrent: 2, requestsPerSecond: 1 },
    })
    .checkResponse((response) => {
        if (response.status === 429) {
            throw new RateLimitedError({
                retryAfter: Number(response.headers["retry-after"] ?? 60) * 1000,
            });
        }
        if (response.has(".captcha-challenge")) {
            throw new CaptchaError();
        }
    })
    .resource("article", {
        schema: Article,
        url: articleUrl,
        ttl: TTL.daily,
    })
    .page(articleUrl, {
        validate: (ctx) => ctx.$("article").exists(),
        extract: async (ctx) => ({
            article: {
                "@type":   () => "Article" as const,
                headline:  () => ctx.$("h1").text(),
                body:      () => ctx.$("article .content").text(),
                author:    () => ctx.$(".byline").text(),
                heroImage: () => ctx.$('meta[property="og:image"]').attr("content"),
            },
        }),
        fixtures: [
            { params: { id: "hello-world" } },
            { params: { id: "removed-post" }, errorCase: true },
        ],
    })
    .build();
```

That's the whole package. Now field by field.

### `defineSite({ site, origins, rateLimit })`

The header. Three required pieces:

```ts
defineSite({
    site: { id: "example-blog", displayName: "Example Blog", version: pkg.version },
    origins: [{ hostname: "blog.example.com" }],
    rateLimit: { maxConcurrent: 2, requestsPerSecond: 1 },
})
```

- **`site.id`** — the namespace prefix used everywhere: cache keys, [resource](/overview/glossary#resource) identifiers (`example-blog:article`), directory URLs. Pick something short, lowercase, and unique to your package. Permanent — changing it breaks every cache entry and downstream reference.
- **`site.displayName`** — what humans see in the directory.
- **`site.version`** — imported from your `package.json`. `sitely build` validates this matches; the client sends it with every request so the server can `409` on major-version mismatch.
- **`origins`** — the protocol+host pairs your package operates on. The server dispatches incoming URLs to your package by hostname. Multi-locale sites with locale-in-host use a templated origin (`{locale}.wikipedia.org` with `templated: true`).
- **`rateLimit`** — per-origin outbound rate. The framework's token-bucket internals respect it; adaptive backoff handles 429s automatically.

For sub-unitary rates, prefer the fraction form (`requestsPerSecond: 1/5`) over decimals (`0.2`) — it reads as "one request every five seconds" rather than asking the reader to do arithmetic.

### `.checkResponse(fn)` — site-wide response smoke test

Runs before per-page `validate` / `extract`. Receives a [response snapshot](/overview/glossary#response-snapshot) with `status`, `headers`, `body`, `url`, plus cheap `has(selector)` and `includes(text)` helpers. Throws a [framework error](/overview/glossary#framework-errors) when the response itself looks bad:

```ts
.checkResponse((response) => {
    if (response.includes("Something went wrong")) {
        throw new RateLimitedError({ retryAfter: 60_000 });
    }
    if (response.has(".captcha-challenge")) {
        throw new CaptchaError();
    }
    if (response.url.endsWith("/account/login")) {
        throw new PermanentError({ reason: "redirected to login" });
    }
})
```

Connection-level failures (timeout, DNS, TCP reset) bypass `checkResponse` — the framework treats those as `TransientError` automatically with backoff retry.

**Common CAPTCHA services are detected automatically.** Cloudflare, Datadome, PerimeterX, Incapsula, and Akamai matches throw `CaptchaError` before your `checkResponse` runs — you don't write detection logic for them. The two interactive captchas (`recaptcha`, `hcaptcha`) are off by default because they appear on legitimate forms too; opt in per site with `detectCaptcha: { recaptcha: true }` in `defineSite` when the site is known to gate behind one. See [Built-in CAPTCHA detection](/architecture/framework#built-in-captcha-detection) for the full table.

**What happens after you throw.** The framework catches the error and dispatches per [retry topology](/overview/glossary#retry-topology):

- `TransientError` → up to 3 retries inside this extract call (250ms → 1s → 4s, ±25% jitter), then surfaces `status: "error"` to the consumer.
- `RateLimitedError` → feeds adaptive backoff at the rate-limiter; the call waits in queue up to 5s, then `status: "rate_limited"`. Counts toward the per-host [circuit breaker](/overview/glossary#circuit-breaker).
- `BlockedError` / `CaptchaError` → `status: "blocked"`. No retry. Counts toward the circuit breaker.
- `PermanentError` / `BadResponseError` → `status: "error"` with the reason. No retry.

The client doesn't double-retry — by the time it sees a response, the server is done with this extract call.

### `.resource(name, def)` — what consumers ask for

```ts
.resource("article", {
    schema: Article,
    url: articleUrl,
    ttl: TTL.daily,
})
```

Each resource declares:

- **`schema`** — the Standard Schema validator describing the data shape. Used at test time (`schema-conformance`), at build time (`schema-emission-roundtrip`), and at server runtime before persisting any fresh extraction.
- **`url`** — the [URL pattern](/overview/glossary#url-pattern). Both the framework's URL builder (for `.toUrl(params)` when consumers ask for a resource by params) and the page matcher (incoming URLs are parsed via `.parseUrl()`).
- **`ttl`** — cache lifetime. Use a named preset (`TTL.realtime`, `TTL.short`, `TTL.medium`, `TTL.daily`, `TTL.weekly`) or write a custom `{ default, min, max }`.

#### Derived resources (no URL)

Some resources are computed from another resource rather than having their own URL. Declare `derivedFrom: "<parentResource>"`:

```ts
.resource("article", { schema: Article, url: articleUrl, ttl: TTL.daily })
.resource("comments", {
    schema: CommentList,
    derivedFrom: "article",
    extract: async (ctx, article) => {
        const r = await ctx.fetch(`https://blog.example.com/api/comments?id=${ctx.params.id}`);
        return await r.json();
    },
    ttl: TTL.short,
})
```

The framework fetches `article` first; `comments`'s `extract` receives the article's data as its second argument. Consumers can request either resource independently; both cache with their own TTL.

`derivedFrom` is typed against accumulated resources — `derivedFrom: "post"` when no `post` resource has been registered is a compile error.

### `urlPattern(...)` — the URL primitive

```ts
const articleUrl = urlPattern("https://blog.example.com/article/:id");
//        ^^^^^^^^^^ URLPattern<{ id: string }>
```

Bidirectional: `articleUrl.toUrl({ id: "hello-world" })` produces the URL; `articleUrl.parseUrl(url)` extracts the params. The literal `:id` placeholder gives `ctx.params` its type inside the page's `validate` and `extract` — no separate params declaration needed.

Optional runtime validation via a second argument:

```ts
const articleUrl = urlPattern("https://blog.example.com/article/:id", {
    id: z.string().regex(/^[A-Za-z0-9_-]+$/),
});
```

A `toUrl` or `parseUrl` failure (params don't satisfy the schema) throws `ParamValidationError`, which the framework maps to a `400` for the consumer.

### `.page(urlPattern, def)` — URL pattern + behaviour

```ts
.page(articleUrl, {
    validate: (ctx) => ctx.$("article").exists(),
    extract: async (ctx) => ({
        article: {
            "@type":   () => "Article" as const,
            headline:  () => ctx.$("h1").text(),
            body:      () => ctx.$("article .content").text(),
        },
    }),
    fixtures: [
        { params: { id: "hello-world" } },
        { params: { id: "removed-post" }, errorCase: true },
    ],
})
```

Each page declares:

- **`validate(ctx)`** — cheap synchronous predicate: "is this the right kind of page?" Returns `false` to skip extraction (the framework records the result; on a non-error fixture this is a test failure, on an `errorCase: true` fixture it's the expected outcome).
- **`extract(ctx)`** — produces resource data via [field functions](/overview/glossary#field-function). The return type is enforced against the registered resources: keys must be resource names, values must be objects of field functions whose return types match the resource's schema fields.
- **`paginate?`** — optional `{ next: (ctx) => string | null }` for paginated pages.
- **`fixtures`** — inline declaration of test fixtures. Each entry is `{ params, errorCase? }`. The framework derives the on-disk path from `params` (via the URLPattern's `toUrl`) and a stable hash.
- **`rateLimit?`** — *optional* per-page override of the site-level rate limit. Use rarely: only when one page is materially heavier or lighter than the rest of the site (e.g. a search endpoint the operator caps tighter, or a static-asset page the operator allows looser). The override merges into the site-level config — only the overridden fields change. If your site mostly needs different limits, that's usually a sign the page belongs to a different package, not a different rate limit.

Which resources a page provides is **derived from `extract`'s return keys** — there's no separate `provides` field. `sitely build` dry-runs the page's extract on a fixture to populate the manifest.

### Field functions — every leaf is a function

```ts
extract: async (ctx) => ({
    post: {
        headline:    () => ctx.$("h1").text(),
        author:      () => ctx.$(".author").text(),
        publishedAt: () => ctx.$("time[datetime]").attr("datetime"),
        type:        () => "Article" as const,    // constant — still a function
    },
}),
```

Why functions everywhere:

- **Per-field error isolation.** If `headline`'s selector throws, the framework catches it, records the error against that field path, and continues with `author`. Other fields still extract.
- **Per-field telemetry.** Drift detection knows *which* field failed; you don't get a generic "extract failed" — you get "the `.author` selector is failing 30% of the time".
- **Sparse selection.** If a consumer requests `?resources=article` and the page also provides `comments`, only the article's field functions run.
- **Async fields supported.** A function returning a Promise is awaited. Most fields are sync, but `ctx.fetch` cases work the same way.

Throws in field functions become per-field errors: the field is treated as `undefined` (= absent), the framework records the error with the field name, schema validation downstream decides whether absence is permitted.

### Sharing computation between fields: `ctx.lazy`

When multiple fields need the same expensive value (e.g. parse JSON-LD once, read it from several fields):

```ts
extract: async (ctx) => {
    const jsonLd = ctx.lazy(() => ctx.jsonLd("Article")[0]);

    return {
        article: {
            headline: () => jsonLd().headline ?? ctx.$("h1").text(),
            author:   () => jsonLd().author?.name,
            date:     () => jsonLd().datePublished,
        },
    };
},
```

`ctx.lazy(fn)` memoises — the producer runs at most once. Errors are captured and re-thrown to each caller, so dependent fields see the same error instance (telemetry attributes failures to the upstream cause).

Async variant: `ctx.lazy(async () => ...)` returns `() => Promise<T>` — awaited per call but resolved once.

### Fixtures — inline declarations

```ts
fixtures: [
    { params: { id: "hello-world" } },                          // happy-path fixture
    { params: { id: "removed-post" }, errorCase: true },        // validate must return false here
]
```

Each entry's `params` is typed against the page's URLPattern. The framework:

1. Computes the canonical URL via `articleUrl.toUrl(params)`.
2. Computes a stable hash from `params`.
3. Reads `fixtures/<page-key>/<hash>.html`, `<hash>.expected.json` (unless `errorCase: true`), and `<hash>.meta.json`.

You capture the HTML with `sitely snapshot { id: "hello-world" }` — see [Capturing fixtures](#capturing-fixtures) below. The `expected.json` is what `extract(ctx)` should produce; the `meta.json` carries the URL, status, and headers at capture time.

## Schemas

The schema is the runtime contract for what your resource's data looks like. Authors write schemas using their preferred Standard Schema-compatible library (Zod, Valibot, ArkType, …); the framework only interacts through the Standard Schema interface.

### Using `@sitely/schemas` base shapes

`@sitely/schemas` ships generated validators for common schema.org types (`Article`, `Product`, `Person`, `Recipe`, …):

```ts
import { Article } from "@sitely/schemas";

.resource("article", { schema: Article, url: articleUrl, ttl: TTL.daily })
```

Use them directly when the schema.org shape covers what you need.

### Extending schema.org with site-specific fields

Most real sites carry data schema.org doesn't model. Spread the base schema into your own:

```ts
import { Article } from "@sitely/schemas";
import { z } from "zod";

const wikipediaArticle = z.object({
    ...Article.shape,
    "@type": z.literal("Article"),
    pageId: z.number(),
    revisionId: z.number(),
    categories: z.array(z.string()),
});
```

The extended schema **implements** schema.org `Article` (carries every Article field + `@type` discriminator) and **extends** it (adds Wikipedia-specific fields). Consumers who only care about the schema.org subset see a valid Article; consumers wanting the extras read the wider shape.

### Mandatory `presence()` for optional/nullable fields

Any field marked `.optional()`, `.nullable()`, or `.nullish()` must be wrapped in `presence(schema, rate)` declaring how often it shows up. The build fails otherwise:

```ts
import { presence } from "@sitely/framework";

const Article = z.object({
    headline: z.string(),                                  // required — implicit presence 1.0
    author:   presence(z.string().nullable(), 0.9),        // present ~90% of the time
    abstract: presence(z.string().nullable(), 0.3),        // present ~30% of the time
});
```

Why mandatory: a silently-broken extractor that always returns `undefined` for an optional field still passes schema validation — but it shouldn't pass. Drift telemetry samples the observed presence rate and alerts when it diverges from the declared rate. Combined with the [`fixture-coverage`](/guide/testing#warning-only-checks) warning (every optional/nullable field needs fixtures with the present *and* absent cases), this catches selector regressions before they ship.

### Assets

URL-typed fields that point at binary or plaintext files (images, video, audio, PDFs) use the `asset(...)` brand:

```ts
import { asset } from "@sitely/framework";

const InstagramPost = z.object({
    caption: z.string(),
    images: z.array(asset("image")),          // array of images, named by field
    authorAvatar: asset("image"),              // single image, named by field
    attachedPdf: presence(asset("document"), 0.1),   // rarely-present document
});
```

`asset(type)` is a Standard Schema validator that accepts a URL string with the asset-type brand attached. Wire format stays a URL string; the brand is metadata the runtime introspects (for "discover all assets on this resource" tooling and a future `?expand=assets` flag that inlines bytes).

## Framework errors

Throw [framework errors](/overview/glossary#framework-errors) from `checkResponse` or `extract` to signal specific failure modes. The framework catches them and maps to consumer-facing status:

```ts
import {
    RateLimitedError, BlockedError, CaptchaError,
    TransientError, PermanentError, BadResponseError,
    MissingDataError, MalformedDataError,
} from "@sitely/framework";

// In checkResponse, signal that the *response* is bad:
.checkResponse((response) => {
    if (response.status === 429) throw new RateLimitedError({ retryAfter: 60_000 });
    if (response.has(".captcha")) throw new CaptchaError();
    if (response.includes("This page has been removed")) throw new PermanentError({ reason: "content removed" });
})

// In extract, mostly signal that *extraction* failed:
extract: async (ctx) => ({
    article: {
        body: () => {
            const text = ctx.$("article").text();
            if (!text) throw new MissingDataError({ field: "body", reason: "article tag is empty" });
            return text;
        },
    },
}),
```

The two families have different consequences:

- **`ResponseError`** (`RateLimitedError`, `BlockedError`, `CaptchaError`, `TransientError`, `PermanentError`, `BadResponseError`) — about the response being bad. Counted by the per-host [circuit breaker](/overview/glossary#circuit-breaker).
- **`ExtractionError`** (`MissingDataError`, `MalformedDataError`) — about extracting from a *good* response. These are author bugs, not site outages — they don't count toward the circuit breaker.

See the [framework errors glossary entry](/overview/glossary#framework-errors) for the consumer-facing status each maps to.

## Splitting across files: segments

Once your `index.ts` grows past a couple of pages, split the package into [segments](/overview/glossary#segment):

```ts
// src/pages/article.ts
import { defineSegment, urlPattern, TTL } from "@sitely/framework";
import { Article } from "@sitely/schemas";

const articleUrl = urlPattern("https://blog.example.com/article/:id");

export const articleSegment = defineSegment()
    .resource("article", { schema: Article, url: articleUrl, ttl: TTL.daily })
    .page(articleUrl, { validate: ..., extract: ..., fixtures: [...] });

// src/pages/comments.ts
export const commentsSegment = defineSegment()
    .resource("comments", {
        schema: CommentList,
        derivedFrom: "article",                  // typed against article segment when composed
        extract: async (ctx, article) => { ... },
        ttl: TTL.short,
    });

// src/index.ts
import { defineSite } from "@sitely/framework";
import pkg from "../package.json" with { type: "json" };
import { articleSegment } from "./pages/article";
import { commentsSegment } from "./pages/comments";

export default defineSite({
        site: { id: "blog", displayName: "Blog", version: pkg.version },
        origins: [{ hostname: "blog.example.com" }],
        rateLimit: { maxConcurrent: 2, requestsPerSecond: 1 },
    })
    .use(articleSegment)
    .use(commentsSegment)           // must come after articleSegment because of derivedFrom
    .build();
```

Each segment carries a `requires` type listing the resources it depends on (via `derivedFrom` references). `.use(segment)` is type-checked against the accumulated state — composing out of dependency order is a compile error:

```ts
// ✗ Compile error — commentsSegment requires "article" but it's not registered yet
export default defineSite({...})
    .use(commentsSegment)
    .use(articleSegment)
    .build();
//        ^^^^^^^^^^^^^^^
// Argument of type 'Segment<{ requires: "article" }, ...>' is not assignable —
// missing required resource 'article'.
```

The same constraint applies to `derivedFrom` references inside the same builder chain. Declaring `derivedFrom: "article"` before `.resource("article", ...)` has been called is a compile error — the builder's accumulated `TResources` doesn't yet include `"article"`.

## Pages: `validate` and `extract`

This is where most of the work lives.

### `validate(ctx)`

A cheap, synchronous predicate. Returns `true` if `ctx` represents the kind of page this pattern is meant to handle, `false` otherwise. The framework calls it before `extract` and skips extraction if it returns `false`.

```ts
validate: (ctx) =>
    ctx.$("article.post").exists() && ctx.$("h1.post-title").exists()
```

Use `validate` to catch cases where the URL matched but the HTML is something else — a soft-404 stub, a login wall, an A/B-test variant whose selectors you don't recognise. Return `false` and the framework records the result and moves on.

`validate` doesn't need to be exhaustive. It needs to be cheap and to reject obvious mismatches. If it returns `true`, `extract` runs; `extract` is where careful field-by-field handling happens.

### `extract(ctx)`

Returns an object keyed by resource names. Each value is an object of field functions:

```ts
extract: async (ctx) => ({
    post: {
        "@type":     () => "Article" as const,
        headline:    () => ctx.$("h1").text(),
        body:        () => ctx.$("article .content").text(),
        author:      () => ctx.$('[rel="author"]').text() || null,
        publishedAt: () => ctx.$("time[datetime]").attr("datetime"),
    },
}),
```

If the page provides two resources, the return object has two keys:

```ts
extract: async (ctx) => ({
    category:  { /* fields */ },
    itemList:  { /* fields */ },
}),
```

The return type is constrained at compile time to a subset of registered resources, with each value's field shape constrained to match the resource's schema.

### What `ctx` exposes

| Field | Type |
|---|---|
| `ctx.$(selector)` | A single [page element](/overview/glossary#page-element) or `null`. |
| `ctx.$$(selector)` | An array of page elements. Empty array if none match. |
| `ctx.jsonLd(type?)` | Parsed JSON-LD blocks on the page, optionally filtered by `@type`. |
| `ctx.params` | Values parsed from the page's URLPattern, typed against its `:segment` placeholders. |
| `ctx.url` | Full URL of the page. |
| `ctx.canonical` | Canonical URL if the page declares one, otherwise `ctx.url`. |
| `ctx.status` | HTTP status of the fetched response. |
| `ctx.headers` | HTTP response headers. |
| `ctx.locale` | The [locale](/overview/glossary#locale) the URL resolved to (or `null` if not multi-locale). |
| `ctx.fetch(url, opts)` | Outbound HTTP. Subject to rate limits and the circuit breaker. |
| `ctx.lazy(fn)` | Memoised producer for shared computation. |

A page element is read-only. `.text()` returns its trimmed text content. `.attr(name)` returns an attribute. `.find(selector)` returns the first descendant matching `selector`. `.exists()` returns whether the selection has any nodes. No mutation methods — extract functions don't change the DOM, they read from it.

## Multi-locale sites

If your site serves the same content in multiple languages, declare a `locales` block:

```ts
defineSite({
    site: { id: "wikipedia", displayName: "Wikipedia", version: pkg.version },
    origins: [{ hostname: "{locale}.wikipedia.org", templated: true }],
    rateLimit: { maxConcurrent: 3, requestsPerSecond: 1 },
    locales: { source: "host", values: ["en", "de", "fr"], default: "en" },
})
```

The `source` field declares where the locale lives:

- `"host"` — in the subdomain (`en.wikipedia.org`, `de.wikipedia.org`). Use a templated origin with `{locale}` and `templated: true`.
- `"path"` — in the URL path (`/en/articles/foo`). The locale appears as `:locale` in your page patterns.
- `"query"` — in a query parameter (`?lang=en`).

The [cache](/overview/glossary#cache) key always includes locale — a site serving the same URL in two languages caches them separately.

The `locale-matrix` check requires fixtures across at least two declared locales for any page (the check is skipped for single-locale declarations).

## Live authoring with `sitely dev`

`sitely dev` is the watch-mode loop: it re-runs every page's `validate` + `extract` against every committed fixture as you edit, and prints a diff for any field whose output changed.

```bash
$ cd packages/example-site-blog
$ sitely dev
watching src/ + fixtures/ (5 fixtures across 2 pages)

[14:22:01] article/a3f5d6c1.html
   ✓ headline               "TypeScript"
   ✓ body                   <2.4 KB>
   ✓ author                 "Microsoft"
   ✓ heroImage              "https://en.wikipedia.org/wiki/..."

# edit src/pages/article.ts, save:

[14:22:18] article/a3f5d6c1.html
   ~ headline               "TypeScript" → "TypeScript (programming language)"
   ✓ body                   <2.4 KB>
   ✓ author                 "Microsoft"
   ✓ heroImage              ...
```

The signals you care about while iterating:

- `~ field   old → new` — value changed since the last run. Verify it's an improvement.
- `! field   <error>` — a field function threw. The fixture still loads; downstream fields still run; you see the error per-field thanks to [field-function isolation](/overview/glossary#field-function).
- `✗ validate returns false` — `validate` rejected this fixture. For a non-error fixture, that's a problem; for an `errorCase: true` fixture, that's the pass condition.

Flags:

- `--only <page>` — re-run a single page's fixtures.
- `--fixture <hash>` — re-run a single fixture across all pages.
- `--no-clear` — don't clear the terminal between runs; useful when comparing diffs scroll-back.

What `sitely dev` *doesn't* do:

- It doesn't talk to a server. There's no live HTTP. It reads `fixtures/` and runs your `extract` in-process.
- It doesn't fetch fresh HTML. Use `sitely snapshot` to update fixtures.
- It doesn't run the 8 checks (schema-conformance, determinism, manifest-integrity, etc.). Use `sitely test` for that — `sitely dev` is for tight iteration; `sitely test` is the pre-commit gate.

Stop the loop with Ctrl-C. The process is the supervisor for itself, not a daemon.

## Capturing fixtures

Use `sitely snapshot` from the package directory. The params are typed against the page's URLPattern:

```bash
$ cd packages/example-site-blog
$ sitely snapshot --page article '{"id": "hello-world"}'
captured fixtures/article/a3f5d6c1.html
captured fixtures/article/a3f5d6c1.meta.json
```

`sitely snapshot` derives the URL via the page's `url.toUrl(params)`, fetches it, and writes the HTML + meta under the stable params-hash filename. It ignores robots.txt because it's an explicit author-initiated action, not server-side traffic.

### Authoring `expected.json`

The easiest way:

1. Snapshot: `sitely snapshot --page article '{"id": "hello-world"}'`.
2. Generate the expected output: `sitely test --update fixtures/article/a3f5d6c1` — runs your extract function and writes `expected.json`.
3. Review the result. Open the JSON, look at every field, decide whether each one is what you wanted. Edit anything that looks wrong.
4. Run `sitely test`. It should pass.

`--update` is a productivity tool, not a correctness shortcut. If you commit the output without reading it, future regressions in extraction will be hidden by also-broken expected files.

### Error fixtures

Mark a fixture `errorCase: true` to assert `validate(ctx)` returns `false` for it — a removed-content stub, a captcha, a login wall:

```ts
fixtures: [
    { params: { id: "removed-post" }, errorCase: true },
],
```

You still snapshot it the same way (`sitely snapshot --page article '{"id": "removed-post"}'`). No `expected.json` is written for error fixtures — the only assertion is that `validate` rejects them. The `error-path-coverage` check fails if the package has no error fixtures.

## Versioning

Site packages are SemVer-versioned via `package.json`. `sitely build` injects the version into the compiled `dist/index.js` and the manifest; the client sends it with every typed request; the server returns `409` on major-version mismatch.

The [`semver-discipline`](/guide/testing#semver-discipline) check enforces the right bump at test time: breaking changes (resource removed, schema field removed, optional→required, URL pattern changed) require a major; additive changes (resource added, optional field added) require at least a minor.

Run `sitely test` after editing — `semver-discipline` will tell you if your `package.json` bump doesn't match the diff.

## Common edge cases

This is the section to read before you start authoring. Almost every site package author trips on at least one of these.

### What if the site renders content with JavaScript?

The default [driver](/overview/glossary#driver) is `CheerioDriver`, which parses static HTML. It doesn't execute JavaScript. If the content you want is rendered client-side, in order of preference:

1. **Read the embedded JSON.** Most JavaScript-rendered sites embed the underlying data as JSON in a `<script>` tag — `__NEXT_DATA__`, `__NUXT__`, `<script type="application/ld+json">`. Extract directly via `ctx.jsonLd(...)` or `ctx.$('script#__NEXT_DATA__').text()` followed by `JSON.parse`. This is the right answer 80% of the time.
2. **Hit the underlying API.** If the JS app fetches from a JSON endpoint, fetch that endpoint instead via `ctx.fetch(url)`.
3. **Wait for a JavaScript-executing driver.** A JSDOM or Playwright driver isn't shipped yet. If your site genuinely requires JS execution and (1)/(2) don't work, your package can't be written today.

### What if a field is sometimes present, sometimes not?

Mark it `.optional()` or `.nullable()` in your schema, **wrap in `presence()`** with the expected rate, and handle the absent case in `extract`:

```ts
const Article = z.object({
    headline: z.string(),
    author: presence(z.string().nullable(), 0.85),     // ~85% of pages have a byline
});

extract: async (ctx) => ({
    post: {
        headline: () => ctx.$("h1").text(),
        author:   () => ctx.$('[rel="author"]').text() || null,
    },
}),
```

Ship at least one fixture with the field present and one without. The `fixture-coverage` warning fires if either branch isn't covered.

### What if the site changes its HTML?

Your fixtures stop matching live HTML. CI checks on committed fixtures still pass (deterministic by design), but when consumers hit the live site, the server logs extraction failures or [drift](/overview/glossary#drift) — divergence between declared schema and observed shape.

When this happens:

1. Re-snapshot: `sitely snapshot --page <key> '<params>' --overwrite`.
2. Update your selectors.
3. Update `expected.json` if the data shape genuinely changed.
4. Run `sitely test` until it passes.
5. Bump the version appropriately and publish.

### What if my package needs a custom user-agent for an inline fetch?

Set it on the `fetch` calls you make inside `extract`:

```ts
extract: async (ctx) => {
    const extra = await ctx.fetch("https://blog.example.com/api/comments", {
        headers: { "user-agent": "example-site-blog/1.0 (+https://...)" },
    });
    // ...
}
```

You can't change the user agent for the *primary* page fetch from inside your package — that's controlled server-side via `FETCH_USER_AGENT`. Use sub-fetches with a custom UA when a specific endpoint needs to identify itself differently.

### What if I need to fetch a sub-resource inside extract?

`ctx.fetch` is available:

```ts
extract: async (ctx) => {
    const id = ctx.params.id;
    const commentsResp = await ctx.fetch(`https://blog.example.com/api/comments?article=${id}`);
    const comments = await commentsResp.json();
    return {
        post: {
            headline:     () => ctx.$("h1").text(),
            commentCount: () => comments.length,
        },
    };
}
```

Two things to keep in mind:

- **Sub-fetches count against the per-site rate limit** and the wall-time budget.
- **For a sub-resource consumers might want independently**, use a [derived resource](#derived-resources-no-url) instead of a sub-fetch inside extract — it gets its own TTL, its own cache row, and consumers can ask for it without re-running the parent's extract.

### What if `validate` returns true but extract needs to handle a partial page?

That's fine and normal. `validate` is the gate for "this is the right kind of page at all"; `extract` is where you handle "this page has some fields and not others." Use optional fields in your schema (with `presence()`) and let the per-field error isolation handle individual selector failures.

The mental model: `validate === false` means "this isn't the page I think it is." Anything else is `extract`'s problem.

### What if my site has paywalled content?

Three sub-cases:

1. **Metered paywall** (free + paid mix). Your extractor works on free articles. For paid articles, `checkResponse` or `validate` should detect the paywall stub. Snapshot one as an `errorCase: true` fixture.
2. **Soft-paywall returning 200 with a stub body**. Look for the paywall's specific markers and either throw `PermanentError({ reason: "paywalled" })` from `checkResponse` or return `false` from `validate`.
3. **You have a subscription and want to scrape with auth**. Don't — site packages don't carry credentials and the framework doesn't support cookie jars per consumer. Build it yourself outside of sitely.

## Reference: every top-level field of `defineSite()`

| Field | Required? | What it is |
|---|---|---|
| `site` | Yes | The package's identity: `{ id, displayName, version, homepage? }`. |
| `origins` | Yes | List of hostnames this package handles. |
| `rateLimit` | Yes | Per-origin outbound rate: `{ maxConcurrent, requestsPerSecond }`. |
| `locales` | If multi-locale | `{ source, values, default }`. |
| `framework` | No | `{ minVersion, maxVersion }` for `@sitely/framework` compatibility. |
| `family` | No | Multi-origin family declaration for HTML-twin sites. |
| `crawl` | No | Crawl configuration. |
| `normalizeUrl` | No | Function to canonicalise URLs before pattern matching. |

Resource definitions (`.resource(name, def)`) carry:

| Field | Required? | What it is |
|---|---|---|
| `schema` | Yes | Standard Schema validator for the resource's data shape. |
| `url` | If not derived | The resource's URLPattern. Used for `toUrl(params)` and page matching. |
| `derivedFrom` | If not URL-bound | Name of the parent resource this one is computed from. |
| `extract` | If derived | The extract function for derived resources. |
| `ttl` | Yes | `TTL.preset` or custom `{ default, min, max }`. |

Page definitions (`.page(urlPattern, def)`) carry:

| Field | Required? | What it is |
|---|---|---|
| `validate` | Yes | Predicate function on `ctx`. |
| `extract` | Yes | Returns resources keyed by name, each an object of field functions. |
| `fixtures` | Yes | Inline `[{ params, errorCase? }, ...]` declarations. |
| `paginate` | No | `{ next: (ctx) => string | null }` for paginated pages. |

## Read next

- **[The test suite](/guide/testing)** — what `sitely test` checks, and how to make every check pass.
- **[Publishing](/guide/publishing)** — how to ship your package and what happens after.
- **[Site packages — architecture](/architecture/sites)** — the architecture-level view of the same territory.
- **[Glossary](/overview/glossary)** — the definition of every term used above.
