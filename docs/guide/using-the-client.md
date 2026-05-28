# Using the TypeScript client

`@sitely/client` is the TypeScript SDK for calling a sitely server. It wraps the [HTTP API](./consuming-the-api) with typed methods, inferred response shapes, automatic pagination, retries, and cancellation. If you're calling sitely from TypeScript or JavaScript, this is the most ergonomic way.

If you can't or don't want to use the client — different language, edge runtime without npm, debugging — call the [HTTP API](./consuming-the-api) directly. The client is a convenience; the HTTP API is the contract.

## Install

```bash
pnpm add @sitely/client
# or
npm install @sitely/client
# or
yarn add @sitely/client
```

The package ships ESM and CJS builds, types included. Node 18+ and modern browsers (with `fetch`) are supported. The client has no runtime dependencies.

## Quick start

`@sitely/client` is typed end-to-end against the site packages you import. There's no untyped fallback — you tell the client what's installed by passing the site packages to `createClient`:

```ts
import { createClient } from "@sitely/client";
import wikipedia from "@sitely/site-wikipedia";
import nytimes from "@sitely/site-nytimes";

const sitely = createClient({
    baseUrl: "https://sitely.example/api",
    apiKey: process.env.SITELY_API_KEY!,
    sites: [wikipedia, nytimes],
});

const article = await sitely
    .site("en.wikipedia.org")
    .resource("article", { title: "TypeScript" });

//   article.data is fully typed as Wikipedia's Article shape —
//   both the schema.org Article fields and Wikipedia's extensions
//   (pageId, revisionId, categories, ...)
```

