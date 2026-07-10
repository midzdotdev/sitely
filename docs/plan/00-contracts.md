# 00 · Contracts (v0)

The shared type surface every v0 component imports — the interfaces the read surface, the runner, and
the DSL all speak. Types only, plus the minimal error classes (they carry a `kind` discriminator every
layer matches on). If two components disagree about a shape, this spec is right.

Scoped to **v0**. The manifest, the seven-status wire envelope, the build subsystem, versioning,
and multi-origin sites are **v1** — they belong to the server/build, which v0 doesn't have.

## Purpose & dependencies

Define the contracts that cross v0 boundaries:

1. **`SiteDefinition`** — a site assembled from standalone resource + page symbols.
2. **Resources** — standalone *item* shapes (the interop unit); pages produce one or many.
3. **The read surface + context** — `PageElement`/`PageDriver` (how extract reads a settled DOM),
   `PageController` (how `prepare` interacts), and `ExtractContext` (what `validate`/`extract` see).
4. **The JSON-Schema boundary** — the required schema representation + annotation keywords.
5. **`RunnerResult`** + the **error taxonomy** — what `@sitely/runtime` returns.

This spec **declares** every cross-boundary interface; the others **implement** them —
[`@sitely/page`](./01-page) implements the drivers/backends, [the runtime](./02-runtime) constructs
`ExtractContext` (via `makeContext`) and runs the extraction, the [DSL](./03-framework-dsl) provides
the authoring factories. Because the shared interfaces all live here, the package graph is a clean
DAG (`contracts ← page ← runtime ← framework`) with no back-edges — this is the true dependency root.

## Public interface

### Resources — standalone item symbols

A resource is a **named item shape** — never an array. It's the unit a consumer queries by, and the
seam the v1 interface catalogue plugs into. A resource carries no extract logic itself — it's a pure
`{ name, schema, key? }` symbol. The per-page extract (and its param typing) is attached at the page
via a builder (see Pages).

```ts
interface Resource<Name extends string = string, T = unknown> {
    readonly name: Name;
    readonly schema: JsonSchema;               // an ITEM schema — never T[]
    readonly key?: keyof T & string;           // identity field, for addressing a single item (v1)
}

// FieldFns — every field has a SYNCHRONOUS resolver, present even for optional fields (`-?` strips
// optionality so nothing can be omitted). Even constants are functions — for per-field error
// isolation and drift telemetry. Sync by design: extraction reads a settled snapshot.
type FieldFns<T> = { [K in keyof T]-?: () => T[K] };

// A Binding is a resource + cardinality + its per-page extract. Produced by the page builder's
// p.one(resource, fn) / p.many(resource, fn); it appears as a value in the page's extract map.
interface Binding<Name extends string = string, T = unknown, C extends "one" | "many" = "one" | "many"> {
    readonly resource: Resource<Name, T>;
    readonly cardinality: C;
    readonly extract: (ctx: ExtractContext) => (C extends "one" ? FieldFns<T> : FieldFns<T>[]);
}
```

There is one kind of resource — extracted from a page's DOM. (No "derived" resources: pure data
transforms are helpers called inside `extract`; enrichment, sub-fetched data, and interface
conformance are distinct v1 concepts.)

### The read surface — `PageElement` / `PageDriver` (sync)

Declared here, implemented by [`@sitely/page`](./01-page). The one synchronous way `extract`/`validate`
read a settled DOM, regardless of how it was produced.

