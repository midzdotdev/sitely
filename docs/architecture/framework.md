# @sitely/framework

`@sitely/framework` is the package authors import. It exports `defineSite` and `defineSegment` (the [builder](/overview/glossary#builder) entry points), `urlPattern`, `presence`, `asset`, the `TTL` preset constants, `ctx.lazy`, the [framework error](/overview/glossary#framework-errors) hierarchy, the runtime type surface, the [build](./framework-build) and [test-pkg](./framework-test-pkg) subsystems, and the `sitely` CLI. If a piece of behaviour spans author-time and build-time, it lives here.

This page covers the top-level modules under `packages/framework/src/`. The build pipeline and the in-process test runner each get their own deep dives.

## The DSL — builder pattern

A [site definition](/overview/glossary#site-definition) is assembled by chaining off `defineSite({...})`. Each step accumulates type information into the next, so cross-references (`derivedFrom`, `extract`'s return keys, `provides` … the implicit ones) are type-safe.

```ts
import { defineSite, urlPattern, presence, asset, TTL } from "@sitely/framework";
import { Article } from "@sitely/schemas";
import { z } from "zod";
import pkg from "../package.json" with { type: "json" };

const articleUrl = urlPattern("https://blog.example.com/article/:id");
const commentsUrl = urlPattern("https://blog.example.com/api/comments/:id");

const PostArticle = z.object({
    "@type": z.literal("Article"),
    headline: z.string(),
    body: z.string(),
    author: presence(z.string().nullable(), 0.9),
    heroImage: presence(asset("image"), 0.7),
});

const CommentList = z.object({
    items: z.array(z.object({
        author: z.string(),
        body: z.string(),
        postedAt: z.string().datetime(),
    })),
});

export default defineSite({
        site: { id: "blog", displayName: "Example Blog", version: pkg.version },
        origins: [{ hostname: "blog.example.com" }],
        rateLimit: { maxConcurrent: 2, requestsPerSecond: 1 },
    })
    .checkResponse((response) => {
        if (response.includes("Something went wrong")) {
            throw new RateLimitedError({ retryAfter: 60_000 });
        }
    })
    .resource("article", {
        schema: PostArticle,
        url: articleUrl,
        ttl: TTL.daily,
    })
    .resource("comments", {
        schema: CommentList,
        derivedFrom: "article",
        extract: async (ctx, article) => {
            const r = await ctx.fetch(commentsUrl.toUrl({ id: ctx.params.id }));
            return await r.json();
        },
        ttl: TTL.short,
    })
    .page(articleUrl, {
        validate: (ctx) => ctx.$("article").exists(),
        extract: async (ctx) => ({
            article: {
                "@type": () => "Article" as const,
                headline: () => ctx.$("h1").text(),
                body: () => ctx.$("article .content").text(),
                author: () => ctx.$(".byline").text(),
                heroImage: () => ctx.$('meta[property="og:image"]').attr("content"),
            },
        }),
        fixtures: [
            { params: { id: "hello-world" } },
            { params: { id: "not-found" }, errorCase: true },
        ],
    })
    .build();
```

That's the whole authoring surface in one example. Each line below decomposes one piece.

### `defineSite({ site, origins, rateLimit })`

The builder entry. Takes the always-required header: the site's identity, its origins, and its outbound rate limit. Everything else is added via chained methods.

```ts
export function defineSite<TConfig extends SiteHeader>(config: TConfig): SiteBuilder<TConfig, {}, {}>;

interface SiteHeader {
    site: { id: string; displayName: string; version: string; homepage?: string };
    origins: Origin[];
    rateLimit: RateLimitConfig;
    locales?: LocaleConfig;
    family?: FamilyConfig;
    crawl?: CrawlConfig;
    framework?: { minVersion?: string; maxVersion?: string };
    normalizeUrl?: (url: string) => string;
}
```

`site.version` is injected by [`sitely build`](./framework-build) from `package.json`. Authors don't write it by hand; the import-from-package.json pattern in the example is the recommended shape so type-checking still sees the version field.

### `.resource(name, def)`

Registers a typed resource. The accumulated builder type tracks `TResources` so subsequent calls can reference the resource by name (e.g. `derivedFrom: "article"`):

```ts
interface ResourceDef<TSchema, TUrlPattern> {
    schema: TSchema;                       // Standard Schema validator
    url?: TUrlPattern;                     // URLPattern, mutually exclusive with derivedFrom
    derivedFrom?: keyof TResources;        // typed against accumulated resources
    extract?: ExtractFn;                   // required when derivedFrom is set
    ttl: ResourceTTL;                      // see TTL presets
}
```

Two variants:

- **URL-bound resource** (`url`): the framework fetches the URL via `url.toUrl(params)`, runs the matching page's `validate` + `extract`, caches the result.
- **Derived resource** (`derivedFrom`): the framework fetches the parent resource first, then runs this resource's `extract` with the parent's data as the second argument. Useful for resources that don't have their own URL.

You can't declare both `url` and `derivedFrom`. The build rejects packages that try.

### `.page(urlPattern, def)`

Declares a page — a URL pattern with `validate`, `extract`, optional `paginate`, and inline `fixtures`. The page's URL pattern is also its identifier in the manifest:

```ts
interface PageDef<TParams, TResources> {
    validate: (ctx: ExtractContext<TParams>) => boolean;
    extract: (ctx: ExtractContext<TParams>) => ExtractReturn<TResources>;
    paginate?: { next: (ctx: ExtractContext<TParams>) => string | null };
    fixtures: FixtureSpec<TParams>[];
}

type ExtractReturn<TResources> = Partial<{
    [K in keyof TResources]: { [F in keyof ResourceOutput<TResources[K]>]: () => ResourceOutput<TResources[K]>[F] };
}>;
```

The `ExtractReturn` constraint is what gives the framework `provides` for free — the keys actually returned by `extract` are the resources the page provides. `sitely build` dry-runs each page's extract on a fixture to populate the manifest's per-page provides list.

Each leaf value in `extract`'s return is a [field function](/overview/glossary#field-function) — a zero-argument function that produces the value. The framework calls each in turn, catches per-field errors, and validates the assembled object against the resource's schema.

### `.checkResponse(fn)`

Optional site-level smoke test that runs before per-page `validate` / `extract`. Receives a [response snapshot](/overview/glossary#response-snapshot); throws a [framework error](/overview/glossary#framework-errors) to signal bad responses:

```ts
.checkResponse((response) => {
    if (response.status === 429 || response.headers["retry-after"]) {
        throw new RateLimitedError({ retryAfter: Number(response.headers["retry-after"]) * 1000 });
    }
    if (response.has(".captcha-challenge")) {
        throw new CaptchaError();
    }
    if (response.includes("This page has been removed")) {
        throw new PermanentError({ reason: "content removed" });
    }
})
```

See [The framework error hierarchy](#the-framework-error-hierarchy) below.

### `.use(segment)`

Composes a [segment](/overview/glossary#segment) defined in another file. The segment's accumulated `TResources` and `TPages` extend the site's; cross-references in the segment must be satisfied by what's already accumulated when `.use()` is called.

```ts
// pages/article.ts
import { defineSegment, urlPattern, TTL } from "@sitely/framework";
import { Article } from "@sitely/schemas";

const articleUrl = urlPattern("https://blog.example.com/article/:id");

export const articleSegment = defineSegment()
    .resource("article", { schema: Article, url: articleUrl, ttl: TTL.daily })
    .page(articleUrl, { validate: ..., extract: ..., fixtures: [...] });

// src/index.ts
export default defineSite({...})
    .use(articleSegment)
    .use(commentsSegment)
    .build();
```

Strict ordering: if `commentsSegment` references `"article"` via `derivedFrom`, it must be `.use()`d after `articleSegment`. A compose-out-of-order is a compile error at the `.use()` boundary.

### `.build()`

Terminal step. Returns the final `SiteDefinition` (no longer a builder). The server, the test harness, and `sitely build` all consume the result of `.build()`.

## `URLPattern` — the bidirectional URL primitive

```ts
export function urlPattern<TPattern extends string>(
    pattern: TPattern,
    paramsSchema?: Record<ExtractParams<TPattern>, StandardSchemaV1>,
): URLPattern<ExtractParams<TPattern>>;

export interface URLPattern<TParams extends Record<string, string>> {
    readonly pattern: string;
    toUrl(params: TParams): string;
    parseUrl(url: string): TParams | null;
}
```

`ExtractParams<TPattern>` is a TypeScript type-level operation that pulls `:segment` placeholders out of the literal pattern string. `urlPattern("/article/:id")` returns `URLPattern<{ id: string }>`.

The optional `paramsSchema` adds runtime validation when the URL is built or parsed. A schema mismatch on `toUrl` or `parseUrl` throws `ParamValidationError`.

The underlying implementation is the web standard [URL Pattern API](https://developer.mozilla.org/en-US/docs/Web/API/URL_Pattern_API) where available, with a small polyfill for older runtimes.

## `ExtractContext` — what callbacks see

```ts
export interface ExtractContext<TParams extends Record<string, string>> {
    $(selector: string): PageElement | null;
    $$(selector: string): PageElement[];
    jsonLd(type?: string): Record<string, unknown>[];

    params: TParams;
    url: string;
    canonical: string | null;
    status: number;
    headers: Record<string, string>;
    locale: string | null;

    fetch(url: string, opts?: RequestInit): Promise<Response>;
    lazy<T>(fn: () => T | Promise<T>): () => T | Promise<T>;
}
```

The context is generic over the page's URL pattern, so `ctx.params` is typed as `TParams` (`{ id: string }` for `/article/:id`).

- **`$`, `$$`**: come from the active [`PageDriver`](/overview/glossary#page-driver) (see [@sitely/page](./page)). Authors never construct a driver.
- **`jsonLd(type?)`**: pulls every `<script type="application/ld+json">` block on the page, optionally filtered by `@type`.
- **`fetch`**: outbound HTTP. Subject to the site's [rate limit](/overview/glossary#rate-limit) and [circuit breaker](/overview/glossary#circuit-breaker).
- **`lazy`**: see [`ctx.lazy`](/overview/glossary#ctxlazy).

## Field functions

Every leaf in an `extract` return is a function. Even constants:

```ts
extract: async (ctx) => ({
    article: {
        "@type":     () => "Article" as const,         // constant — still a function
        headline:    () => ctx.$("h1").text(),
        body:        () => ctx.$("article .content").text(),
        publishedAt: async () => new Date(ctx.$("time").attr("datetime") ?? ""),
    },
}),
```

Per-field execution: the framework calls each function in turn, awaiting any that return Promises. Throws are caught, recorded as per-field errors with the resolved field path (`article.publishedAt`), and the field is treated as absent. Schema validation then decides whether absence is permitted (it is, for [presence-annotated](/overview/glossary#presence-annotation) optional fields).

Field functions also enable [resource filter](/overview/glossary#resource-filter) projection: if a request includes `?resources=article` and the page provides multiple resources, only the requested resource's field functions are invoked.

## Shared computation: `ctx.lazy`

When multiple fields need the same expensive computation (e.g. parse JSON-LD once, read it from several fields), wrap it in `ctx.lazy`:

```ts
const jsonLd = ctx.lazy(() => ctx.jsonLd("Article")[0]);

extract: async (ctx) => ({
    article: {
        headline: () => jsonLd().headline ?? ctx.$("h1").text(),
        author:   () => jsonLd().author?.name,
        date:     () => jsonLd().datePublished,
    },
}),
```

The producer runs at most once. Subsequent calls return the memoised value. **Errors are captured and re-thrown** — if the producer throws on first call, every dependent field sees the same error instance, so telemetry attributes the failure to the upstream cause rather than to each consumer field.

Async variant: `ctx.lazy(async () => ...)` returns `() => Promise<T>`, awaited per call but resolved once.

## The framework error hierarchy

Authors throw typed errors from `checkResponse` or `extract` to signal failure modes. The framework catches them and maps to consumer-facing status. Two families plus an internal error:

```ts
export class FrameworkError extends Error {}

// Response errors — about the response itself being bad
export class ResponseError    extends FrameworkError {}
export class RateLimitedError extends ResponseError { constructor(opts?: { retryAfter?: number }); }
export class BlockedError     extends ResponseError { constructor(opts?: { retryAfter?: number }); }
export class CaptchaError     extends BlockedError {}
export class TransientError   extends ResponseError { constructor(opts?: { retryAfter?: number }); }
export class PermanentError   extends ResponseError { constructor(opts: { reason: string }); }
export class BadResponseError extends ResponseError { constructor(opts: { reason: string }); }

// Extraction errors — about extracting from a good response
export class ExtractionError  extends FrameworkError {}
export class MissingDataError extends ExtractionError { constructor(opts: { field: string; reason: string }); }
export class MalformedDataError extends ExtractionError { constructor(opts: { field: string; reason: string }); }

// Internal — framework throws after extract when schema validation fails
export class ValidationError  extends FrameworkError {}
```

See the [framework errors glossary entry](/overview/glossary#framework-errors) for what each maps to as a consumer-facing status and when authors should throw which. The per-host [circuit breaker](/overview/glossary#circuit-breaker) counts only `ResponseError` toward opening — extraction errors are author bugs, not site outages.

## Why a builder, not a literal object

Cross-references between resources, pages, and segments need types to flow as each step is added:

- `derivedFrom: "article"` must be typed against an accumulated resource keys.
- `extract`'s return must be a subset of registered resources.
- `.use(segment)` must satisfy the segment's `requires` type.

A literal object can't type-check a key against another key in the same object — the inference happens in one pass. A builder accumulates types step-by-step, so each `.resource()` extends the type tracked by `.page()` and `.use()` that follow.

The cost is a `.build()` at the end and slightly more verbose composition. The win is full type safety on cross-references — every name reference is a compile error if it doesn't exist.

## Module map

One subsection per top-level file. Subsystems with their own page (`./build`, `./test-pkg`) get a single sentence; deeper coverage is one link away.

### `./index.ts` — the public surface

Re-exports everything authors import:

- **DSL entry**: `defineSite`, `defineSegment`.
- **URL primitive**: `urlPattern`, `URLPattern` type.
- **Schema helpers**: `presence`, `asset`.
- **TTL presets**: `TTL.realtime`, `TTL.short`, `TTL.medium`, `TTL.daily`, `TTL.weekly`.
- **Framework errors**: the full hierarchy above.
- **Runtime contract types**: `SiteDefinition`, `ExtractContext`, `PageDef`, `ResourceDef`, `RateLimitConfig`, `FrameworkRange`, `FamilyConfig`, `LocaleConfig`, `Origin`, `SiteIdentity`, `AssetRef`, `ResourceTTL`, `CrawlConfig`, `PaginateDef`, `ResponseSnapshot`.
- **JSON-LD helpers**: `extractJsonLd`, `filterJsonLdByType`.
- **robots.txt parsing**: `parseRobotsTxt`, `RobotsChecker`.
- **OpenAPI emission**: `generateOpenApiSpec`.
- **Build entry**: `buildPackage`, `validatePackage`, `snapshotUrl`, `stableSerialize`, `parseTTL`, plus the matching types.
- **Test-pkg entry**: `testPackage` and its result types.

### `./types.ts` — the contract

Types only — no runtime code. `SiteDefinition` is the final shape `defineSite(...).build()` produces; the intermediate `SiteBuilder<TConfig, TResources, TPages>` types live alongside.

**Edge case:** adding a required field to `SiteDefinition` is a major-version bump for the framework. Optional fields with defaults are the way to evolve the surface.

### `./builder.ts` — the builder implementation

`defineSite()` and `defineSegment()` return builder objects whose methods (`.resource`, `.page`, `.use`, `.checkResponse`, `.build`) accumulate state into a new builder. Each method's TypeScript signature carries the next accumulation step (e.g. `.resource(name, def)` returns `SiteBuilder<TConfig, TResources & { [name]: def }, TPages>`).

The runtime implementation is straightforward — a plain object holding a mutable map of resources and pages — but the generics are where the type safety lives.

### `./url-pattern.ts` — URLPattern factory

```ts
export function urlPattern<TPattern extends string>(
    pattern: TPattern,
    paramsSchema?: Record<ExtractParams<TPattern>, StandardSchemaV1>,
): URLPattern<ExtractParams<TPattern>>;
```

Wraps the web standard `URLPattern` constructor with the inferred-params type. The `ExtractParams<TPattern>` operation is a TypeScript template-literal type that finds `:segment` placeholders.

**Edge case: invalid pattern.** Throws synchronously at the call site. `urlPattern("/article")` with no `:` is valid (empty params).

### `./schema-helpers.ts` — `presence`, `asset`

```ts
export function presence<S extends StandardSchemaV1>(schema: S, rate: number): S;
export function asset(type: "image" | "video" | "audio" | "document"): StandardSchemaV1;
```

`presence(schema, rate)` is a Standard Schema wrapper that decorates the schema with a presence-rate annotation. The framework reads the annotation at build time (emits as a JSON Schema annotation) and at runtime (telemetry samples observed vs declared rate).

`asset(type)` returns a Standard Schema validator accepting a URL string with the asset-type brand attached. Runtime introspects via the brand for "discover all assets on this resource" tooling.

### `./errors.ts` — the framework error classes

Defines the hierarchy above. Each class carries a stable `kind` discriminator string so consumers can match without `instanceof`.

### `./ttl.ts` — TTL presets + parsing

```ts
export const TTL: {
    realtime: ResourceTTL;  // { default: "30s",  min: "10s", max: "5m" }
    short:    ResourceTTL;  // { default: "5m",   min: "1m",  max: "1h" }
    medium:   ResourceTTL;  // { default: "1h",   min: "10m", max: "6h" }
    daily:    ResourceTTL;  // { default: "24h",  min: "1h",  max: "7d" }
    weekly:   ResourceTTL;  // { default: "7d",   min: "1d",  max: "30d" }
};

export function parseTTL(s: string): number | null;
```

Authors use the presets in resource definitions: `ttl: TTL.daily`. Custom values are still allowed: `ttl: { default: "2h", min: "30m", max: "12h" }`.

### `./context.ts` — `ExtractContext` factory

Builds the context object every page callback receives. The default `fetch` throws — only the server installs a real one. JSON-LD parsing is deferred and memoised across `ctx.jsonLd()` calls on the same context.

### `./origins.ts` — locale → hostname resolution

```ts
export function getActiveOrigins(site: SiteDefinition, locale?: string): Array<{ hostname: string; locale: string | null }>;
export function getPrimaryHostname(site: SiteDefinition, locale?: string): string;
export function getAllHostnames(site: SiteDefinition): string[];
```

Pure functions. Resolves locale-templated origins (e.g. `{locale}.wikipedia.org`) against the `locales.values` set. The server's site-loader uses `getAllHostnames()` to build its hostname → site dispatch table.

### `./robots.ts` — robots.txt parsing

```ts
export interface RobotsChecker {
    isAllowed(url: string, userAgent?: string): boolean;
}

export function parseRobotsTxt(robotsTxtUrl: string, content: string): RobotsChecker;
```

A thin wrapper around `robots-parser`. The server's `robots-service` calls this once per origin per TTL, caches the resulting `RobotsChecker`, and consults it before any outbound request.

**Edge cases:**

- **Malformed robots.txt** — treated as "every URL is allowed" (matches the standard).
- **No robots.txt at all** — same. Absence means permitted.
- **User-agent matching is case-insensitive.**

### `./json-ld.ts` — JSON-LD helpers

```ts
export function extractJsonLd(driver: PageDriver): Record<string, unknown>[];
export function filterJsonLdByType(items: Record<string, unknown>[], type: string): Record<string, unknown>[];
```

Used internally by `ctx.jsonLd(type?)`; re-exported for site code that wants direct access. Flattens `@graph` containers, ignores unparseable JSON islands gracefully.

### `./cli.ts` — the `sitely` binary

```ts
#!/usr/bin/env node
```

Dispatch entrypoint behind the `sitely` command. Delegates to `./build`, `./test-pkg`, and `./openapi`.

### `./openapi.ts` — OpenAPI 3.1 emitter

```ts
export function generateOpenApiSpec(sites: SiteDefinition[]): Record<string, unknown>;
```

Each resource with a `url` becomes a `/v1/sites/{host}/{resource}` route; `derivedFrom` resources are included with a parent-link annotation. The generic endpoints (`/v1/extract`, `/v1/sites`, `/v1/schemas`, `/healthz`) are added uniformly.

### `./testing.ts` — vitest-dependent entrypoint

Authors import from `@sitely/framework/testing` in their `*.test.ts` files. Provides vitest-bound helpers (`describePageExtraction`, `createFixtureLoader`) on top of the vitest-free harness.

## The build subsystem (brief)

`./build/` is the path from authored `SiteDefinition` to `dist/index.js` + `dist/manifest.json` + `dist/schemas/*.json` + `dist/baseline-manifest.json`. Exposes `buildPackage()` as the single entrypoint. Bundling, version injection, schema emission, manifest assembly, deterministic serialization.

Deep dive: **[@sitely/framework — build subsystem](./framework-build)**.

## The test-pkg subsystem (brief)

`./test-pkg/` is the in-process test runner plus the eight checks. Discovers fixtures by walking each page's inline declarations, runs `validate` + `extract` per fixture, and aggregates check results.

Deep dive: **[@sitely/framework — test-pkg subsystem](./framework-test-pkg)**.

## The CLI

| Command | Notable flags | What it does |
|---|---|---|
| `sitely build` | `--dry-run`, `--publish` | Compiles `src/index.ts` via esbuild with version injected, emits `dist/index.js` + manifest + schemas. `--publish` rotates `dist/baseline-manifest.json` to the freshly-built manifest. |
| `sitely test` | `--only <name>`, `--skip <name>`, `--watch`, `--update <fixture>`, `--diff <fixture>`, `--strict`, `--verbose` | Runs the eight checks. Per-flag detail in [The test suite](/guide/testing). |
| `sitely check` | `--live` | Static validation — site definition shape, schema references, URLPattern parse. `--live` fetches each page's example URL and runs full extraction; opt-in. |
| `sitely snapshot <params>` | `--page <key>`, `--overwrite` | Captures HTML + meta for a fixture entry. Params are typed against the page's URLPattern. |
| `sitely fetch-fixtures` | | Re-fetches every fixture's URL, updating the on-disk HTML. |
| `sitely openapi` | `--out <file>` | Runs `generateOpenApiSpec()` and writes the resulting JSON. |
| `sitely init` | | Scaffolds a new site package. |
| `sitely dev` | | Watch mode: re-runs `validate`+`extract` against fixtures as the author edits, with diffs. |
| `sitely try <url>` | | One-shot live extraction against a real URL. |
| `sitely diff <ref>` | | Compares extracted output against a baseline. |
| `sitely doctor` | | Local health check — fixture freshness, schema validity, fixture-coverage gaps. |
| `sitely list <subject>` | | Lists `@sitely/schemas` exports, declared `TTL` presets, or framework errors. |
| `sitely migrate` | | Applies framework-version migrations. |

Every command supports `--help`.

## Read next

- **[The build manifest](./manifest)** — the single shared artifact and the field-by-field contract.
- **[Build subsystem](./framework-build)** — how the builder output becomes `dist/index.js` + `dist/manifest.json`.
- **[Test-pkg subsystem](./framework-test-pkg)** — the in-process runner and the eight checks.
- **[Site packages](./sites)** — what an `index.ts` looks like in the wild.
- **[@sitely/page](./page)** — the DOM abstraction every extract function talks to.
- **[Glossary](/overview/glossary)** — terminology used across these pages.
