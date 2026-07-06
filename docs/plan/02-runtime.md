# 02 · @sitely/runtime

The runner — the engine that executes one extraction and returns a [`RunnerResult`](./00-contracts).
It's **driver-injected** (backend-agnostic) and it's the piece the v1 server reuses **verbatim**:
the same code that runs `sitely test` against a fixture runs a live request on the server. It owns
the `ExtractContext` that `validate`/`extract` receive.

## Purpose & dependencies

**Purpose.** Turn *(a materialized DOM + a page's `validate`/`extract`)* into a `RunnerResult`, with
per-field isolation, schema validation, and a timeout. And, one layer up, drive the full lifecycle
(`launch → prepare → materialize`) for the live path.

**Dependencies.** [`00 · contracts`](./00-contracts) (`SiteDefinition`, `PageDef`, `Binding`,
`RunnerResult`, errors, `validateExtraction`) and [`01 · @sitely/page`](./01-page)
(`PageDriver`, `RenderBackend`, `PageController`). It does **not** depend on the DSL
([`03`](./03-framework-dsl)) — it takes a `SiteDefinition` (data) plus a backend and runs it. That's
what lets both the test harness and the server sit *above* it.

## Public interface

### `ExtractContext` — what `validate`/`extract` see

Built by the runner from a materialized `PageDriver` + the request params. The read surface is the
driver's (sync); the rest is request metadata plus `lazy`.

```ts
interface ExtractContext<TParams extends Record<string, string> = Record<string, string>> {
    $(selector: string): PageElement | null;      // delegates to the driver
    $$(selector: string): PageElement[];
    jsonLd(type?: string): Record<string, unknown>[];   // parsed <script type="application/ld+json">, filtered by @type
    params: TParams;
    url: string;
    status: number;
    headers: Record<string, string>;
    canonical: string | null;
    lazy<T>(fn: () => T): () => T;                 // memoised shared computation across a page's bindings/fields
    // fetch(url, opts) and locale are v1.
}

function makeContext(driver: PageDriver, params: Record<string, string>): ExtractContext;
```

`jsonLd` is parsed once per context and memoised; `lazy` memoises an author's producer (parse
JSON-LD once, read from many fields) and is shared across every binding on the page.

### The two entry points

```ts
interface RunPolicy { extractTimeoutMs?: number }   // default 30_000

// CORE — given an already-materialized DOM, run one page's extraction. No lifecycle, no `prepare`.
// This is what the test harness calls: a fixture is a post-`prepare` snapshot, so it wraps the
// fixture HTML in a CheerioDriver and calls this directly.
function runExtractionOnDriver(
    driver: PageDriver, page: PageDef, params: Record<string, string>, policy?: RunPolicy,
): Promise<RunnerResult>;

// FULL LIFECYCLE — fetch/render → prepare → materialize → runExtractionOnDriver → dispose.
// This is what `sitely snapshot`, live checks, and the v1 server call.
function runExtraction(opts: {
    backend: RenderBackend; site: SiteDefinition; page: string; params: Record<string, string>; policy?: RunPolicy;
}): Promise<RunnerResult>;
```

The split is deliberate: **`runExtractionOnDriver` is the fixture/test path** (a fixture already *is*
the settled, post-interaction DOM, so re-running `prepare` would be wrong — and impossible on a
static driver). **`runExtraction` is the live path.** Both share the core, so the harness and the
server exercise identical extraction logic.

## The execution algorithm

`runExtractionOnDriver`:

1. `ctx = makeContext(driver, params)`.
2. **Validate.** Call `page.validate(ctx)`.
   - throws `ResponseRejection(r)` → `{ kind: "rejected", reason: r }`.
   - returns `false` → `{ kind: "rejected", reason: "wrong-page" }`.
   - returns `true` → continue.