```ts
interface PageElement {
    $(selector: string): PageElement | null;   // first matching descendant, or null
    $$(selector: string): PageElement[];        // all matching descendants (real array — use .map/.filter)
    text(): string;                             // trimmed text content; "" when empty
    html(): string;                             // inner HTML
    attr(name: string): string | null;          // null when absent; "" when present-but-empty
    data(key: string): string | null;           // reads attribute data-<key> verbatim; no case-mapping, no coercion
    classes(): string[];
    exists(): boolean;
    parent(): PageElement | null;
    children(): PageElement[];
    next(): PageElement | null;
    prev(): PageElement | null;
}

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

Read-only by design — no `.append`, no `.attr(name, value)`. Descendant queries are `$` / `$$`
(there is no `.find()`). `$` returns `null` for no-match (not a null-object), so missing data stays
explicit; the driver carries response metadata because extract sometimes needs it.

### `PageController` — the interaction surface for `prepare` (async)

Declared here, implemented by [`@sitely/page`](./01-page). Browser-only; authors drive it in `prepare`
to settle interaction-gated content into the DOM *before* the snapshot (expand an accordion, scroll a
lazy section into view). A static backend has no interaction phase.

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

### `ExtractContext` — what `validate`/`extract` see (sync)

Declared here; the runtime builds it (`makeContext`, [02](./02-runtime)) from a materialized
`PageDriver` + params. The read surface is the driver's (sync); the rest is request metadata.

```ts
interface ExtractContext<TParams extends Record<string, string> = Record<string, string>> {
    $(selector: string): PageElement | null;      // delegates to the driver
    $$(selector: string): PageElement[];
    jsonLd(type?: string): Record<string, unknown>[];   // parsed <script type="application/ld+json">, filtered by @type; malformed blocks skipped
    params: TParams;
    url: string;
    status: number;
    headers: Record<string, string>;
    canonical: string | null;                     // href of the first <link rel="canonical">, verbatim; null if absent
    // No public `lazy` — the runtime memoises jsonLd (and the canonical computation) internally,
    // keyed by referential equality. `fetch(url, opts)` and `locale` are v1.
}
```

### Pages — the extraction unit

A page is a path pattern plus how to validate, (optionally) interact, and extract. `prepare` exists
**only** on a dynamic page — a discriminated union on `render` makes a static page unable to declare
it (a compile error, not just a runtime guard). Its `extract` is a map of **local output name →
`Binding`**; the authoring form is a builder `(p) => map` (see [03](./03-framework-dsl)).

```ts
type PageDef =
    | {                                                 // static (default): fetch, no interaction phase
          render?: "static";
          path: PathPattern;
          validate: (ctx: ExtractContext) => boolean;   // false ≡ ResponseRejection("wrong-page")
          extract: Record<string, Binding>;             // resolved: local output name → binding
          fixtures: FixtureSpec[];
      }
    | {                                                 // dynamic: browser render; `prepare` allowed
          render: "dynamic";
          path: PathPattern;
          validate: (ctx: ExtractContext) => boolean;
          prepare?: (page: PageController) => Promise<void>;   // settle interaction-gated content pre-snapshot
          extract: Record<string, Binding>;
          fixtures: FixtureSpec[];
      };