The `sites` array tells TypeScript — and the client at runtime — what your sitely server can answer for. Domain literals, resource names, parameter shapes, and return types are all inferred from it. See [Type inference](#type-inference) below for how it works.

Calls against hostnames *not* covered by the passed `sites` are a compile error in the resource-driven path, and return `status: "no_matching_site"` in the URL-driven path. There is no permissive fallback.

The rest of this page covers everything else.

## Configuration

`createClient(options)` accepts:

```ts
interface ClientOptions<TSites extends readonly SiteDefinition[]> {
    baseUrl: string;             // Your sitely server, e.g. https://sitely.example/api
    apiKey: string;              // sitely_sk_… — see "Authentication" below
    sites: TSites;               // REQUIRED — the site packages this client can call against. Drives all typing.
    timeout?: number;            // ms; default 30000
    retry?: RetryOptions | false; // client↔server retries; default: 3 attempts, exponential backoff
    batch?: boolean;             // default true — auto-batch concurrent calls into POST /v1/extract
    concurrency?: { max: number; perSite?: number }; // default { max: 20 }
    fetch?: typeof fetch;        // inject your own (e.g. for tests or proxies)
    userAgent?: string;          // appended to the default UA string
    onRequest?: (req: Request) => void;   // observability hook
    onResponse?: (res: Response) => void; // observability hook
}

interface RetryOptions {
    attempts: number;            // default 3 (so 1 try + 2 retries)
    backoff: "exponential" | "linear" | "none"; // default "exponential"
    initialDelayMs?: number;     // default 250
    maxDelayMs?: number;         // default 5000
    jitter?: boolean;            // default true for "exponential" — adds ±25% random jitter so retries don't thunder
    retryOn?: (err: unknown) => boolean; // override what's retryable
}
```

The client's `retry` config covers the **client↔server** hop only: network failure reaching the sitely server, 5xx from the sitely server itself, 429 (your per-API-key rate limit). Failures *between the server and the target website* are retried inside the server (3 attempts, 250ms → 1s → 4s, ±25% jitter) before the response comes back; the client doesn't re-attempt those. See [retry topology](/overview/glossary#retry-topology).

**Default retry behaviour:** network errors and 5xx responses are retried. 4xx is not (auth, validation, rate-limit are surfaced to your code immediately). `429` is special — see [Rate limits](#rate-limits).

**Disabling retry:** pass `retry: false`. The client will fail fast on the first error.

## Authentication

Every call requires an [API key](/overview/glossary#api-key). Get one from your sitely server:

```bash
curl -X POST https://sitely.example/api/v1/auth/signup \
    -H "Content-Type: application/json" \
    -d '{"email": "you@example.com", "name": "You"}'
```

The response contains `apiKey` — store it somewhere safe. Future calls use it as a Bearer token. The client adds the `Authorization: Bearer <key>` header for you.

**Rotating keys:** create a new key (`sitely.auth.keys.create()`), update your config, then delete the old key (`sitely.auth.keys.delete(oldKeyId)`). Old in-flight requests succeed; new requests with the old key fail.

## Calling sitely — three ways

There are three patterns, ordered by how much the client knows about what you're asking for.

**Options live in the trailing argument.** Both call shapes accept call options (`fresh`, `ttl`, `locale`, `signal`, `paginate`, `maxPages`, `cursor`) as a separate trailing object — never mixed into the first argument:

- `sitely.extract({ url }, { fresh: true })` — first arg is the request shape, second is `CallOptions`.
- `sitely.site(domain).resource(name, params, { paginate: true })` — first two args are the request shape, third is `CallOptions & PaginateOptions`.

Put request data in the typed first argument; put call-time knobs in the trailing options object.

### 1. By URL — when the site is one of yours

```ts
const page = await sitely.extract({ url: "https://en.wikipedia.org/wiki/TypeScript" });

//   page.data is the keyed wire shape — always:
//   { article: { "@type": "Article", headline: "TypeScript", ... } }
//   or, for a multi-resource page:
//   { category: { ... }, itemList: [ ... ] }
```

The server matches the hostname against the [site packages](/overview/glossary#site-package) you passed to `createClient`. If no installed package matches, the call returns `status: "no_matching_site"` — sitely doesn't guess at unknown URLs.

**Return type:**

```ts
interface ExtractResult<TData> {
    status:
        | "success"
        | "stale"
        | "no_matching_site"
        | "blocked"
        | "forbidden_by_robots"
        | "rate_limited"
        | "error";
    data: TData | null;
    site?: { domain: string; name: string };
    cached: boolean;
    extractedAt: string;     // ISO-8601 — when the data was produced
    cachedAt?: string;       // ISO-8601 — when the cache row was written; present iff cached
    pagination?: PaginationMeta;
    error?: { kind: string; [field: string]: unknown };
}
```

`TData` for a URL-driven call is the **union of every possible response shape across the sites you passed**: e.g. `{ article: WikipediaArticle } | { category: WikipediaCategory, itemList: ItemList[] } | { article: NytimesArticle } | …`. Narrow on `result.site?.domain` to pick a branch:

```ts
if (page.status === "success" && page.site?.domain === "en.wikipedia.org") {
    // page.data is narrowed to Wikipedia's possible shapes
    if ("article" in page.data) {
        page.data.article.headline;  // typed as Wikipedia's Article
    }
}
```

For runtime validation of `data` (e.g. when you don't trust the server's version of the package), use the resource's Standard Schema directly: `WikipediaArticle["~standard"].validate(page.data?.article)`. Type assertions don't narrow runtime data — they're a compile-time promise the client trusts.

### The `data` shape

The shape of `result.data` depends on which kind of call you made:

| Call shape | `data` shape | Why |
|---|---|---|
| `sitely.extract({ url })` | Keyed wire shape: `{ article: {...} }` or `{ category: {...}, itemList: [...] }`. | URL-driven calls don't name a resource. The client returns the wire verbatim. |
| `sitely.site(d).resource("article", params)` | Just the article: `{ "@type": "Article", headline, ... }`. | Resource-driven, single resource. The client unwraps `data` to the named resource. |
| `sitely.site(d).resource("article", params, { include: ["comments"] })` | Keyed: `{ article: {...}, comments: [...] }`. | Resource-driven with `include`. The result is necessarily multi-resource; the client returns the keyed shape. |

The HTTP wire shape is *always* keyed — see [Consuming the HTTP API → the response shape](./consuming-the-api#the-response-shape). The client's unwrap is a call-site convenience for the single-resource resource-driven case, not a separate wire format. Multi-resource shapes (whether driven by `extract({ url })` against a multi-resource page, or by `include`) come back keyed; switch on the keys.

### 2. By site and resource — fully typed

```ts
const article = await sitely
    .site("en.wikipedia.org")
    .resource("article", { title: "TypeScript" });

//   article.data is typed as the wikipedia:article Resource's declared schema —
//   schema.org Article fields plus Wikipedia's extensions (pageId, categories, etc.)
//
//   Unwrapped: article.data.headline works directly. No `.article` indirection,
//   because you named one resource.
```

This is the type-safe path. Use it when you know which site you're calling and which Resource you want. The compiler:

- Restricts `.site(...)` to domains your installed site packages declare.
- Restricts `.resource(...)` to the resource names that site declares.
- Types the params object against the resource's declared `params`.
- Types `article.data` as the inferred output of the resource's schema (unwrapped).

For this typing to work, you have to pass `sites` to `createClient` — see [Type inference](#type-inference) below. If you don't, `.site(...)` accepts any string and the return type falls back to `unknown`.

**Asking for multiple resources from one page** — use `include`:

```ts
const both = await sitely
    .site("en.wikipedia.org")
    .resource("article", { title: "TypeScript" }, { include: ["categories"] });

//   both.data: { article: Article, categories: string[] }
//   Keyed shape, because there are multiple resources to return.
```

The `include` option projects additional resources from the same page (the server still extracts everything; the projection is a response-time filter — see [Resource filter](/overview/glossary#resource-filter)). The result type widens from "just the named resource" to "a keyed object with the named resource plus the includes."

### 3. Site discovery

The discovery methods don't extract — they introspect what's installed.

```ts
const sites = await sitely.sites.list();
// [{ domain: "en.wikipedia.org", name: "Wikipedia", resources: [...] }, ...]

const wikipedia = await sitely.sites.get("en.wikipedia.org");
// { name: "Wikipedia", resources: { article: {...} }, schemas: {...}, rateLimit: {...} }

const schemas = await sitely.schemas.list();
// [{ name: "Article", sites: ["en.wikipedia.org", "nytimes.com"] }, ...]

const articleProviders = await sitely.schemas.providers("Article");
// [{ domain: "en.wikipedia.org", name: "Wikipedia", resource: "article" }, ...]
```

These power "find a site that provides X" UIs. Cached on the server side; cheap to call.

## Type inference

When you pass `sites` to `createClient`, the client's typing follows from the site package types directly — no codegen, no `as any`, no ceiling on what shape a resource can have.

### How it works

A [site package](/overview/glossary#site-package)'s default export is a typed [SiteDefinition](/overview/glossary#site-definition). `defineSite` preserves literal types using a `const` generic, so the inferred type knows:

- the site's `id` and `displayName`,
- each `origins[].hostname` as a string literal,
- the keys of `resources` (resource names) as string literals,
- each resource's `params` shape,
- each resource's `schema` (its Standard Schema validator).

Passing `sites: [wikipedia, nytimes]` to `createClient` gives the client a tuple type containing both site definitions. The client's `.site(domain)` method is overloaded to narrow against the union of hostnames in that tuple. `.resource(name, params)` further narrows against the matched site's resources. The return type comes from `StandardSchemaV1.InferOutput` of the resource's schema.

In short: the same TypeScript that enforces a site definition's own internal consistency at authoring time *also* enforces it at client call sites. There's no second source of truth.

### A worked example

```ts
import { createClient } from "@sitely/client";
import wikipedia from "@sitely/site-wikipedia";
import nytimes from "@sitely/site-nytimes";

const sitely = createClient({
    baseUrl: "https://sitely.example/api",
    apiKey: process.env.SITELY_API_KEY!,
    sites: [wikipedia, nytimes],
});

// ✓ Compiles — "en.wikipedia.org" is in wikipedia's origins
const article = await sitely
    .site("en.wikipedia.org")
    .resource("article", { title: "TypeScript" });

// ✗ Compile error — "en.wikipedia.org" has no resource named "post"
const bad = await sitely
    .site("en.wikipedia.org")
    .resource("post", { slug: "x" });

// ✗ Compile error — params type doesn't match wikipedia:article's declared params
const bad2 = await sitely
    .site("en.wikipedia.org")
    .resource("article", { slug: "x" });

// ✗ Compile error — "example.com" isn't in either site's origins
const bad3 = await sitely
    .site("example.com")
    .resource("anything", {});
```

`article.data` is typed as Wikipedia's full extended `Article` shape — schema.org `Article` fields plus the site-specific extensions (`pageId`, `revisionId`, `categories`, …) the site package declared.

### Runtime validation

Type assertions are compile-time promises — they don't inspect data at runtime. To verify that what the server sent actually matches the schema you expect (useful in production when the server's loaded version of a package might be newer than your imported types), call the resource's [Standard Schema](/overview/glossary#standard-schema) validator directly:

```ts
import wikipedia from "@sitely/site-wikipedia";

const article = await sitely
    .site("en.wikipedia.org")
    .resource("article", { title: "TypeScript" });

if (article.status === "success") {
    // article.data is typed against the imported wikipedia:article shape.
    // Verify at runtime that the response actually conforms:
    const ArticleSchema = wikipedia.resources.article.schema;
    const parsed = ArticleSchema["~standard"].validate(article.data);
    if (parsed.issues) {
        // The server returned data that doesn't match your imported schema.
        // Usually means the server is on a different major; see SitelyVersionMismatchError.
        console.error(parsed.issues);
    }
}
```

The client itself doesn't run this validation — it trusts the wire shape (the server already validated extractions before persisting). Reach for client-side validation when you specifically want defence-in-depth at the consumer boundary.

## Pagination

Many resources are paginated. The client offers three styles.

### Manual

```ts
const first = await sitely
    .site("en.wikipedia.org")
    .resource("category", { slug: "Software" });

console.log(first.pagination);
//   { pagesReturned: 1, hasMore: true, cursor: "eyJwYWdlIjoyfQ==", totalPages: 50, totalItems: 4823 }

if (first.pagination?.hasMore) {
    const next = await sitely
        .site("en.wikipedia.org")
        .resource("category", { slug: "Software" }, { cursor: first.pagination.cursor });
}
```

The `cursor` is opaque — don't try to decode it. The structure is implementation-defined and may change.

### Walk-many

```ts
const result = await sitely
    .site("en.wikipedia.org")
    .resource("category", { slug: "Software" }, {
        paginate: true,
        maxPages: 5,
    });

//   result.data contains the merged items from up to 5 pages
//   result.pagination.pagesReturned tells you how many actually ran
```

The server walks the pagination chain server-side and returns merged data. Cheaper than N round trips.

**Merge semantics:** array-typed resources are concatenated across the walk; scalar (object-typed) resources are taken from the first page only. See [Consuming the HTTP API → how the walk merges pages](./consuming-the-api#how-the-walk-merges-pages) for the contract.

### Async iteration

`pages()` lives on the site scope and returns an `AsyncIterable<ExtractResult<...>>` — no `await`, no chained promise. Use it when you want to stream pages one at a time:

```ts
const stream = sitely
    .site("en.wikipedia.org")
    .pages("category", { slug: "Software" }, { maxPages: 50 });

for await (const page of stream) {
    // page is one ExtractResult per iteration
    console.log(page.data);
}
```

Useful for memory-bounded workloads. Stops at `maxPages` or when the server reports `hasMore: false`. The iterator throws if a single page fails — pages yielded before the failure are still yours.

## Cancellation

All methods accept an `AbortSignal`:

```ts
const controller = new AbortController();

const result = sitely.extract({
    url: "https://slow-site.example/page",
}, { signal: controller.signal });

// elsewhere:
controller.abort();

try {
    await result;
} catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
        // handled
    }
}
```

Aborting a request:

- Cancels in-flight HTTP if the runtime supports it (`fetch` with signal).
- Does **not** stop the server's extraction work — the server may complete the extraction and cache the result; your client just won't see the response.
- The wasted work is the server's wall-clock and the round-trip you didn't consume.

## Freshness control

The client exposes the three knobs from the HTTP API as call options. See [Freshness](./consuming-the-api#freshness) for the full contract and [`extractedAt` in the response](#status-discrimination) below.

```ts
// Force a live extraction, regardless of cache age
const fresh = await sitely.extract({ url: "..." }, { fresh: true });

// Require data ≤ 10 minutes old; re-extract if the cache is older
const recent = await sitely.extract({ url: "..." }, { maxAge: "10m" });

// Refuse the stale-cache fallback when re-extract fails:
// returns status: "error" instead of "stale"
const strict = await sitely.extract({ url: "..." }, { maxAge: "10m", acceptStale: false });
```

**`fresh: true`** bypasses the cache entirely.

**`maxAge: "<duration>"`** is a *consumer freshness* constraint — "I need data this fresh or fresher." The server re-extracts when the cached row is older. The duration is clamped to the resource's `[min, max]` bounds.

**`acceptStale: false`** flips the failure behaviour. By default (`true`), a re-extract failure with a stale cached row returns `status: "stale"` with the data. With `acceptStale: false`, the same situation returns `status: "error"` — data older than your freshness constraint is never returned.

Each response carries `extractedAt` (ISO-8601, always) and `cachedAt` (when the response is `cached: true`). Read `extractedAt` to know the age of the data regardless of cache hit/miss.

## Locale override

For sites that serve multiple [locales](/overview/glossary#locale):

```ts
const article = await sitely
    .site("en.wikipedia.org")  // English site
    .resource("article", { title: "TypeScript" }, { locale: "fr" });
```

The override only works if the site declares that locale. If the locale isn't in the site's declared `locales.values`, the call fails with a typed error.

## Errors

The client uses **exceptions for transport / protocol errors** and **the result object for extraction-level outcomes**. The distinction:

| Kind | How you see it |
|---|---|
| Network unreachable, DNS failure | throws `SitelyNetworkError` |
| Auth failed (401, missing/invalid/removed key; 403, admin route without `X-Admin-Secret`) | throws `SitelyAuthError` |
| Site version mismatch (409) — major-version difference between imported and server-loaded site | throws `SitelyVersionMismatchError` |
| Rate limited (429) — after retries exhausted | throws `SitelyRateLimitError` |
| Bad request (400, missing params) | throws `SitelyBadRequestError` |
| Server internal error (5xx) — after retries exhausted | throws `SitelyServerError` |
| URL was extracted but robots.txt forbade it | result.status === "forbidden_by_robots" |
| URL was fetched but extraction failed | result.status === "error", result.data === null |
| Stale cache returned because live extract failed | result.status === "stale", result.cached === true |
| Site is rate-limiting sitely's outbound fetch | result.status === "rate_limited" |

The rationale: transport errors mean *you* did something wrong (bad config, no network, wrong key). Extraction outcomes are *part of the answer* — your code should branch on them.

### Error types

All errors extend `SitelyError`:

```ts
import {
    SitelyError,                 // base class
    SitelyNetworkError,          // network / DNS / timeout
    SitelyAuthError,             // 401 missing/invalid key, or 403 admin-secret missing
    SitelyVersionMismatchError,  // 409 site major-version mismatch — carries { site, clientVersion, serverVersion }
    SitelyBadRequestError,       // 400
    SitelyRateLimitError,        // 429 after retries — carries retryAfter
    SitelyServerError,           // 5xx after retries — carries upstreamStatus
} from "@sitely/client";

try {
    const r = await sitely.extract({ url });
} catch (err) {
    if (err instanceof SitelyRateLimitError) {
        console.warn(`Try again after ${err.retryAfter}s`);
    } else if (err instanceof SitelyAuthError) {
        process.exit(1);
    } else {
        throw err;
    }
}
```

Every error carries the request URL, the response status (if any), and a `cause` chain.

### Site version mismatch

Every typed request carries the imported site package's version. The server returns `409` if its loaded version of that site differs from yours in the major position — your TypeScript types may not match the server's actual extraction shape.

```ts
import { SitelyVersionMismatchError } from "@sitely/client";

try {
    const article = await sitely
        .site("en.wikipedia.org")
        .resource("article", { title: "TypeScript" });
} catch (err) {
    if (err instanceof SitelyVersionMismatchError) {
        console.error(
            `Site '${err.site}' is at ${err.serverVersion} on the server; ` +
            `your installed version is ${err.clientVersion}. Update one of them.`
        );
    }
}
```

The fix is to align the versions: update `@sitely/site-wikipedia` in your `package.json` to a major version the server has, or upgrade the server to a version compatible with what you've installed. Minor and patch differences are tolerated — only major mismatches trigger the error.

In a batched request, only the mismatched entry returns the 409 in its slot; the other entries process normally. The client raises `SitelyVersionMismatchError` for the failed entry while the rest of the batch returns successfully.

### Status discrimination

For the result statuses, a discriminated union helper:

```ts
if (result.status === "success") {
    // result.data is non-null here
    console.log(result.data.headline);
} else if (result.status === "stale") {
    // got stale cache; result.data is non-null (the previously cached value)
    console.warn(`served stale, extracted at ${result.extractedAt}`, result.data);
} else if (result.status === "no_matching_site") {
    // no installed site package handles this hostname
    console.error("no package for", result.error?.hostname);
} else if (result.status === "forbidden_by_robots") {
    // robots.txt disallowed; result.data is null
}
```

TypeScript narrows `data` to non-null inside the `"success"` and `"stale"` branches. The other five statuses (`no_matching_site`, `blocked`, `forbidden_by_robots`, `rate_limited`, `error`) carry `data: null` — narrow on `status` before reading `data`.

`extractedAt` is always present, on every status. For failure cases (`stale`, `error`, etc.) it tells you exactly how old the cached row was — useful when deciding whether to retry or accept what was given.

## Rate limits

The server enforces two rate limits: per-API-key (your client's overall throughput) and per-site (sitely respecting the target). When you hit either:

1. The HTTP response is `429` with a `Retry-After` header.
2. The client retries automatically up to `retry.attempts`, with backoff.
3. If retries exhaust, the client throws `SitelyRateLimitError` with `retryAfter` set to the server's hint (in seconds).

**Coalescing helps you.** Ten parallel calls to the client for the same URL count as one extraction at the server. The client itself doesn't deduplicate — you can do that with a small helper if needed:

```ts
const pending = new Map<string, Promise<ExtractResult>>();
function once(url: string) {
    if (!pending.has(url)) {
        pending.set(url, sitely.extract({ url }).finally(() => pending.delete(url)));
    }
    return pending.get(url)!;
}
```

## Custom fetch

For tests, proxies, or runtimes with non-standard `fetch`:

```ts
const sitely = createClient({
    baseUrl: "...",
    apiKey: "...",
    fetch: async (input, init) => {
        // your custom transport
        return globalThis.fetch(input, init);
    },
});
```

The injected `fetch` receives the same `RequestInfo` and `RequestInit` as the standard API.

## Observability

The `onRequest` and `onResponse` hooks fire for every HTTP round-trip the client makes — useful for logging, tracing, or metrics:

```ts
const sitely = createClient({
    baseUrl: "...",
    apiKey: "...",
    onRequest: (req) => tracer.startSpan("sitely.fetch", { url: req.url }),
    onResponse: (res) => tracer.endSpan(res.url, res.status),
});
```

For retries, both hooks fire once per attempt.

## Codegen: when you can't install the packages

The client always needs `sites` at construction time — that's how every call gets typed. The recommended path is to install the site packages you need (`pnpm add @sitely/site-wikipedia`) and import them directly; the package's own type information is the source of truth, nothing is generated, nothing drifts.

When direct install doesn't fit (the server runs a large set of community packages you don't want in your dependency tree; you're integrating against a server whose installed set changes at deploy cadence; you want a one-file generated registry), the optional `sitely-client` CLI ships with `@sitely/client`:

```bash
pnpm sitely-client fetch-types \
    --base-url https://sitely.example/api \
    --api-key $SITELY_API_KEY \
    --output ./src/sitely-types.ts
```

This reads each installed site's [manifest](/overview/glossary#manifest) and its [JSON Schema](/overview/glossary#json-schema) sidecars, then emits a TypeScript `sites` array that you pass to `createClient` the same way as real site packages. The generated module is declaration-only — no runtime validators — but it satisfies the `sites` requirement and gives you full type inference at call sites.

```ts
import { siteRegistry } from "./sitely-types";

const sitely = createClient({
    baseUrl,
    apiKey,
    sites: siteRegistry,        // typed at compile time; no runtime validators
});

const article = await sitely
    .site("en.wikipedia.org")
    .resource("article", { title: "x" });
// article.data typed against the schema fetched at codegen time
```

Re-run `sitely-client fetch-types` whenever the server's installed set changes. This is build-time codegen, not runtime registration — once compiled, the resulting client behaves identically to one constructed from imported packages.

## Common patterns

### Chunked batch extraction

```ts
async function extractMany(urls: string[], concurrency = 5) {
    const results: ExtractResult[] = [];
    for (let i = 0; i < urls.length; i += concurrency) {
        const batch = urls.slice(i, i + concurrency);
        const batchResults = await Promise.all(
            batch.map((url) => sitely.extract({ url }).catch((e) => ({ error: e }))),
        );
        results.push(...batchResults as ExtractResult[]);
    }
    return results;
}
```

Respects the server's per-API-key rate limit naturally because of the bounded concurrency.

### Long-lived watcher

For pulling a resource on a schedule:

```ts
setInterval(async () => {
    const result = await sitely.extract({ url }, { fresh: false });
    if (!result.cached) {
        // value changed since last poll
        onUpdate(result.data);
    }
}, 60_000);
```

`fresh: false` (the default) means you get the cached value if fresh; the server only re-fetches when the TTL expires. Cheap polling.

### Server-sent events

Not currently supported by the server. Polling is the pattern; see above.

### React / SWR

The client is not React-aware. Use SWR or TanStack Query with the client as the fetcher:

```ts
import useSWR from "swr";

function useExtract(url: string) {
    return useSWR(["extract", url], () => sitely.extract({ url }));
}
```

The client's own retry logic plays well with SWR — set `retry: false` on the client if you want SWR's retry behaviour to be the only one.

## Edge cases / What if?

### What if the server is on a different version of sitely than the client?

The client and server speak the HTTP API, which has a stable contract version. Minor server upgrades shouldn't break the client. If a major version jump introduces new response fields, the client tolerates unknown fields. If the server *removes* a field the client expects, you'll get a typed parse error on response — open an issue if you hit this.

### What if I'm using a self-signed certificate on my self-hosted server?

Pass a custom `fetch` that configures the underlying transport (Node's `fetch` with `undici`-style options, or your runtime's equivalent). The client doesn't surface TLS config directly — that's a runtime-of-choice concern.

### What if I want to call sitely from a browser without exposing my API key?

Don't. Route calls through your own backend, which holds the API key. The client works equally well server-side and in the browser, but in the browser it's only safe to use a session-scoped key your backend issues.

### What if I want to pre-fetch results for SSR?

Standard pattern: call the client server-side, embed the result in initial state, hydrate the client. The result objects are JSON-serializable.

### What if my call times out but the server completes the extraction?

The server caches the successful extraction; your next call will hit the cache. The wasted work is the server's wall-clock and the round-trip you didn't get to consume.

### What if I get back `status: "no_matching_site"`?

The URL's hostname has no installed site package. Call `sitely.sites.list()` to see what *is* installed on the server, then either install a package for that site, write one (see [Writing a site package](/guide/writing-a-site)), or skip the URL. sitely doesn't carry a generic-extraction fallback.

### What if a paginated walk fails halfway?

The walk-many path (`paginate: true, maxPages: N`) returns what was collected so far, with `pagination.hasMore: true` and `pagination.cursor` set to where the walk stopped. You can resume by passing the cursor on the next call.

The async-iteration path throws on the failing page; pages before that one were already yielded.

### What if I want to test code that uses the client without hitting a real server?

Either inject a stub `fetch`:

```ts
import wikipedia from "@sitely/site-wikipedia";

const sitely = createClient({
    baseUrl: "https://test",
    apiKey: "test",
    sites: [wikipedia],   // required — pass the sites your test code calls against
    fetch: async (req) => {
        const url = new URL(req.url);
        if (url.pathname === "/v1/extract") {
            return new Response(JSON.stringify({
                status: "success",
                data: { article: { "@type": "Article", headline: "Stub" } },
                site: { domain: "en.wikipedia.org", name: "Wikipedia" },
                cached: false,
                extractedAt: "2026-05-28T14:22:01Z",
            }), { headers: { "Content-Type": "application/json" } });
        }
        return new Response("Not stubbed", { status: 404 });
    },
});
```

Or use MSW / nock / a recording proxy — the client is a thin layer over standard `fetch`, so any HTTP test tooling works.

### What if I want to know what the client's actual HTTP requests look like?

Use `onRequest`:

```ts
createClient({
    baseUrl,
    apiKey,
    onRequest: (req) => console.log(req.method, req.url),
});
```

Or set `DEBUG=sitely:*` if you're on Node and the client respects that (it does — debug logs include the URL, headers minus auth, and timing).

### What if I have a long list of URLs and want to feed them through as fast as the server will allow?

Use the bounded-concurrency pattern from above with `concurrency` matching your API key's per-second limit. The server's rate-limiter is the upstream bottleneck; the client doesn't enforce anything on top.

### What if I want the server to validate the response against the schema *before* returning?

The server already does. Every fresh extraction is validated against the resource's schema before it's persisted to the cache; the `schema-conformance` build check pins this at site-package publish time too. Bad data never enters the cache.

If you want a *second* validation pass at the consumer boundary (defence in depth — e.g. the server is on a newer major than your imported types, or you don't trust the wire), call the resource's [Standard Schema](/overview/glossary#standard-schema) validator directly. The type generic on `extract` doesn't validate at runtime; it's a compile-time assertion only.

```ts
import wikipedia from "@sitely/site-wikipedia";

const result = await sitely
    .site("en.wikipedia.org")
    .resource("article", { title: "TypeScript" });

if (result.status === "success") {
    const ArticleSchema = wikipedia.resources.article.schema;
    const parsed = ArticleSchema["~standard"].validate(result.data);
    if (parsed.issues) {
        // The server returned data that doesn't match your imported schema.
    }
}
```

## Reference: every client method

```ts
interface SitelyClient<TSites extends readonly SiteDefinition[]> {
    // URL-driven extraction — typed against the union of every possible response shape
    // across the sites you passed to createClient. Hostnames outside that set return
    // status: "no_matching_site".
    extract(args: ExtractArgs, opts?: CallOptions): Promise<ExtractResult<ExtractByUrlData<TSites>>>;

    // Resource-driven extraction — statically typed; `domain` must be in TSites.
    site<D extends DomainsOf<TSites>>(domain: D): TypedSiteScope<TSites, D>;

    // Discovery (read-only introspection of what the server has installed)
    sites: {
        list(opts?: CallOptions): Promise<SiteSummary[]>;
        get(domain: string, opts?: CallOptions): Promise<SiteDetail>;
    };
    schemas: {
        list(opts?: CallOptions): Promise<SchemaSummary[]>;
        providers(schemaType: string, opts?: CallOptions): Promise<SchemaProvider[]>;
    };

    // Auth
    auth: {
        keys: {
            list(opts?: CallOptions): Promise<ApiKey[]>;
            create(opts?: CallOptions): Promise<ApiKey & { apiKey: string }>;
            delete(id: string, opts?: CallOptions): Promise<void>;
        };
    };

    // Lifecycle
    dispose(): void;  // releases any internal timers / pools
}

// Call `dispose()` when the client is no longer needed: long-running services
// that hold a pool of clients per tenant, or framework hot-reload paths that
// re-create the client on every code change. Short-lived processes can skip it.

interface TypedSiteScope<TSites, TDomain> {
    // Single resource — unwrapped data
    resource<TName extends ResourceNamesOf<TSites, TDomain>>(
        name: TName,
        params: ResourceParamsOf<TSites, TDomain, TName>,
        opts?: CallOptions & PaginateOptions,
    ): Promise<ExtractResult<ResourceOutputOf<TSites, TDomain, TName>>>;

    // With include — keyed multi-resource shape
    resource<TName extends ResourceNamesOf<TSites, TDomain>, TIncl extends ResourceNamesOf<TSites, TDomain>>(
        name: TName,
        params: ResourceParamsOf<TSites, TDomain, TName>,
        opts: CallOptions & PaginateOptions & { include: readonly TIncl[] },
    ): Promise<ExtractResult<KeyedResources<TSites, TDomain, TName | TIncl>>>;

    // Async-iterable pagination — yields one ExtractResult per page
    pages<TName extends ResourceNamesOf<TSites, TDomain>>(
        name: TName,
        params: ResourceParamsOf<TSites, TDomain, TName>,
        opts?: CallOptions & { maxPages?: number; cursor?: string },
    ): AsyncIterable<ExtractResult<ResourceOutputOf<TSites, TDomain, TName>>>;
}

interface CallOptions {
    signal?: AbortSignal;
    fresh?: boolean;        // bypass cache regardless of age
    maxAge?: string;        // consumer freshness, e.g. "10m"; clamped to resource's [min, max]
    acceptStale?: boolean;  // default true; when false, stale-cache fallback returns "error" instead of "stale"
    locale?: string;
    include?: readonly string[];  // additional resources to project from a multi-resource page
}

interface PaginateOptions {
    paginate?: boolean;
    maxPages?: number;
    cursor?: string;
}
```

Full type declarations ship with the package — your IDE has the canonical reference.

## Read next

- [Consuming the API](./consuming-the-api) — the HTTP contract underneath the client.
- [Self-hosting the server](./self-hosting) — if you're running sitely yourself.
- [Glossary](/overview/glossary) — terms used in this page.
