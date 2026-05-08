# What is sitely?

sitely is a web extraction service that converts websites into typed, structured data via a REST API. It combines **site-specific extractors** — community-driven scraper definitions that know how to parse a given website — with a **generic fallback** that extracts JSON-LD, OpenGraph, Twitter Cards, and meta tags from any URL.

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
| [`@sitely/page`](/api/@sitely/page/) | DOM abstraction layer (PageElement, PageDriver, CheerioDriver) |
| [`@sitely/schemas`](/api/@sitely/schemas/) | Hand-written schema.org TypeScript types |
| [`@sitely/framework`](/api/@sitely/framework/) | Site definition DSL, extraction context, test utilities |
| `@sitely/server` | HTTP API server (Hono, Postgres, Redis) |

### @sitely/page

Provides a uniform read-only API for querying HTML regardless of the underlying parsing engine. The `PageElement` and `PageDriver` interfaces are implemented by `CheerioDriver` for fast static HTML parsing, with future drivers (JSDOM, Playwright) following the same interface.

### @sitely/schemas

Hand-written TypeScript interfaces for common schema.org entities: `Article`, `Person`, `Organization`, `Product`, `Review`, `VideoObject`, `WebPage`, `ItemList`, and more. All fields are optional since extracted data is often incomplete.

### @sitely/framework

The core DSL for defining site extractors. Provides `defineSite()` to declare URL patterns, validation rules, and extraction logic. Also includes JSON-LD parsing, robots.txt support, and test utilities for running extractors against HTML fixtures.

### @sitely/server

The HTTP runtime that wires everything together. Handles authentication, caching, rate limiting, robots.txt enforcement, request coalescing, usage tracking, and serves the REST API via Hono.
