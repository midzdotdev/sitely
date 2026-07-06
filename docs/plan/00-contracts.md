# 00 · Contracts (v0)

The shared type surface every v0 component imports. Types only, plus the minimal error classes
(they carry a `kind` discriminator every layer matches on). If two components disagree about a
shape, this spec is right.

Scoped to **v0**. The manifest, the seven-status wire envelope, the build subsystem, versioning,
and multi-host origins are **v1** — they belong to the server/build, which v0 doesn't have.

## Purpose & dependencies

Define the four contracts that cross v0 boundaries:

1. **`SiteDefinition`** — a site assembled from standalone resource + page symbols.
2. **Resources** — standalone *item* shapes (the interop unit); pages produce one or many.
3. **The JSON-Schema boundary** — the required schema representation + annotation keywords.
4. **`RunnerResult`** + the **error taxonomy** — what `@sitely/runtime` returns.

This spec holds the **types**; the [DSL](./03-framework-dsl) provides the factories (`resource`,
`page`, `defineSite`, `urlPattern`) that construct them with authoring-side type-safety.
`ExtractContext` is owned by [the runtime](./02-runtime); `PageController`/`PageDriver` by
[`@sitely/page`](./01-page). Otherwise this is the dependency root.

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

// FieldFns — every leaf is a zero-arg function producing that field. Even constants.
type FieldFns<T> = { [K in keyof T]: () => T[K] | Promise<T[K]> };

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

### Pages — the extraction unit

A page is a path pattern plus how to validate, (optionally) interact, and extract. Its `extract` is
a map of **local output name → `Binding`**. In the built `SiteDefinition` it's the resolved map; the
authoring form is a **builder function** `(p) => map`, where `p` carries the page's param type so
each binding's `ctx.params` is typed to the path's `:segments` (see [03](./03-framework-dsl)).

```ts
interface PageDef {
    path: URLPattern;
    validate: (ctx: ExtractContext) => boolean;                 // false ≡ ResponseRejection("wrong-page")
    prepare?: (page: PageController) => Promise<void>;          // dynamic-only interaction; see 01
    extract: Record<string, Binding>;                           // resolved: local output name → binding
    fixtures: FixtureSpec[];
}

interface FixtureSpec {
    params: Record<string, string>;
    errorCase?: boolean | RejectionReason;   // true = expect any rejection; a reason = expect that one
}
```

### Site definition

Assembled from page symbols. Flat config — no builder chain needed, because every symbol already
carries its own types.

```ts
interface SiteDefinition {
    id: string;
    displayName: string;
    hostname: string;                         // single host in v0; multi-host is v1
    pages: Record<string, PageDef>;           // keyed by page name
    // The flat resource registry + resource→page provider map are derived statically at defineSite:
    //   resources come from pages' bindings; provider(resource) = the page whose extract binds it.
}
```

### URL pattern

Bidirectional; `TParams` inferred from `:segment` placeholders. `path` is relative to `hostname`.

```ts
interface URLPattern<TParams extends Record<string, string> = Record<string, string>> {
    readonly pattern: string;
    toUrl(params: TParams): string;           // path only; the runner prepends `https://${hostname}`
    parseUrl(path: string): TParams | null;
}
```

### The JSON-Schema boundary

**JSON Schema is the required schema definition** — the framework's boundary. Everything reads JSON
Schema. TypeBox is the recommended authoring tool (it *is* JSON Schema + gives `Static<>`), but any
JSON-Schema-emitting tool works.

```ts
type JsonSchema = Record<string, unknown>;   // a JSON Schema (draft 2020-12) object; TypeBox's TSchema satisfies it

// Assets are TYPED OBJECTS in the data — self-describing on the wire, interop-friendly, expandable.
type AssetType = "image" | "video" | "audio" | "document";
interface Asset { url: string; type: AssetType }   // v1 may extend: mimeType?, bytes?, width?, height?

// `asset(kind)` is the SCHEMA helper — a schema for `{ url: string; type: <kind> }` + the discovery keyword.
function asset(kind: AssetType): TSchema;
//   → object schema { url: string, type: const <kind> } with "x-sitely-asset": kind
//   Static<asset("image")> = { url: string; type: "image" }
// `asset.<kind>(url)` is the VALUE helper used in a field function, so authoring stays lean:
//   asset.image(url) → { url, type: "image" }

// `presence` wraps an optional/nullable field's schema with its expected-present rate:
function presence<S extends TSchema>(schema: S, rate: number): S;   // + "x-sitely-presence": rate

// The validation boundary — Ajv or TypeBox's compiler under the hood:
interface ValidationIssue { resource: string; path: string; message: string }
function validateExtraction(schema: JsonSchema, data: unknown):
    | { ok: true }
    | { ok: false; issues: ValidationIssue[] };
```

Custom keywords in v0: `x-sitely-asset` (media type — present alongside the typed object, for
discovery/interop) and `x-sitely-presence` (drift rate). They are **metadata on the schema object** —
read by walking the JSON Schema, never part of `Static<>`. `x-sitely-implements` is v1.

### Runner result

What `@sitely/runtime` returns for one extraction — a closed discriminated union the harness and
`sitely dev` switch on. Not the server's wire envelope (v1).

```ts
type RunnerResult =
    | { kind: "ok"; data: Record<string, unknown>; fieldErrors?: FieldDiagnostic[] }  // keyed by output; one → item, many → item[]
    | { kind: "rejected"; reason: RejectionReason }     // validate-false folds in as reason: "wrong-page"
    | { kind: "extraction-error"; error: ExtractionError; field?: string }
    | { kind: "validation-error"; issues: ValidationIssue[] }
    | { kind: "error"; message: string };               // timeout, uncaught throw, OOM