interface FixtureSpec<TParams extends Record<string, string> = Record<string, string>> {
    params: TParams;
    errorCase?: boolean | RejectionReason;   // true = expect any rejection; a reason = expect that one
}
```

A dynamic page needing no interaction just omits `prepare` (still rendered). A static page **cannot**
carry `prepare`; the runtime's static-guard is then belt-and-suspenders for the raw-data path.

### Site definition

Assembled from page symbols. Flat config — no builder chain needed, because every symbol already
carries its own types.

```ts
interface SiteDefinition {
    id: string;
    displayName: string;
    origin: string;                           // scheme://host[:port]; single origin in v0, multi-origin is v1
    pages: Record<string, PageDef>;           // keyed by page name
    // No resource registry / provider map is stored in v0 — nothing reads one (runExtraction resolves
    //   by page name). Both are v1 seams the interface catalogue derives on demand from the bindings.
}
```

### Path pattern

The URL codec is a **standalone package** — a typed, [`URLPattern`-Web-API](https://developer.mozilla.org/en-US/docs/Web/API/URL_Pattern_API)-aligned
pattern with the inverse (`toUrl`) added — decoupled from sitely and depended on by it. Named
`PathPattern` to avoid shadowing the platform `URLPattern` global.

A page may match **multiple** pathnames that converge on one canonical (aliases, short/legacy forms).
`parseUrl` tries the canonical then each alias (first match wins); `toUrl` always emits the
**canonical** path. So `toUrl(parseUrl(path))` collapses any alias to the canonical form — the v1
cache key. All patterns must expose the same `TParams` (enforced at construction).

```ts
interface PathPattern<TParams extends Record<string, string> = Record<string, string>> {
    readonly canonical: string;               // the canonical pattern; toUrl builds from this
    readonly aliases: readonly string[];      // extra match-only patterns converging on canonical (may be empty)
    toUrl(params: TParams): string;            // the canonical PATH (relative to origin); the runner prepends origin
    parseUrl(path: string): TParams | null;    // tries canonical then aliases; input is an origin-relative path
}
```

`parseUrl` takes an origin-relative **path** — the runner/harness strip a full URL's origin before
calling it. **Grammar:** the reversible subset of the Web API — named `:segment` and optional
`:segment?` — is fully typed *and* `toUrl`-able; wildcards / `(regex)` groups may *match* but aren't
part of the typed/buildable v0 surface. The round-trip and alias-canonicalisation are verified by
[`04`'s `path-codec` check](./04-framework-test). This URL normal form is distinct from
`ctx.canonical` (a page's `<link rel="canonical">`).

### The JSON-Schema boundary

**JSON Schema is the required schema definition** — the framework's boundary. Everything reads JSON
Schema. TypeBox is the recommended authoring tool (it *is* JSON Schema + gives `Static<>`), but any
JSON-Schema-emitting tool works.

```ts
type JsonSchema = Record<string, unknown>;   // a JSON Schema (draft 2020-12) object; TypeBox's TSchema satisfies it

// Assets are TYPED OBJECTS in the data — self-describing on the wire, interop-friendly, expandable.
type AssetType   = "image" | "video" | "audio" | "document";   // the media KIND
type MediaFormat = "hls" | "dash" | "progressive";             // transport: "hls"/"dash" = manifest, "progressive" = direct file

interface Asset {
    url: string;             // the SOURCE url as found — not guaranteed durable or publicly fetchable (see delivery note)
    type: AssetType;
    format?: MediaFormat;    // optional; URL-derivable (.m3u8 → hls, .mpd → dash, else progressive)
    mimeType?: string;       // optional; the content-type when the DOM exposes it (e.g. <source type>), else absent
}

// `asset(kind)` is the SCHEMA helper — GENERIC so `Static<>` recovers the literal `type`:
function asset<K extends AssetType>(kind: K):
    TObject<{ url: TString; type: TLiteral<K>; format: TOptional<TUnion</*MediaFormat*/>>; mimeType: TOptional<TString> }>;
//   → object schema + "x-sitely-asset": kind ; Static<asset("image")> = { url: string; type: "image"; format?: MediaFormat; mimeType?: string }
// `asset.<kind>(url, opts?)` is the VALUE helper used in a field function:
//   asset.image(url)                        → { url, type: "image" }
//   asset.video(url, { format: "hls" })     → { url, type: "video", format: "hls" }

// `presence` wraps an optional/nullable field's schema with its expected-present rate (0..1):
function presence<S extends TSchema>(schema: S, rate: number): S;   // + "x-sitely-presence": rate

// The validation boundary — a small standalone module (Ajv or TypeBox's compiler under the hood)
// that both @sitely/runtime and @sitely/framework import, so the runtime validates without the DSL:
interface ValidationIssue { resource: string; output?: string; path: string; message: string }
function validateExtraction(schema: JsonSchema, data: unknown):
    | { ok: true }
    | { ok: false; issues: ValidationIssue[] };
