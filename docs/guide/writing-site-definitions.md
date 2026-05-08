# Writing Site Definitions

Site definitions live in `sites/<domain>/index.ts`. Each definition describes a website's URL patterns, validation rules, and extraction logic using the `defineSite()` DSL.

## Basic Structure

```ts
import { Schema, defineSite } from "@wapi/framework";

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

## Resources

A resource describes a type of data that can be extracted from the site. Each resource has:

- **`schema`** — the schema.org type this resource produces (e.g. `Schema.Article`, `Schema.Product`)
- **`params`** — parameters needed to identify the resource (e.g. `{ id: { type: "string", required: true } }`)
- **`resolve`** — function that maps params to a URL path
- **`ttl`** — how long cached results are valid (e.g. `"1h"`, `"30m"`, `"1d"`)

```ts
resources: {
  article: {
    schema: Schema.Article,
    params: { title: { type: "string", required: true } },
    resolve: (p) => `/wiki/${p.title}`,
    ttl: "1h",
  },
},
```

## Pages

A page definition is tied to a URL pattern and declares what resources it can provide.

### URL Patterns

URL patterns use `:param` syntax for dynamic segments:

- `/article/:id` — matches `/article/123`, `/article/hello`
- `/wiki/:title` — matches `/wiki/TypeScript`
- `/user/:name/posts` — matches `/user/alice/posts`

### Validation

The `validate` function checks whether the fetched page is real (not a 404 page, captcha, or block page). It receives an [`ExtractContext`](/api/@wapi/framework/interfaces/ExtractContext) and returns a boolean:

```ts
validate: (ctx) => ctx.$("article")?.exists() === true,
```

### Extraction

The `extract` function receives the same context and returns an object mapping resource names to their extracted data:

```ts
extract: async (ctx) => ({
  article: {
    title: ctx.$("h1")?.text() ?? "",
    body: ctx.$("article")?.text() ?? "",
    ...ctx.jsonLd("Article")[0],
  },
}),
```

## ExtractContext

The context passed to `validate` and `extract` provides:

| Method | Description |
|--------|-------------|
| `ctx.$(selector)` | Query a single element (returns `PageElement \| null`) |
| `ctx.$$(selector)` | Query all matching elements (returns `PageElement[]`) |
| `ctx.jsonLd(type?)` | Get parsed JSON-LD objects, optionally filtered by `@type` |
| `ctx.media(url, meta?)` | Track a media URL for the response |
| `ctx.params` | Route parameters extracted from the URL |
| `ctx.url` | The full URL of the page |
| `ctx.title` | The page `<title>` text |
| `ctx.canonical` | The canonical URL, if present |

### PageElement

Each element returned by `$` and `$$` has:

| Method | Description |
|--------|-------------|
| `.text()` | Inner text content |
| `.html()` | Inner HTML |
| `.attr(name)` | Attribute value |
| `.exists()` | Whether the element was found |
| `.data(key)` | `data-*` attribute value |
| `.$$(selector)` | Query descendants |

Use `?? ""` for safe defaults since `$()` can return `null`:

```ts
const title = ctx.$("h1")?.text() ?? "";
```

### JSON-LD

Many sites embed structured data as JSON-LD in `<script type="application/ld+json">` tags. The `ctx.jsonLd()` method parses these blocks:

```ts
// Get all JSON-LD objects
const all = ctx.jsonLd();

// Filter by @type
const articles = ctx.jsonLd("Article");

// Spread into your result
extract: async (ctx) => ({
  article: {
    title: ctx.$("h1")?.text() ?? "",
    ...ctx.jsonLd("Article")[0],
  },
}),
```

## Rate Limiting

Each site defines its own rate limits to be a good citizen:

```ts
rateLimit: {
  maxConcurrent: 2,    // Max simultaneous requests
  requestsPerSecond: 1, // Requests per second limit
},
```

## URL Normalization

The optional `normalize` function on a page definition standardizes URLs before extraction:

```ts
pages: {
  "/item": {
    normalize: (url) => {
      url.searchParams.delete("ref");
      return url;
    },
    // ...
  },
},
```

## Pagination

Resources that return lists can declare pagination:

```ts
resources: {
  frontPage: {
    schema: Schema.ItemList,
    params: { page: { type: "number" } },
    resolve: (p) => (p.page ? `/?p=${p.page}` : "/"),
    paginate: { param: "page", style: "offset" },
    ttl: "5m",
  },
},
```
