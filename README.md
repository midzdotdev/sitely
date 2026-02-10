# WAPI

A service that turns websites into structured JSON APIs via community-driven scraper definitions, with schema.org types, token-based billing, and a generic fallback extractor that works on any URL.

## How it works

1. A **scraper author** writes a site definition -- a TypeScript module declaring URL patterns, validation, extraction logic, pagination, and schema mappings
2. A **consumer** sends a URL (or a resource type + params) to the API
3. The server matches the URL to a site definition, fetches the page, runs validate/extract, and returns structured JSON
4. If no site definition exists, the **generic fallback extractor** pulls JSON-LD, OpenGraph, Twitter Cards, meta tags, and feeds from any page

Every extraction returns a status: `success`, `blocked` (site is rate-limiting), `stale` (scraper needs updating), `forbidden_by_robots`, or `error`.

## Quick start

```bash
# Prerequisites: Node.js >= 20, pnpm
pnpm install
pnpm build

# Start infrastructure (Postgres, Redis, MinIO)
docker compose up -d

# Start the server (loads site definitions from sites/)
node packages/server/dist/index.js

# Create an account
curl -X POST http://localhost:3000/v1/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email": "you@example.com"}'
# Returns your API key (shown once)

# Extract data from any URL
curl "http://localhost:3000/v1/extract?url=https://en.wikipedia.org/wiki/TypeScript" \
  -H "Authorization: Bearer wapi_sk_..."

# Fetch a resource by type
curl "http://localhost:3000/v1/sites/en.wikipedia.org/article?title=TypeScript" \
  -H "Authorization: Bearer wapi_sk_..."
```

## Repository structure

```
wapi/
  packages/
    page/            @wapi/page      -- PageDriver abstraction + CheerioDriver
    schemas/         @wapi/schemas   -- TypeScript types from schema.org
    framework/       @wapi/framework -- defineSite(), extraction context, utilities
    server/          @wapi/server    -- Hono REST API + service layer
  sites/
    en.wikipedia.org/                -- Wikipedia article extraction
    news.ycombinator.com/           -- HN front page + stories + comments
  docker-compose.yml                 -- Postgres, Redis, MinIO
  Dockerfile
  turbo.json
  pnpm-workspace.yaml
```

## Packages

### @wapi/page

DOM abstraction layer. Defines `PageDriver` and `PageElement` interfaces that all drivers implement (Cheerio today, JSDOM and Playwright in the future). Scraper authors write against this interface so their code works regardless of the underlying engine.

```typescript
interface PageDriver {
  $(selector: string): PageElement | null;
  $$(selector: string): PageElement[];
  title(): string;
  html(): string;
  status: number;
  headers: Record<string, string>;
  url: string;
}

interface PageElement {
  $(selector: string): PageElement | null;
  $$(selector: string): PageElement[];
  text(): string;
  attr(name: string): string | null;
  exists(): boolean;
  next(): PageElement | null;
  parent(): PageElement | null;
  children(): PageElement[];
  // ...
}
```

### @wapi/schemas

TypeScript interfaces derived from schema.org: `Thing`, `Article`, `Product`, `Person`, `Organization`, `VideoObject`, `ItemList`, `Review`, `AggregateRating`, and more. Also exports a `Schema` constant for use in site definitions:

```typescript
import { Schema } from "@wapi/schemas";
Schema.Article  // "Article"
Schema.Product  // "Product"
```

### @wapi/framework

The core framework for writing site definitions:

- **`defineSite()`** -- type-safe builder with `as const` support for full literal type inference
- **`createExtractContext()`** -- builds the `ctx` object passed to validate/extract/paginate
- **`parseJsonLd()`** -- extracts and parses all JSON-LD script blocks
- **`getCanonicalFromHtml()`** -- reads the canonical link tag
- **`isAllowedByRobots()`** -- checks a URL against robots.txt content
- **`createFixtureTest()`** -- test harness for running extractors against HTML fixtures

### @wapi/server

Hono-based REST API with a shared service layer:

