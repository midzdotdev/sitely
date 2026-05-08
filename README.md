# sitely

Turn websites into structured JSON APIs.

## What is sitely?

sitely is a web extraction service that converts websites into typed, structured data via a REST API. It combines **site-specific extractors** — community-driven scraper definitions that know exactly how to parse a given website — with a **generic fallback** that extracts JSON-LD, OpenGraph, Twitter Cards, and meta tags from any URL.

Site definitions are declarative TypeScript modules that describe a website's URL patterns, validation rules, and extraction logic. They produce schema.org-typed output, are tested against HTML fixtures, and respect robots.txt. The server handles caching, rate limiting, request coalescing, and usage tracking.

## Why sitely?

- **Typed output** — every response maps to a schema.org type (Article, Product, ItemList, etc.), not arbitrary key-value blobs
- **Testable extractors** — site definitions run against HTML fixtures in CI, catching breakage before deployment
- **Fallback for any URL** — unknown sites still return JSON-LD, OpenGraph, and meta tag data
- **Multi-layer caching** — Redis hot cache + Postgres persistence with configurable TTLs per resource
- **Rate limiting & robots.txt** — per-site and per-API-key limits, robots.txt enforced on every request
- **Request coalescing** — duplicate in-flight requests are merged, not re-fetched

## Packages

| Package | Description |
|---------|-------------|
| `@sitely/page` | DOM abstraction layer (PageElement, PageDriver, CheerioDriver) |
| `@sitely/schemas` | Hand-written schema.org TypeScript types |
| `@sitely/framework` | Site definition DSL, extraction context, test utilities |
| `@sitely/server` | HTTP API server (Hono, Postgres, Redis) |

## Getting Started

### Prerequisites

- Node.js 22+
- pnpm 9+
- Docker & Docker Compose

### Run locally

```bash
# Start Postgres and Redis
docker compose up -d postgres redis

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Start the server (requires DB and Redis running)
# See packages/server/README.md for environment variables
```

### API usage

```bash
# Create an account and get an API key
curl -X POST http://localhost:3000/v1/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "name": "User"}'

# Extract a Wikipedia article
curl http://localhost:3000/v1/sites/en.wikipedia.org/article?title=TypeScript \
  -H "Authorization: Bearer sitely_sk_..."

# Extract from any URL (fallback extraction)
curl "http://localhost:3000/v1/extract?url=https://example.com" \
  -H "Authorization: Bearer sitely_sk_..."

# List available sites
curl http://localhost:3000/v1/sites \
  -H "Authorization: Bearer sitely_sk_..."
```

## Writing a Site Definition

Site definitions live in `sites/<domain>/index.ts`. Here's a minimal example:

```ts
import { Schema, defineSite } from "@sitely/framework";

export default defineSite({
  name: "Example Blog",
  domain: "blog.example.com",
  rateLimit: { maxConcurrent: 2, requestsPerSecond: 1 },
  resources: {
    post: {
      schema: Schema.Article,
      params: { slug: { type: "string", required: true } },
      resolve: (p) => `/posts/${p.slug}`,
      ttl: "1h",
    },
  },
  pages: {
    "/posts/:slug": {
      provides: ["post"],
      examples: ["https://blog.example.com/posts/hello-world"],
      validate: (ctx) => ctx.$("article")?.exists() === true,
      extract: async (ctx) => ({
        post: {
          title: ctx.$("h1")?.text() ?? "",
          body: ctx.$("article .content")?.text() ?? "",
          author: ctx.$(".author-name")?.text() ?? "",
          ...ctx.jsonLd("Article")[0],
        },
      }),
    },
  },
});
```

### Testing with fixtures

Save an HTML fixture and write tests using the framework's test utilities:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { matchPagePattern, testExtract } from "@sitely/framework";
import site from "./index.js";

const fixture = readFileSync("./fixtures/hello-world.html", "utf-8");

describe("blog.example.com", () => {
  it("matches the post page pattern", () => {
    const match = matchPagePattern(site, "https://blog.example.com/posts/hello-world");
    expect(match?.pageKey).toBe("/posts/:slug");
    expect(match?.params.slug).toBe("hello-world");
  });

  it("extracts post data", async () => {
    const result = await testExtract(site, "/posts/:slug", {
      html: fixture,
      url: "https://blog.example.com/posts/hello-world",
      params: { slug: "hello-world" },
    });
    expect(result.post).toBeDefined();
  });
});
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

## Development

```bash
pnpm install          # Install dependencies
pnpm build            # Build all packages
pnpm typecheck        # Type-check all packages
pnpm test             # Run all tests
pnpm lint             # Lint with Biome
pnpm lint:fix         # Auto-fix lint issues
pnpm docs             # Generate API reference with TypeDoc
```