```

Custom keywords in v0: `x-sitely-asset` (media kind — present alongside the typed object, for
discovery/interop) and `x-sitely-presence` (drift rate). They are **metadata on the schema object** —
read by walking the JSON Schema, never part of `Static<>`. `x-sitely-implements` (interface identity)
and `x-sitely-ttl` (field/resource freshness — see the [v1 outline](./index)) are v1.

**Media references are a source, not a delivery guarantee.** The `url` is the URL as extracted;
whether a consumer can fetch it **direct** (public CDN), **proxied** (IP/session-scoped signed URLs),
or **re-derived** (signed URLs expire) is a v1 delivery concern — the `format` tag is what tells that
layer a manifest needs rewriting. See the [v1 outline](./index). No v0 shape change is
forced by it.

### Runner result

What `@sitely/runtime` returns for one extraction — a closed discriminated union the harness and
`sitely dev` switch on. Not the server's wire envelope (v1).

```ts
type RunnerResult =
    | { kind: "ok"; data: Record<string, unknown>; fieldErrors?: FieldDiagnostic[] }  // keyed by output; one → item, many → item[]
    | { kind: "rejected"; reason: RejectionReason }     // validate-false folds in as reason: "wrong-page"
    | { kind: "extraction-error"; error: ExtractionError; output?: string }  // `output` = the binding whose body threw
    | { kind: "validation-error"; issues: ValidationIssue[]; fieldErrors?: FieldDiagnostic[] }  // fieldErrors: thrower diagnostics when an absence is fatal
    | { kind: "error"; message: string };               // uncaught throw, lifecycle failure, OOM

interface FieldDiagnostic { output: string; index?: number; field: string; reason: "missing" | "malformed" | "error"; message: string }  // isolated field throw; reason from the thrown class
```

### Error taxonomy

One coherent taxonomy with parity across the three failure layers. The one runtime export here; every
class carries a stable, **enumerated** `kind`, so any layer can `switch (err.kind)`.

```ts
class FrameworkError extends Error { readonly kind: string }

// Response layer — the page/response is wrong or blocking. `validate → false` is sugar for
// ResponseRejection("wrong-page"); authors throw a categorized reason from validate/extract.
type RejectionReason = "wrong-page" | "captcha" | "blocked" | "removed" | "login-wall" | "rate-limited";
class ResponseRejection extends FrameworkError {
    readonly kind = "response-rejection";
    readonly reason: RejectionReason;
    constructor(reason: RejectionReason);
}

// Extraction layer — good DOM, extracting from it failed. Author signals.
class ExtractionError    extends FrameworkError { readonly kind: "extraction" | "missing-data" | "malformed-data" = "extraction" }
class MissingDataError   extends ExtractionError { readonly kind = "missing-data";   readonly field: string; readonly detail: string; constructor(opts: { field: string; detail: string }) }
class MalformedDataError extends ExtractionError { readonly kind = "malformed-data"; readonly field: string; readonly detail: string; constructor(opts: { field: string; detail: string }) }

