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
the authoring factories. The one type declared elsewhere is `URLCodec`: it belongs to the
[standalone codec package](./05-url-codec) and this spec **re-exports** it. The package graph is a
clean DAG (`url-codec ← contracts ← page ← runtime ← framework`) with no back-edges — the codec is
the true dependency root; contracts is the sitely root.

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
    readonly key?: string;                     // identity field, for addressing a single item (v1). Typed as
                                               //   `keyof Static<S> & string` at the 03 factory; here it is plain
                                               //   `string` because with T = unknown, `keyof T & string` is `never`
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
    jsonLd(type?: string): Record<string, unknown>[];   // RAW: normalized JSON-LD entities, filtered by @type (rules below)
    jsonLd<T>(iface: Interface<string, T>): T[];        // PARSED: entities matching iface.name that VALIDATE against iface.schema
    params: TParams;
    url: string;
    status: number;
    headers: Record<string, string>;
    canonical: string | null;                     // href of the first <link rel="canonical">, verbatim; null if absent
    // No public `lazy` — the runtime memoises jsonLd (and the canonical computation) internally,
    // keyed by referential equality (the `type` string / the `iface` reference). `fetch` and `locale` are v1.
}
```

**`jsonLd` normalization.** The raw reader collects every `<script type="application/ld+json">` in
document order, `JSON.parse`s each (malformed blocks are skipped), and normalizes to a flat entity
list: a top-level array contributes its elements in order; an object with a top-level `@graph` array
contributes the graph entries (the wrapper is dropped); any other object contributes itself — applied
once, no recursive descent (entities nested inside properties are not lifted). `jsonLd()` returns the
whole list; `jsonLd("JobPosting")` returns entities whose `@type` equals the string **or is an array
containing it** — exact and case-sensitive, with no `@context` expansion (a pragmatic reader, not a
JSON-LD processor: `"Article"` does not match `@type: "schema:Article"`). The **parsed overload**
takes an [`Interface`](#the-json-schema-boundary) and returns only the entities matching `iface.name`
that validate against `iface.schema` (via the runtime's `validateExtraction`); non-conforming entities
are **dropped**, so junk embeds never poison the good one — and if the entity you need is gone, the
field function reading it throws `MissingDataError` and the diagnostics say so.

### Pages — the extraction unit

A page is a URL codec plus how to validate, (optionally) interact, and extract. `prepare` exists
**only** on a dynamic page — a discriminated union on `render`, with an explicit `prepare?: never` in
the static arm, makes a static page unable to declare it (a compile error, not just a runtime guard).
The `never` is load-bearing: with `render` *omitted* (the static default), a literal carrying
`prepare` is still assignable to the static arm under excess-property rules — `prepare` is a known
key of the dynamic constituent, so only `prepare?: never` turns the omitted-discriminant case into
the promised compile error (compiler-verified). Its `extract` is a map of **local output name →
`Binding`**; the authoring form is a builder `(p) => map` (see [03](./03-framework-dsl)).

```ts
type PageDef =
    | {                                                 // static (default): fetch, no interaction phase
          render?: "static";
          path: URLCodec;
          validate: (ctx: ExtractContext) => boolean;   // false ≡ ResponseRejection("wrong-page")
          prepare?: never;                              // load-bearing: keeps `prepare` a compile error even with `render` omitted
          extract: Record<string, Binding>;             // resolved: local output name → binding
          fixtures: FixtureSpec[];
      }
    | {                                                 // dynamic: browser render; `prepare` allowed
          render: "dynamic";
          path: URLCodec;
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
carry `prepare` (`prepare?: never`); separately, the runtime refuses to run any `render: "dynamic"`
page on a static backend (see [02](./02-runtime)) — belt-and-suspenders for the raw-data path.

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

### URL codec

The URL codec is a **standalone package** — spec'd in [05](./05-url-codec), built first, decoupled
from sitely and depended on by it. It is aligned with the
[`URLPattern` Web API](https://developer.mozilla.org/en-US/docs/Web/API/URL_Pattern_API) where
alignment helps and deviates deliberately where it doesn't — every deviation is documented with its
reasoning in 05. This spec **re-exports** the codec's `URLCodec` type; the summary below is normative
for how sitely *uses* it.

A codec is constructed from **paths only**; origins arrive at call time as `base`, which is what
keeps one codec valid for any origin (the runner passes `site.origin`). A page may match **multiple**
patterns that converge on one canonical (aliases, short/legacy forms): `fromUrl` tries the canonical
then each alias (first match wins); `toUrl` always emits the **canonical** form. So
`toUrl(fromUrl(url))` collapses any alias to the canonical — the v1 cache key. All patterns must
expose the same `TParams` (enforced at construction — a mismatch throws at `urlCodec(…)`).

```ts
interface URLCodec<TParams extends Record<string, string> = Record<string, string>> {
    readonly canonical: string;                // the canonical pattern; toUrl builds from this
    readonly aliases: readonly string[];       // extra match-only patterns converging on canonical (may be empty)
    readonly paramsSchema?: Readonly<Partial<Record<keyof TParams, JsonSchema>>>;   // per-param metadata; doc/generation only, no match-time
                                                                                    //   enforcement in v0. 05 spells the value type
                                                                                    //   Record<string, unknown> — identical to JsonSchema
                                                                                    //   (the codec is dependency-free)
    toUrl(params: TParams, opts?: { base?: string | URL }): string;
    // without base → the root-relative canonical path(+query), leading "/"; with base → an absolute URL on base's origin
    fromUrl(url: string | URL, opts?: { base?: string | URL }): TParams | null;
    // canonical then aliases, first match wins; matches the path + DECLARED query params — undeclared
    // query params and fragments are ignored; absolute input + base → origins must be equal, else null
}
```

**Grammar (v0 — the reversible subset):** literal segments, named `:param`, optional `:param?`, and a
query tail of named/optional/literal pairs (`/item?id=:id`, `/search?type=job&q=:q`). Every pattern —
canonical *and* alias — is fully typed and `toUrl`-able; wildcards and `(regex)` groups are **rejected
at construction** (they cannot round-trip, and their param exposure breaks the same-params rule).
Query params match **by name, order-insensitive** — the utm-noise answer:
`fromUrl("/item?id=1&utm_source=x")` still recovers `{ id: "1" }`. The round-trip, alias-collapse,
and noise-immunity properties are verified by [`04`'s `path-codec` check](./04-framework-test). This
URL normal form is distinct from `ctx.canonical` (a page's `<link rel="canonical">`).

### The JSON-Schema boundary

**JSON Schema is the required schema definition** — the framework's boundary. Everything reads JSON
Schema. TypeBox is the recommended authoring tool (it *is* JSON Schema + gives `Static<>`), but any
JSON-Schema-emitting tool works.

```ts
type JsonSchema = Record<string, unknown>;   // a JSON Schema (draft 2020-12) object; TypeBox's TSchema satisfies it

// Assets are TYPED OBJECTS in the data — self-describing on the wire, interop-friendly, expandable.
type AssetType   = "image" | "video" | "audio" | "document";   // the media KIND
type MediaFormat = "hls" | "dash" | "progressive";             // transport: "hls"/"dash" = manifest, "progressive" = direct file

// GENERIC so the literal kind survives: Asset<"image"> = { url: string; type: "image"; mimeType?: string }.
// `format` exists only where transport is meaningful (video/audio): { type: "image", format: "hls" }
// is a compile error AND a validation failure — asset schemas are closed (additionalProperties: false).
type Asset<K extends AssetType = AssetType> =
    K extends "video" | "audio"
        ? { url: string; type: K; format?: MediaFormat; mimeType?: string }
        : { url: string; type: K; mimeType?: string };
// url: the SOURCE url as found — not guaranteed durable or publicly fetchable (see delivery note).
// format: URL-derivable (.m3u8 → hls, .mpd → dash, else progressive); mimeType: only when the DOM exposes it.
// The `asset(kind)` schema helper and `asset.<kind>(url, opts?)` value helpers are TypeBox-typed
// factories and live in the DSL ([03](./03-framework-dsl)) — not in contracts (invariant 5).

// An Interface is a NAMED SCHEMA CLAIM — "data of type `name`, shaped like `schema`". It reifies the
// G2 interop unit in v0: ctx.jsonLd's parsed overload consumes Interface values today; in v1 the
// generated catalogue IS a set of Interface values and `resource`'s `implements` option takes them.
// The `kind` discriminant is load-bearing: a Resource is also structurally name+schema, but its name
// is site-local vocabulary — the discriminant makes `jsonLd(someResource)` a compile error.
interface Interface<N extends string = string, T = unknown> {
    readonly kind: "interface";
    readonly name: N;                          // the schema.org (or other vocabulary) type name — the identity
    readonly schema: JsonSchema;               // canonical (v1 catalogue) or an author-written partial (v0)
    readonly __static?: T;                     // phantom: carries T for inference; absent at runtime
}
// The `defineInterface(name, schema)` factory lives in the DSL ([03](./03-framework-dsl)), as does
// `presence(schema, rate)` (drift annotation; rate a number literal in [0,1], type-level-guarded).

// The validation boundary. The TYPES live here; the IMPLEMENTATION lives in @sitely/runtime
// ([02](./02-runtime)) — an Ajv/TypeBox-compiler dependency in the contracts root would hand every
// package a validator (invariant 5). @sitely/framework imports the function from the runtime.
interface SchemaIssue     { path: string; message: string }   // path: a JSON Pointer relative to the validated item
interface ValidationIssue { resource: string; output?: string; index?: number; path: string; message: string }
// validateExtraction returns bare SchemaIssues — it knows only (schema, data). The RUNNER decorates
// them into ValidationIssues with the resource/output names (and item index for `many`), which only it knows:
type ValidateExtraction = (schema: JsonSchema, data: unknown) =>
    | { ok: true }
    | { ok: false; issues: SchemaIssue[] };
```

Custom keywords in v0: `x-sitely-asset` (media kind — present alongside the typed object, for
discovery/interop) and `x-sitely-presence` (drift rate). They are **metadata on the schema object** —
read by walking the JSON Schema, never part of `Static<>`. `x-sitely-implements` (interface identity —
stamped on a resource's schema by the v1 `implements` option, carrying an `Interface`'s *name*; names
are the identity, the catalogue is authoritative for what a name means) and `x-sitely-ttl`
(field/resource freshness — see the [v1 outline](./index)) are v1.

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

// Driver layer — a capability the backend doesn't have. Thrown by @sitely/page's static session when
// any PageController method is called (see 01); the runner surfaces it as { kind: "error" }.
class UnsupportedInteractionError extends FrameworkError { readonly kind = "unsupported-interaction" }

// Schema layer — extracted data that doesn't fit its schema is NOT a throwable: it surfaces as the
// `validation-error` RESULT variant (the runner never throws). Authoring-time definition errors throw
// `SiteDefinitionError` from `defineSite` — declared in the DSL ([03](./03-framework-dsl)), same pattern.
```

**Disposition (retryable? after how long?) is a v1 mapping.** Retry only acts on a live fetch, which
v0 doesn't have. v0 **captures the category** (typed, and an errorCase fixture can assert it); v1
maps `RejectionReason → retry disposition` where fetching actually runs.

## Invariants

1. **A resource is an item shape — never an array.** Collections are cardinality-`many`, declared per
   page via `p.many`. The resource is the interop unit a consumer queries by.
2. **No cycle.** Resources and pages are standalone symbols, and every cross-boundary interface is
   declared here (or, for `URLCodec`, re-exported from the codec root) — the package graph is a
   strict DAG (`url-codec ← contracts ← page ← runtime ← framework`).
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
8. **An asset is a typed object** `{ url, type, format?, mimeType? }` in the data (`format` on
   video/audio only); `x-sitely-asset` is schema metadata. `prepare` exists only on a
   `render: "dynamic"` page (the static arm's `prepare?: never` enforces it).

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
- **`prepare` on a static page** → a compile error (the static arm declares `prepare?: never` — mere
  absence would not catch the render-omitted case); a `render: "dynamic"` page requires a dynamic
  backend (see [01](./01-page), enforced by [02](./02-runtime)).
- **An asset value** is `{ url, type, format?, mimeType? }`; `url` is the source URL, `type` the media
  kind, `format` the transport (manifest vs file — video/audio only), `mimeType` the content-type when
  known. Consumers handle manifests (`format: "hls"|"dash"`) via a streaming player; sitely does not
  process the media package.

## Acceptance criteria

**Compile-time (the payoff of the symbol model):**

- A field function whose return type doesn't match its resource's schema field → compile error (the
  field-function map is typed against `Static<schema>`).
- A `p.many` extract returning a single object instead of an array → compile error.
- A page's `validate` `ctx.params` and each `fixtures[i].params` typed to the codec's `:params`
  (path and query).
- `Static<asset("image")>` is `{ url: string; type: "image"; mimeType?: string }` (no `format`);
  `Static<asset("video")>` includes `format?: MediaFormat`; `asset.image(url)` and
  `asset.video(url, { format: "hls" })` match them (proves the generic `Asset<K>`/`asset<K>` carry
  the literal — verified against real TypeBox).
- Declaring `prepare` on a `render: "static"` **or render-omitted** page → compile error (the
  `prepare?: never` in the static arm is what delivers the render-omitted half).
- `ctx.jsonLd(iface)` is `T[]` for an `Interface<string, T>`; passing a `Resource` where an
  `Interface` is expected → compile error (the `kind` discriminant).

**Runtime:**

- **Closed union:** an exhaustiveness switch over `RunnerResult` compiles with no `default`.
- **Schema boundary:** `validateExtraction` accepts what `Static<schema>` admits and rejects what it
  doesn't, returning bare `SchemaIssue`s that the runner decorates into `ValidationIssue`s
  (`resource`/`output`/`index`); `asset(...)`/`presence(...)` emit the documented keywords.
- **Parsed JSON-LD:** `ctx.jsonLd(iface)` returns only entities matching `iface.name` that validate
  against `iface.schema`, in document order; non-conforming entities are dropped.
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