3. **Extract, per binding**, under `extractTimeoutMs`. For each `[localName, binding]` in
   `page.extract`:
   - Run `binding.extract(ctx)` → `FieldFns<T>` (`one`) or `FieldFns<T>[]` (`many`).
     - the extract *body* throws `ResponseRejection` → `rejected`; throws `ExtractionError` →
       `{ kind: "extraction-error", error, field: localName }`; any other throw / timeout →
       `{ kind: "error", message }`.
   - **Resolve field functions** (per item for `many`): call each `() => value`, awaiting Promises.
     - a field throw is **isolated**: recorded as a field diagnostic (`{ output, index?, field, message }`),
       the field is treated as **absent**, siblings continue. (`MissingDataError` from a field is the
       author's explicit "this field is absent" signal.)
   - **Schema-validate** the resolved item(s) against `binding.resource.schema` via `validateExtraction`
     — `one` validates the object, `many` validates each element. Failures collect into
     `ValidationIssue[]`.
4. If any binding produced validation issues → `{ kind: "validation-error", issues }`.
5. Otherwise `{ kind: "ok", data }` where `data[localName]` is the resolved item (`one`) or array
   (`many`). The `ok` result carries the isolated field diagnostics (absent-but-schema-tolerated
   fields) for `sitely dev` and v1 drift telemetry.

`runExtraction` wraps this: `const s = await backend.launch(url); try { await page.prepare?.(s.page);
const d = await s.materialize(); return runExtractionOnDriver(d, page, params, policy) } finally {
await s.dispose() }` — building `url` from `hostname + page.path.toUrl(params)`.

## Invariants

1. **Extraction is synchronous; the lifecycle is async.** `validate`/`extract`/field-functions run
   against a frozen `PageDriver`; only `launch`/`prepare`/`materialize`/`dispose` await.
2. **`materialize()` is called exactly once per run**, before any `validate`/`extract`.
3. **Per-field isolation.** One field function throwing never aborts the others or the run; it yields
   an absent field + a diagnostic. Schema validation decides whether the absence is permitted.
4. **Validate precedes extract.** A `false`/rejected `validate` skips extraction entirely.
5. **`dispose()` always runs** (`try/finally`), even on throw/timeout — no leaked browser pages.
6. **Backend-agnostic.** The core takes a `PageDriver`; identical settled DOM → identical
   `RunnerResult`, whether that driver came from Cheerio or Playwright.
7. **Same code, two callers.** The test harness ([04](./04-framework-test)) and the v1 server both
   call these functions; there is no server-only or test-only extraction path.

## Behaviour & edge cases

- **`prepare` throws / `waitForSelector` times out** → `runExtraction` surfaces it as `error` (or
  `rejected` if the author threw a `ResponseRejection`); the DOM is never materialized; `dispose`
  runs.
- **`prepare` present but backend is static** → `runExtraction` returns `error`
  (`"prepare requires a dynamic backend"`) rather than silently extracting a half-built DOM.
- **`extractTimeoutMs` fires** mid-extract → `{ kind: "error", message: "extract timeout" }`. A hung
  selector can't wedge the harness or the server.
- **A `many` binding yields `[]`** → valid; `data[localName] = []`, `ok`.
- **A resolved field is `undefined`** (absent) → permitted iff the schema allows it (a
  `presence()`-annotated optional); otherwise it surfaces as a `validation-error`.
- **`validateExtraction` itself is sync** — extract is on the hot path; async validators are rejected
  at the boundary (see [00](./00-contracts)).
- **Redirect / non-200 during `runExtraction`** → the driver carries the final `url`/`status`;
  `validate` typically checks `ctx.status` and returns `false` (→ `rejected: "wrong-page"`) for a
  non-200 it doesn't handle.

## Acceptance criteria

- **Harness parity.** `runExtractionOnDriver(new CheerioDriver({ html: fixture, url }), page, params)`
  produces the `RunnerResult` the [test harness](./04-framework-test) asserts against
  `expected.json` — for `ok`, `rejected` (errorCase fixtures), and `validation-error` cases.
- **Backend parity.** For the same settled HTML, `runExtractionOnDriver` with a `CheerioDriver` and
  with a `PlaywrightDriver` return identical `RunnerResult`s — the runtime half of the
  interface-neutrality proof from [01](./01-page).
- **Per-field isolation.** A fixture where one field function throws yields `ok` (or
  `validation-error` if that field was required) with the other fields resolved and a diagnostic for
  the thrower.
- **Rejection mapping.** `validate → false`, a thrown `ResponseRejection("captcha")`, and an extract
  timeout map to `rejected: "wrong-page"`, `rejected: "captcha"`, and `error` respectively.
- **Lifecycle discipline.** A `prepare` that throws still calls `dispose`; a static backend refuses a
  `prepare` page.

## Open questions

- **Where `validateExtraction` lives.** To keep `@sitely/runtime` free of the DSL, the
  JSON-Schema validator (Ajv/TypeBox-compiler wrapper) is a small standalone module both
  `@sitely/runtime` and `@sitely/framework` import — not part of the DSL package. Confirm the module
  boundary when wiring the packages.
- **`extractTimeoutMs` default** (30 s pencilled in) — revisit against the dynamic path, where
  `prepare` + render can legitimately take longer; the timeout wraps *extract*, not the lifecycle, so
  it may want a separate `prepareTimeoutMs`.
- **Field diagnostics shape** on the `ok` result — enough for `sitely dev`'s per-field diff now; the
  v1 drift telemetry may want richer per-field structure.
