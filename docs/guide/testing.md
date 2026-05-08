# Testing with Fixtures

Site definitions are tested against saved HTML fixtures so tests run without network calls. The framework provides utilities to match URLs, create test contexts, and run extraction in a single call.

## Setup

Each site directory has a `fixtures/` folder with saved HTML files and a test file:

```
sites/
  en.wikipedia.org/
    fixtures/
      wiki-typescript.html
    index.ts
    index.test.ts
    package.json
```

## Matching URL Patterns

Use `matchPagePattern` to verify that a URL resolves to the correct page definition:

```ts
import { matchPagePattern } from "@sitely/framework";
import site from "./index.js";

const match = matchPagePattern(
  site,
  "https://en.wikipedia.org/wiki/TypeScript"
);
// { pageKey: "/wiki/:title", params: { title: "TypeScript" } }
```

## Creating a Test Context

`createTestContext` builds an [`ExtractContext`](/api/@sitely/framework/interfaces/ExtractContext) from raw HTML. Use it when you need to test `validate` or `extract` functions individually:

```ts
import { createTestContext } from "@sitely/framework";

const ctx = createTestContext({
  html: '<html><body><h1>Hello</h1></body></html>',
  url: "https://example.com/page",
  params: { id: "123" },
});

const title = ctx.$("h1")?.text(); // "Hello"
```

## Running Full Extraction

`testExtract` combines validation and extraction in one call. It runs `validate`, asserts it passes, then runs `extract` and returns the result:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { matchPagePattern, testExtract } from "@sitely/framework";
import site from "./index.js";

const fixture = readFileSync("./fixtures/wiki-typescript.html", "utf-8");

describe("en.wikipedia.org", () => {
  it("matches the article page pattern", () => {
    const match = matchPagePattern(
      site,
      "https://en.wikipedia.org/wiki/TypeScript"
    );
    expect(match?.pageKey).toBe("/wiki/:title");
    expect(match?.params.title).toBe("TypeScript");
  });

  it("extracts article data", async () => {
    const result = await testExtract(site, "/wiki/:title", {
      html: fixture,
      url: "https://en.wikipedia.org/wiki/TypeScript",
      params: { title: "TypeScript" },
    });
    expect(result.article).toBeDefined();
    expect(result.article.title).toBeTruthy();
  });
});
```

`testExtract` throws if `validate` returns `false`, so you don't need a separate validation assertion.

## Running Tests

```bash
# Run all tests
pnpm test

# Run tests for a specific site
pnpm --filter en.wikipedia.org test

# Run in watch mode
pnpm --filter en.wikipedia.org exec vitest --watch
```

## Tips

- **Save real HTML** — fetch a page with `curl` and save it to `fixtures/`. This captures the exact markup your extractor will process.
- **Test edge cases** — save fixtures for blocked pages, empty results, or unusual markup to verify your `validate` function rejects them.
- **Keep fixtures up to date** — if a site redesigns, save a new fixture and update your extractor accordingly.