interface FieldDiagnostic { output: string; index?: number; field: string; message: string }  // isolated field throws
```

### Error taxonomy

One coherent taxonomy with parity across the three failure layers. The one runtime export here; each
class carries a stable `kind`.

```ts
class FrameworkError extends Error { readonly kind: string }

// Response layer — the page/response is wrong or blocking. `validate → false` is sugar for
// ResponseRejection("wrong-page"); authors throw a categorized reason from validate/extract.
type RejectionReason = "wrong-page" | "captcha" | "blocked" | "removed" | "login-wall" | "rate-limited";
class ResponseRejection extends FrameworkError { constructor(reason: RejectionReason) }

// Extraction layer — good DOM, extracting from it failed. Author signals.
class ExtractionError    extends FrameworkError {}
class MissingDataError   extends ExtractionError { constructor(opts: { field: string; reason: string }) }
class MalformedDataError extends ExtractionError { constructor(opts: { field: string; reason: string }) }

// Schema layer — extracted data doesn't fit the schema. The runner throws this; authors don't.
class ValidationError    extends FrameworkError {}
```

**Disposition (retryable? after how long?) is a v1 mapping.** Retry only acts on a live fetch, which
v0 doesn't have. v0 **captures the category** (typed, and an errorCase fixture can assert it); v1
maps `RejectionReason → retry disposition` where fetching actually runs.

## Invariants

1. **A resource is an item shape — never an array.** Collections are cardinality-`many`, declared per
   page via `p.many`. The resource is the interop unit a consumer queries by.
2. **No cycle.** Resources and pages are standalone symbols; a page depends on the resource symbols
   it's handed, the site on its pages. Strictly a DAG.
3. **Page-extract leaves are all field functions** (`() => value`), even constants. A `one` binding's
   extract returns `FieldFns<T>`; a `many` binding's returns `FieldFns<T>[]`.
4. **`presence()` is a quality gate, not a run gate.** Every optional/nullable field *should* carry a
   presence rate; this is enforced by `sitely test` (and CI), warned in `sitely dev`, and **not**
   blocked at `defineSite`/dev-run. See [04](./05-framework-test).
5. **`JsonSchema` is the required schema representation** everywhere. No validator-library type crosses
   the boundary; TypeBox is a recommended producer, not part of the contract.
6. **`RunnerResult` is a closed union.** The harness handles all five variants; a sixth is a compile
   error at every switch.
7. **`validate → false` ≡ `ResponseRejection("wrong-page")`.** Categorized rejections are thrown.
8. **An asset is a typed object** `{ url, type }` in the data; `x-sitely-asset` is schema metadata.

## Behaviour & edge cases

- **Two pages produce the same resource** (a permalink page `p.one` + a thread page `p.many`) — both
  valid; resource-driven access (v1) picks the cheaper cardinality for a single-item request.
- **A field function throws** → caught per-field; recorded as a `FieldDiagnostic` (`output.field`, or
  `output[i].field` for `many`); the field is absent; siblings continue; schema validation decides
  whether absence is permitted (it is, for `presence()`-annotated fields).
- **A `many` extract returns `[]`** → a valid empty collection, not an error.
- **`prepare` on a page whose site is run with a static driver** → unsupported; a page declaring
  `prepare` requires a dynamic driver (flagged; see [01](./01-page)).
- **An asset value** is `{ url, type }`; on the wire the `url` is a plain string, the `type` names the
  media kind. `x-sitely-asset` on the schema lets tooling find asset fields without reading data.

## Acceptance criteria

**Compile-time (the payoff of the symbol model):**

- A field function whose return type doesn't match its resource's schema field → compile error (the
  field-function map is typed against `Static<schema>`).
- A `p.many` extract returning a single object instead of an array → compile error.
- A page's `validate`/`fixtures` `ctx.params` typed to the path's `:segments`.
- `Static<asset("image")>` is `{ url: string; type: "image" }`; `asset.image(url)` matches it.

**Runtime:**

- **Closed union:** an exhaustiveness switch over `RunnerResult` compiles with no `default`.
- **Schema boundary:** `validateExtraction` accepts what `Static<schema>` admits and rejects what it
  doesn't; `asset(...)`/`presence(...)` emit the documented keywords.
- **Cardinality:** a `one` binding validates its single item; a `many` binding validates each element.
- **Field isolation:** a throwing field function yields a `FieldDiagnostic` (and item index, for
  `many`) while siblings resolve; the run is `ok` unless the absence breaks the schema.
- **Rejection parity:** `validate → false` and a thrown `ResponseRejection("captcha")` both surface as
  `rejected` with the right `reason`.

## Open questions

- **Field diagnostics shape** on the `ok` result — enough for `sitely dev`'s per-field diff now; v1
  drift telemetry may want richer per-field structure.
- **Where `validateExtraction` physically lives** — a tiny shared module both `@sitely/runtime` and
  `@sitely/framework` import, so the runtime validates without pulling in the DSL. Resolved in
  [02](./02-runtime).
