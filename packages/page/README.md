# @wapi/page

DOM abstraction layer for reading web pages.

## Overview

`@wapi/page` provides a uniform read-only API for querying HTML regardless of the underlying parsing engine. The core interfaces — `PageElement` and `PageDriver` — are implemented by `CheerioDriver` for fast static HTML parsing in the MVP, with future drivers (JSDOM, Playwright) following the same interface.

## Exports

| Export | Kind | Description |
|--------|------|-------------|
| `PageElement` | Interface | Wrapper around a single DOM element |
| `PageDriver` | Interface | Read-only driver for a fetched page |
| `CheerioDriver` | Class | Cheerio-backed PageDriver |
| `CheerioDriverOptions` | Interface | Constructor options for CheerioDriver |
| `NULL_ELEMENT` | Constant | Null-object PageElement for safe chaining |

## Usage

```ts
import { CheerioDriver } from "@wapi/page";

const driver = new CheerioDriver({
  rawHtml: "<html><body><h1>Hello</h1><ul><li>A</li><li>B</li></ul></body></html>",
  url: "https://example.com",
});

// Query a single element
const title = driver.$("h1")?.text(); // "Hello"

// Query multiple elements
const items = driver.$$("li").map(el => el.text()); // ["A", "B"]

// Safe chaining with NULL_ELEMENT
import { NULL_ELEMENT } from "@wapi/page";
const missing = driver.$(".nonexistent") ?? NULL_ELEMENT;
console.log(missing.text()); // "" (no error)
```