- **Auth**: API key signup, SHA-256 hashed storage, Bearer token middleware
- **Billing**: token-based pricing (base compute + per-MB), immediate deduction before work, reconciliation after
- **Cache**: in-memory cache with configurable TTL per resource
- **Extract service**: site-specific extraction with validate/extract, generic fallback, URL pattern matching
- **Site loader**: dynamically loads site definitions from disk at startup
- **HTTP client**: User-Agent rotation, compression, redirect following, timeouts

## REST API

### Discovery (no auth required)

```
GET  /health                       Health check
GET  /v1/sites                     List all sites with their resources
GET  /v1/sites/:domain             Site detail (resources, pages, pagination)
GET  /v1/schemas                   List all schema types
GET  /v1/schemas/:type/sites       Which sites provide a given schema type
```

### Auth

```
POST /v1/auth/signup               Create account, receive API key (shown once)
GET  /v1/auth/balance              Current token balance
```

### Extraction (auth required)

```
GET  /v1/extract?url=<url>         Extract from any URL (site def or fallback)
GET  /v1/sites/:domain/:resource   Fetch resource by type (?param=value)
```

## Writing a site definition

Site definitions live in `sites/<domain>/index.ts`. Each one uses `defineSite()` to declare the site's URL patterns, validation, extraction logic, and metadata:

```typescript
// sites/en.wikipedia.org/index.ts
import { defineSite, Schema } from "@wapi/framework";

export default defineSite({
  name: "Wikipedia (English)",
  domain: "en.wikipedia.org",

  normalizeUrl: (url) => {
    const u = new URL(url);
    u.searchParams.delete("action");
    u.searchParams.delete("oldid");
    u.hash = "";
    return u.toString();
  },

  rateLimit: { maxConcurrent: 3, requestsPerSecond: 1 },

  resources: {
    article: {
      schema: Schema.Article,
      params: {
        title: { type: "string", required: true, description: "Article title" },
      },
      resolve: (p) => `/wiki/${encodeURIComponent(p["title"] ?? "")}`,
      ttl: "24h",
    },
  },

  pages: {
    "/wiki/:title": {
      provides: ["article"],
      examples: ["https://en.wikipedia.org/wiki/TypeScript"],

      validate: (ctx) =>
        ctx.$("#content")?.exists() === true &&
        ctx.$(".mw-parser-output")?.exists() === true &&
        ctx.status === 200,

      extract: async (ctx) => ({
        article: {
          title: ctx.$("#firstHeading")?.text()?.trim() ?? "",
          summary: ctx.$(".mw-parser-output > p")?.text()?.trim() ?? "",
          image: ctx.media(ctx.$(".infobox img")?.attr("src")),
          categories: ctx.$$("#mw-normal-catlinks li a").map((el) => el.text()),
          ...((ctx.jsonLd(Schema.Article)[0]) ?? {}),
        },
      }),
    },
  },

  crawl: { enabled: true, respectRobotsTxt: true, maxDepth: 2 },
});
```

### The extraction context (ctx)

Every `validate`, `extract`, and `paginate` function receives a context object:

- `ctx.$(selector)` -- query a single element (returns `PageElement | null`)
- `ctx.$$(selector)` -- query all matching elements (returns `PageElement[]`)
- `ctx.jsonLd(type?)` -- parsed JSON-LD from the page, optionally filtered by `@type`
- `ctx.media(url)` -- mark a URL as media for the pipeline, returns a `MediaRef`
- `ctx.params` -- URL pattern params (e.g. `{ title: "TypeScript" }`)
- `ctx.url` -- the full resolved URL
- `ctx.canonical` -- the canonical link href, if present
- `ctx.status` -- HTTP status code
- `ctx.headers` -- response headers
- `ctx.fetch(url)` -- sandboxed fetch for supplementary requests

### Validation

Every page must define a `validate` function. It asserts structural invariants about the real page -- things that would be true regardless of content changes but false on a block/captcha page:

```typescript
validate: (ctx) =>
  ctx.$("#content")?.exists() === true && ctx.status === 200,
```

The framework uses validation to classify extraction failures: if `validate` fails, the status is `blocked`; if `validate` passes but `extract` throws, the status is `stale`.

### Pagination

Pages can declare a `paginate` descriptor with a `next` function that returns the URL of the next page (or `null`):

