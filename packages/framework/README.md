# @wapi/framework

Core site definition DSL for WAPI.

## Overview

`@wapi/framework` provides the tools for defining how to extract structured data from websites. A site definition declares URL patterns, validation rules, and extraction logic. The framework also provides test utilities for running extractors against HTML fixtures without network calls.

## Key Concepts

### SiteDefinition

The top-level object describing a website. Contains the domain, rate limits, resources (what data can be extracted), and pages (how to extract it).

### PageDef

A page definition tied to a URL pattern (e.g. `"/wiki/:title"`). Declares which resources it provides, how to validate the page is real (not a block/captcha), and how to extract data.

### ExtractContext

The context object passed to `validate` and `extract` functions. Provides DOM querying (`ctx.$`, `ctx.$$`), JSON-LD access (`ctx.jsonLd`), media tracking (`ctx.media`), route params, and page metadata.

## Creating a Site Definition

```ts
import { Schema, defineSite } from "@wapi/framework";

export default defineSite({
  name: "Example",
  domain: "example.com",
  rateLimit: { maxConcurrent: 2, requestsPerSecond: 1 },
  resources: {
    article: {
      schema: Schema.Article,
      params: { id: { type: "string", required: true } },
      resolve: (p) => `/article/${p.id}`,
      ttl: "1h",
    },
  },
  pages: {
    "/article/:id": {
      provides: ["article"],
      examples: ["https://example.com/article/123"],
      validate: (ctx) => ctx.$("article")?.exists() === true,
      extract: async (ctx) => ({
        article: {
          title: ctx.$("h1")?.text() ?? "",
          body: ctx.$("article")?.text() ?? "",
          ...ctx.jsonLd("Article")[0],
        },
      }),
    },
  },
});
```

## Testing with Fixtures

```ts
import { createTestContext, matchPagePattern, testExtract } from "@wapi/framework";

// Match a URL to a page pattern
const match = matchPagePattern(site, "https://example.com/article/123");
// { pageKey: "/article/:id", params: { id: "123" } }

// Create a test context from HTML
const ctx = createTestContext({
  html: "<html>...</html>",
  url: "https://example.com/article/123",
  params: { id: "123" },
});

// Run validate + extract in one call
const result = await testExtract(site, "/article/:id", {
  html: fixture,
  url: "https://example.com/article/123",
  params: { id: "123" },
});
```

## Exports

| Export | Kind | Description |
|--------|------|-------------|
| `defineSite` | Function | Type-safe site definition builder |
| `createExtractContext` | Function | Create an ExtractContext from a PageDriver |
| `extractJsonLd` | Function | Parse JSON-LD blocks from a page |
| `filterJsonLdByType` | Function | Filter JSON-LD objects by @type |
| `parseRobotsTxt` | Function | Parse robots.txt and return a checker |
| `createTestContext` | Function | Create a test ExtractContext from HTML |
| `matchPagePattern` | Function | Match a URL to a site's page patterns |
| `matchPattern` | Function | Match a pathname against a route pattern |
| `testExtract` | Function | Run validate + extract against a fixture |
| `Schema` | Constant | Re-exported from @wapi/schemas |
| `SiteDefinition` | Type | Complete site definition |
| `PageDef` | Type | Page definition |
| `ExtractContext` | Type | Extraction context |
| `ResourceDef` | Type | Resource definition |
| `ParamDef` | Type | Parameter definition |
| `PaginateDef` | Type | Pagination descriptor |
| `MediaRef` | Type | Media URL reference |
| `RateLimitConfig` | Type | Rate limit configuration |
| `CrawlConfig` | Type | Crawl policy |
| `RobotsChecker` | Type | Robots.txt checker |
| `CreateContextOptions` | Type | Options for createExtractContext |
| `TestHarnessOptions` | Type | Options for createTestContext/testExtract |
