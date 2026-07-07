# 01 · @sitely/page

The DOM abstraction. It defines the **sync read surface** (`PageDriver` / `PageElement`) that
extract code queries, the **async render lifecycle** (`RenderBackend` → `launch` → `prepare` →
`materialize`) that produces a driver, and the **interaction surface** (`PageController`) authors
drive in `prepare`. It ships two drivers — Cheerio (static) and Playwright/CDP (dynamic) — whose
only job, beyond working, is to *prove the read surface is backend-neutral*: a scraper's `extract`
must run byte-identically on either.

## Purpose & dependencies

**Purpose.** Give `extract`/`validate` one synchronous way to read a settled DOM, regardless of how
that DOM was produced. The async, backend-specific work (fetch, browser render, interaction) lives
behind `RenderBackend`; the moment `extract` runs, it sees a frozen, synchronously-queryable
snapshot.

**Dependencies.** [`00 · contracts`](./00-contracts) for nothing structural — this package is close
to a leaf. `ExtractContext` ([03](./03-framework-dsl)) *wraps* a `PageDriver` and exposes `ctx.$` /
`ctx.$$`; extract code never touches a driver directly.

**Why two drivers in v0.** An interface with one implementation is never proven abstract. Cheerio
(sync HTML parse) and Playwright/CDP (async browser render, then snapshot) are maximally different
backends; making both satisfy one sync `PageDriver` is the test that the seam holds.

## Public interface

### `PageElement` — a read-only node view (sync)

```ts
interface PageElement {
    $(selector: string): PageElement | null;   // first matching descendant, or null
    $$(selector: string): PageElement[];        // all matching descendants (real array — use .map/.filter)
    text(): string;                             // trimmed text content; "" when empty
    html(): string;                             // inner HTML
    attr(name: string): string | null;          // null when absent; "" when present-but-empty
    data(key: string): string | null;           // data-<key>, or null
    classes(): string[];
    exists(): boolean;
    parent(): PageElement | null;
    children(): PageElement[];
    next(): PageElement | null;
    prev(): PageElement | null;
}
```

Read-only by design — no `.append`, no `.attr(name, value)`. Extract reads the DOM; it never
mutates it, so a driver may back results with frozen or shared nodes. Descendant queries are
`$` / `$$` (there is no `.find()`).

### `PageDriver` — the document root (sync)

```ts
interface PageDriver {
    $(selector: string): PageElement | null;
    $$(selector: string): PageElement[];
    title(): string;
    html(): string;                              // full document HTML
    readonly url: string;                        // final URL after redirects / render
    readonly status: number;
    readonly headers: Record<string, string>;
}
```

The driver carries response metadata (`url`, `status`, `headers`) because extract sometimes needs
it — relative-URL resolution, `Content-Language` branching, non-200 detection. All traversal starts
at the driver and descends through `PageElement`; there is no parallel document object.

### `NULL_ELEMENT`

A singleton `PageElement` returning safe defaults for every method (`""`, `null`, `[]`, `false`).
Plumbing for drivers that compose elements internally — **not** the public idiom. Extract code uses
`ctx.$("h1")?.text() ?? ""`; `$()` returns `null` for no-match, not `NULL_ELEMENT`.

### The render lifecycle

A `RenderBackend` opens a page and, after any interaction, materializes it into a sync driver. The
split is the whole design: **async up to `materialize()`, sync after.**

```ts
interface RenderBackend {
    readonly kind: "static" | "dynamic";
    launch(url: string, opts?: LaunchOptions): Promise<RenderSession>;
}

interface RenderSession {
    readonly page: PageController;               // interaction surface; static throws if used (see below)
    materialize(): Promise<PageDriver>;          // settle, snapshot → a frozen, sync-queryable driver
    dispose(): Promise<void>;                    // release (close browser page / free the parse)
}

interface LaunchOptions {
    timeoutMs?: number;
    userAgent?: string;
    headers?: Record<string, string>;
}
```

The runner ([02](./02-runtime)) drives it:

```ts
const session = await backend.launch(url);
await pageDef.prepare?.(session.page);           // dynamic interaction; skipped for static pages
const driver = await session.materialize();      // frozen snapshot from here on
// makeContext(driver, params) → validate(ctx) → extract(ctx)   ← all sync
await session.dispose();
```

### `PageController` — the interaction surface for `prepare`

Async, browser-only. Authors use it to drive interaction-gated content into the DOM *before* the
snapshot (expand an accordion, scroll a lazy section into view).

```ts
interface PageController {
    click(selector: string): Promise<void>;
    scrollTo(selector: string): Promise<void>;
    scrollToBottom(): Promise<void>;
    waitForSelector(selector: string, opts?: { timeoutMs?: number; state?: "attached" | "visible" }): Promise<void>;
    waitForTimeout(ms: number): Promise<void>;
    evaluate<T>(fn: (() => T) | string): Promise<T>;   // escape hatch: run JS in the page
}
```

On a **static** backend, `session.page` methods throw `UnsupportedInteractionError`. A page that
declares `prepare` therefore requires a dynamic backend; the runner refuses to run such a page on a
static backend (it doesn't silently skip the interaction and extract an incomplete DOM).

### `CheerioDriver` — the static default

```ts
class CheerioDriver implements PageDriver {
    constructor(opts: { html: string; url: string; status?: number; headers?: Record<string, string> });
    // …implements PageDriver
}
```

Parses static HTML — what a plain fetch returns. Constructing it directly from a string is the most
common site (the [test harness](./04-framework-test) wraps a fixture's HTML), so `status` defaults
to `200`, `headers` to `{}`.

### `StaticBackend` — the static render backend

```ts
class StaticBackend implements RenderBackend {
    readonly kind = "static";
    launch(url: string, opts?: LaunchOptions): Promise<RenderSession>;   // fetch(url) → wrap the body in a CheerioDriver
    // session.materialize() returns that driver immediately (the HTML is already in hand);
    // session.page throws UnsupportedInteractionError (no interaction on a static backend).
}
```

`StaticBackend` wraps `fetch → new CheerioDriver(...)` for `snapshot` and future live paths;
`materialize()` is immediate. Fixture tests skip it — they wrap committed HTML in a `CheerioDriver`
and call `runExtractionOnDriver` directly.

### `PlaywrightDriver` / `PlaywrightBackend` — the dynamic proof

```ts
class PlaywrightBackend implements RenderBackend {
    readonly kind = "dynamic";
    launch(url: string, opts?: LaunchOptions): Promise<RenderSession>;   // open browser page, navigate
    // session.page drives Playwright/CDP; session.materialize() snapshots the settled DOM over CDP
    // into a PlaywrightDriver — a PageDriver whose $/$$ query that frozen snapshot synchronously.
}
```

`materialize()` settles the page, then captures the live DOM over CDP into a
`PlaywrightDriver`. The read surface is identical to Cheerio's; the difference is provenance (a
rendered, interacted DOM vs a parsed static string). The exact capture mechanism — settled
`outerHTML` re-parsed, vs a flattened CDP node tree — is an implementation choice (see Open
questions); the contract is only that the result is a conformant `PageDriver`.

## Invariants

1. **The read surface is synchronous.** `$`, `$$`, `.text()`, `.attr()`, … never return Promises.
   Async work is confined to `RenderBackend` (`launch`/`prepare`/`materialize`/`dispose`).
2. **`materialize()` yields a frozen snapshot.** Queries do not reach back to a live browser; the
   DOM is fixed at materialize time. (Interaction happens earlier, in `prepare`.)
3. **`$` and `$$` agree.** `driver.$(s) === null` ⟺ `driver.$$(s).length === 0`. A match returns the
   first (`$`) or all (`$$`).
4. **`PageElement` is read-only.** No mutation methods exist.
5. **`.text()` is `""` for an empty element; `.attr(x)` is `null` when absent, `""` when present and
   empty.** Distinguish "missing element" from "present but empty" via `.exists()`.
6. **Interaction requires a dynamic backend.** Any `PageController` call on a static session throws;
   a `prepare`-declaring page can't run statically.
7. **One read contract, N backends.** Every `RenderBackend` produces a `PageDriver` that behaves
   identically for identical settled DOM — enforced by the conformance suite.

## Behaviour & edge cases

- **Selector matches nothing** → `$` returns `null`, `$$` returns `[]`.
- **Selector fails to parse** (`$("[[bad")`) → throws synchronously. A programmer error, not a
  missing-element case.
- **Malformed / truncated HTML** → best-effort parse (Cheerio's forgiving fix-up). Don't assume
  "parsed" means "complete"; check `status` / `headers` if it matters.
- **Not HTML** (JSON, plain text) → wrapped in an implicit `<html><body>`; `$("body")?.text()`
  returns the raw content. No throw.
- **`prepare` throws or a `waitForSelector` times out** → the session surfaces the failure; the
  runner turns it into a `RunnerResult` (`error`, or a `rejected` reason if the author threw a
  `ResponseRejection`). The DOM is not materialized.
- **Redirect during `launch`** → `driver.url` reflects the final URL; the driver carries the
  redirect's `status`.
- **Oversized DOM** → a size cap protects the process. The cap and its enforcement are a v1 server
  concern; v0 notes it but doesn't gate on it.
- **`dispose()` not called** (crash mid-extract) → for the dynamic backend this leaks a browser
  page; the runner wraps extraction in `try/finally` to always dispose.

## Acceptance criteria

- **Driver conformance suite (the interface proof).** One suite of DOM cases — nesting, missing
  attrs, empty elements, `$` vs `$$`, `data`, `classes`, traversal — runs against **both**
  `CheerioDriver` and `PlaywrightDriver` on the same HTML and produces identical results. This is
  the criterion that says the seam holds; adding JSDOM later means running the same suite.
- **Interaction path (deterministic, CI).** Against the [controlled dynamic test page](./index#test-inputs)
  (accordion + scroll-load): `launch → prepare (click to expand, `scrollToBottom`, `waitForSelector`)
  → materialize` yields a driver where the previously-absent content is now queryable. Proves the
  `prepare` phase in CI without a live/auth site.
- **Static rejects interaction.** A `PageController` call on a `StaticBackend` session throws
  `UnsupportedInteractionError`; the runner refuses a `prepare`-declaring page on a static backend.
- **Edge-case table.** `.text()`/`.attr()`/`.exists()` behave per the invariants for
  present/empty/absent; `$`/`$$` agree on the empty case.

## Open questions

- **JSDOM driver (v1).** A third backend (spec-compliant static parse + a real W3C DOM) is a
  drop-in that also stresses the *real-DOM-vs-façade* dimension of the interface. Deferred; the
  contract must stay JSDOM-satisfiable.
- **`PlaywrightDriver` capture mechanism.** Settled `outerHTML` re-parsed (simplest; shares the
  Cheerio parse) vs a flattened CDP node tree (higher fidelity, avoids re-parse). Decide during
  implementation; no contract impact.
- **Live-per-query CDP knob (v1).** If snapshot-then-parse is too slow on huge dynamic pages, a
  selective per-selector CDP read can sit *under* the sync interface — without going async.
- **Multi-snapshot `prepare` (v1).** Mutually-exclusive content — tabs that *replace* each other,
  per-item modals, carousels with only the current slide in the DOM — can't be captured in one
  settled snapshot. The growth path is `page.capture(name)` inside `prepare` (snapshot at each
  interaction state) + `ctx.snapshot(name)` in extract, which keeps extract **sync** (the
  interweaving lives in `prepare`, not in async reads). Not built in v0; `PageController` /
  `RenderSession` must stay shaped so it can be added without breaking. Only a case where an action
  depends on the *typed extraction result* mid-flow would force truly-async reads — not expected for
  read-only scraping.
