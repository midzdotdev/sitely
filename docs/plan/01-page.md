# 01 · @sitely/page

The DOM implementation. The **sync read surface** (`PageElement` / `PageDriver`) and the **interaction
surface** (`PageController`) are *declared* in [`00`](./00-contracts); this package **implements**
them and owns the **async render lifecycle** (`RenderBackend` → `launch` → `prepare` → `materialize`)
that produces a driver. It ships two drivers — Cheerio (static) and Playwright/CDP (dynamic) — whose
only job, beyond working, is to *prove the read surface is backend-neutral*: a scraper's `extract`
must run byte-identically on either.

## Purpose & dependencies

**Purpose.** Give `extract`/`validate` one synchronous way to read a settled DOM, regardless of how
that DOM was produced. The async, backend-specific work (fetch, browser render, interaction) lives
behind `RenderBackend`; the moment `extract` runs, it sees a frozen, synchronously-queryable
snapshot.

**Dependencies.** [`00 · contracts`](./00-contracts) — the `PageElement` / `PageDriver` /
`PageController` interfaces this package implements. Nothing else structural; it's near a leaf.

**Why two drivers in v0.** An interface with one implementation is never proven abstract. Cheerio
(sync HTML parse) and Playwright/CDP (async browser render, then snapshot) are maximally different
backends; making both satisfy one sync `PageDriver` is the test that the seam holds.

## Public interface

The read/interaction interfaces (`PageElement`, `PageDriver`, `PageController`) live in
[`00`](./00-contracts). This package adds the lifecycle, the null-object plumbing, and the drivers.

### `NULL_ELEMENT`

A singleton `PageElement` returning safe defaults for every method (`""`, `null`, `[]`).
Plumbing for drivers that compose elements internally — **not** the public idiom. Extract code uses
`ctx.$("h1")?.text() ?? ""`; `$()` returns `null` for no-match, not `NULL_ELEMENT`. (There is no
public `exists()` — no publicly obtainable element could ever return `false`, since `$`/`$$` return
`null`/`[]` for a miss; the `null` check *is* the existence check.)

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
    userAgent?: string;                          // threaded from snapshot/live callers via runExtraction's `launch` opt; needed for auth-walled sites
    headers?: Record<string, string>;
}
```

The runner ([02](./02-runtime)) drives it:

```ts
const session = await backend.launch(url);
await pageDef.prepare?.(session.page);           // dynamic interaction; the static arm has no `prepare`
const driver = await session.materialize();      // frozen snapshot from here on
// makeContext(driver, params) → validate(ctx) → extract(ctx)   ← all sync
await session.dispose();
```

On a **static** backend, `session.page` methods throw `UnsupportedInteractionError` (declared in
[00's error taxonomy](./00-contracts), `kind: "unsupported-interaction"`). A page can only declare
`prepare` in its `render: "dynamic"` arm ([00](./00-contracts)), so a static page never interacts;
the throw is belt-and-suspenders for a raw-data caller that wires a static backend to a dynamic page.

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
   empty.** Distinguish a **missing** element (`$(...) === null`) from a **present-but-empty** one
   (`.text() === ""`); the `null` check is the existence check.
6. **Interaction requires a dynamic backend.** A `render: "dynamic"` page's `prepare` runs against a
   dynamic backend; the static arm has no `prepare`, and any `PageController` call on a static session
   throws.
7. **One read contract, N backends.** Every `RenderBackend` produces a `PageDriver` that behaves
   identically for identical settled DOM — enforced by the conformance suite.

## Behaviour & edge cases

- **Selector matches nothing** → `$` returns `null`, `$$` returns `[]`.
- **Selector fails to parse** (`$("[[bad")`) → throws synchronously. A programmer error; in `extract`
  it's caught by per-field isolation (see [00](./00-contracts)), so on an optional field it degrades
  to an absent field + a diagnostic rather than a crash.
- **Malformed / truncated HTML** → best-effort parse (Cheerio's forgiving fix-up). Don't assume
  "parsed" means "complete"; check `status` / `headers` if it matters.
- **Not HTML** (JSON, plain text) → wrapped in an implicit `<html><body>`; `$("body")?.text()`
  returns the raw content. No throw.
- **`prepare` throws or a `waitForSelector` times out** → the session surfaces the failure; the
  runner turns it into a `RunnerResult` (`error`, or a `rejected` reason if the author threw a
  `ResponseRejection`). The DOM is not materialized.
- **Redirect during `launch`** → `driver.url` reflects the final URL; `driver.status` is the **final
  response's** status (a followed `301 → 200` reads as `200`), which is what every `validate` status
  check depends on.
- **Oversized DOM** → a size cap protects the process. The cap and its enforcement are a v1 server
  concern; v0 notes it but doesn't gate on it.
- **`dispose()` not called** (crash mid-extract) → for the dynamic backend this leaks a browser
  page; the runner wraps extraction in `try/finally` to always dispose.

## Acceptance criteria

- **Driver conformance suite (the interface proof).** One suite of DOM cases — nesting, missing
  attrs, empty elements, `$` vs `$$`, `data`, `classes`, traversal — runs against **both**
  `CheerioDriver` and `PlaywrightDriver` on the same HTML and produces identical results. This is
  the criterion that says the seam holds; adding JSDOM later means running the same suite.
- **`data()` is backend-neutral.** `data("user-id")` reads the attribute `data-user-id` verbatim on
  both drivers — no camelCase mapping, no numeric/JSON coercion (Cheerio's `.data()` does both, so the
  driver must not lean on it).
- **Interaction path (deterministic, CI).** Against the [controlled dynamic test page](./index#test-inputs)
  (accordion + scroll-load): `launch → prepare (click to expand, `scrollToBottom`, `waitForSelector`)
  → materialize` yields a driver where the previously-absent content is now queryable. Proves the
  `prepare` phase in CI without a live/auth site.
- **Static rejects interaction.** A `PageController` call on a `StaticBackend` session throws
  `UnsupportedInteractionError`.
- **Edge-case table.** `.text()`/`.attr()` behave per the invariants for present/empty/absent;
  `$`/`$$` agree on the empty case.

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