// Schema layer — extracted data doesn't fit the schema. The runner throws this; authors don't.
class ValidationError    extends FrameworkError { readonly kind = "validation" }
```

**Disposition (retryable? after how long?) is a v1 mapping.** Retry only acts on a live fetch, which
v0 doesn't have. v0 **captures the category** (typed, and an errorCase fixture can assert it); v1
maps `RejectionReason → retry disposition` where fetching actually runs.

## Invariants

1. **A resource is an item shape — never an array.** Collections are cardinality-`many`, declared per
   page via `p.many`. The resource is the interop unit a consumer queries by.
2. **No cycle.** Resources and pages are standalone symbols, and every cross-boundary interface is
   declared here — the package graph is a strict DAG (`contracts ← page ← runtime ← framework`).
3. **Page-extract leaves are all synchronous field functions** (`() => value`), **present even for
   optional fields** (`FieldFns` strips optionality). A `one` binding's extract returns `FieldFns<T>`;
   a `many` binding's returns `FieldFns<T>[]`.
4. **`presence()` is a quality gate, not a run gate, and is orthogonal to optionality.** Absence is
   permitted because a field is *optional* (absent from `required`); `presence()` is drift metadata on
   top. It's enforced by `sitely test`/CI, warned in `sitely dev`, and **not** blocked at
   `defineSite`/dev-run. See [04](./04-framework-test).
5. **`JsonSchema` is the required schema representation** everywhere. No validator-library type crosses
   the boundary; TypeBox is a recommended producer, not part of the contract.
6. **`RunnerResult` is a closed union.** The harness handles all five variants; a sixth is a compile
   error at every switch.
7. **`validate → false` ≡ `ResponseRejection("wrong-page")`.** Categorized rejections are thrown.
8. **An asset is a typed object** `{ url, type, format?, mimeType? }` in the data; `x-sitely-asset` is
   schema metadata. `prepare` exists only on a `render: "dynamic"` page.

## Behaviour & edge cases

- **Two pages produce the same resource** (a permalink page `p.one` + a thread page `p.many`) — both
  valid; resource-driven access (v1) picks the cheaper cardinality for a single-item request.
- **A field function throws** → caught per-field; recorded as a `FieldDiagnostic` (`output.field`, or
  `output[i].field` for `many`) whose `reason` comes from the thrown class (`MissingDataError` →
  `"missing"`, `MalformedDataError` → `"malformed"`, anything else → `"error"`); the field is absent;
  siblings continue; schema validation decides whether absence is permitted (it is, for an *optional*
  field). In v0 every field-level throw is isolated the same way regardless of class — the class is a
  drift label, not different control flow (a harder disposition for `malformed` is v1). A throw from a
  binding's extract **body** (not a field) instead ends the whole run — as `rejected`,
  `extraction-error`, or `error` per the thrown class; see [02](./02-runtime).
- **A malformed selector inside a field function** (`ctx.$("[[bad")`) throws → it's isolated like any
  field throw (`reason: "error"`), so on an *optional* field it degrades to an absent field + a
  diagnostic rather than a hard failure. The diagnostic is the signal; `fixture-coverage` also flags
  the never-populated field.
- **A `many` extract returns `[]`** → a valid empty collection, not an error.
- **`prepare` on a static page** → impossible by construction (the `render: "static"` arm has no
  `prepare`); a `render: "dynamic"` page requires a dynamic backend (see [01](./01-page)).
- **An asset value** is `{ url, type, format?, mimeType? }`; `url` is the source URL, `type` the media
  kind, `format` the transport (manifest vs file), `mimeType` the content-type when known. Consumers
  handle manifests (`format: "hls"|"dash"`) via a streaming player; sitely does not process the media
  package.

## Acceptance criteria

**Compile-time (the payoff of the symbol model):**

- A field function whose return type doesn't match its resource's schema field → compile error (the
  field-function map is typed against `Static<schema>`).
- A `p.many` extract returning a single object instead of an array → compile error.
- A page's `validate` `ctx.params` and each `fixtures[i].params` typed to the path's `:segments`.
- `Static<asset("image")>` is `{ url: string; type: "image"; format?: MediaFormat; mimeType?: string }`;
  `asset.image(url)` matches it (proves the generic `asset<K>` carries the literal).
- Declaring `prepare` on a `render: "static"` (or render-omitted) page → compile error.

**Runtime:**

- **Closed union:** an exhaustiveness switch over `RunnerResult` compiles with no `default`.
- **Schema boundary:** `validateExtraction` accepts what `Static<schema>` admits and rejects what it
  doesn't; `asset(...)`/`presence(...)` emit the documented keywords.
- **Cardinality:** a `one` binding validates its single item; a `many` binding validates each element.
- **Field isolation:** a throwing field function yields a `FieldDiagnostic` (with `reason` from the
  thrown class, and item index for `many`) while siblings resolve; the run is `ok` unless the absence
  breaks the schema, in which case the diagnostic rides on the `validation-error`'s `fieldErrors`.
- **Rejection parity:** `validate → false` and a thrown `ResponseRejection("captcha")` both surface as
  `rejected` with the right `reason`.

## Open questions

- **Field diagnostics shape** on the `ok`/`validation-error` results — enough for `sitely dev`'s
  per-field diff now; v1 drift telemetry may want richer per-field structure.
- **`materialize()` timeout.** The lifecycle times out `launch`/`prepare` but not the settle+snapshot;
  v0 leans on the backend's own settle default and notes it — a `materializeTimeoutMs` knob is v1.