```typescript
paginate: {
  next: (ctx) => {
    const more = ctx.$("a.morelink")?.attr("href");
    return more ? `https://news.ycombinator.com/${more}` : null;
  },
},
```

## Testing site definitions

Each site definition should include HTML fixtures and tests. Use the `createFixtureTest()` harness:

```typescript
import { readFileSync } from "node:fs";
import { createFixtureTest } from "@wapi/framework";
import site from "./index.js";

const html = readFileSync("fixtures/wiki-typescript.html", "utf-8");
const t = createFixtureTest({
  site,
  html,
  url: "https://en.wikipedia.org/wiki/TypeScript",
  params: { title: "TypeScript" },
});

expect(t.validate("/wiki/:title")).toBe(true);

const data = await t.extract("/wiki/:title");
expect(data.article.title).toBe("TypeScript");
```

Run all tests:

```bash
pnpm test
```

## Token billing

Operations cost tokens proportional to actual infrastructure costs:

| Operation | Base | Per MB |
|---|---|---|
| Cached data read | 1 | 0.5 |
| Live scrape (static) | 5 | 2 |
| Fallback extraction | 3 | 2 |
| Media download | 5 | 3 |
| Discovery/listing | 0 | 0 |

Tokens are deducted **before** work begins. After completion, the actual cost is reconciled -- if real data is smaller than estimated, the difference is credited back. Tokens are never refunded on consumer disconnect (the work completes to populate the cache).

New accounts start with 10,000 tokens.

## Extraction failure classification

| Status | Meaning | Charged? |
|---|---|---|
| `success` | Data extracted correctly | Yes (actual cost) |
| `blocked` | `validate` failed -- site may be rate-limiting | Yes (base compute) |
| `stale` | `validate` passed but `extract` threw -- scraper needs updating | Yes (base compute) |
| `forbidden_by_robots` | Path disallowed by robots.txt | No |
| `error` | Network failure, timeout, or system error | Yes (base compute) |

## Generic fallback extractor

For URLs with no site definition, the fallback extractor returns:

- **JSON-LD** -- all JSON-LD script blocks, parsed
- **OpenGraph** -- `og:title`, `og:description`, `og:image`, etc.
- **Twitter Cards** -- `twitter:title`, `twitter:description`, etc.
- **Meta tags** -- title, description, author, keywords
- **Canonical URL** -- the canonical link tag
- **Feeds** -- RSS and Atom alternate link URLs

The response includes `"definitionType": "fallback"` so consumers know this is best-effort extraction.

## Development

```bash
pnpm install          # Install dependencies
pnpm build            # Build all packages
pnpm test             # Run all tests (21 tests across 4 suites)
pnpm typecheck        # Type-check all packages
pnpm lint             # Lint with Biome
```

## Infrastructure

```bash
docker compose up -d  # Start Postgres, Redis, MinIO
docker compose down   # Stop everything
```

The server reads `SITES_DIR` (defaults to `./sites`) and dynamically loads all site definitions at startup.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Server port |
| `SITES_DIR` | `./sites` | Path to site definitions directory |
| `DATABASE_URL` | -- | Postgres connection string |
| `REDIS_URL` | -- | Redis connection string |
| `S3_ENDPOINT` | -- | S3-compatible object storage endpoint |

## Contributing a site definition

1. Create `sites/<domain>/index.ts` using `defineSite()` from `@wapi/framework`
2. Save HTML fixtures in `sites/<domain>/fixtures/`
3. Write tests in `sites/<domain>/index.test.ts` using `createFixtureTest()`
4. Run `pnpm test` and `pnpm typecheck` to verify
5. Submit a PR -- CI runs type-check, lint, fixture tests, and schema validation

## Roadmap

**Phase 2** -- GraphQL API (graphql-yoga + Pothos), `@wapi/client` with pure type inference, media pipeline (download, HLS/DASH capture, object storage), background crawling

**Phase 3** -- CLI (`@wapi/cli`), MCP server, JSDOMDriver, consumer dashboard

**Future** -- PlaywrightDriver for dynamic sites, webhooks/subscriptions, ML caching optimizer, federation
