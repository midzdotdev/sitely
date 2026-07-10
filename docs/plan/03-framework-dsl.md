# 03 · @sitely/framework — DSL

The package authors import. It provides the factories that turn TypeBox schemas + extract logic into
the standalone symbols the [runner](./02-runtime) executes and the [harness](./04-framework-test)
tests — `resource`, `page`, `defineSite`, `urlPattern` — plus the `presence` / `asset` helpers and
the fail-fast structural validation `defineSite` runs. Its real job is the **authoring-side
type-safety**: the generics that make a field function a *compile error* if it doesn't match its
resource's schema, and the page builder that types `ctx.params`.

## Purpose & dependencies

**Purpose.** The authoring DSL, its compile-time safety, and fail-fast validation of *run-blocking*
mistakes. It produces plain data — a `SiteDefinition` — with no runtime coupling to the runner.

**Dependencies.** [`00 · contracts`](./00-contracts) (the `Resource`/`PageDef`/`Binding`/`SiteDefinition`
types, `ExtractContext`/`PageController`, `Asset`/`AssetType`/`MediaFormat`, errors, `JsonSchema`), the
**standalone `PathPattern` codec** package (Web-API-aligned; re-exported as `urlPattern`), and
**TypeBox** (the recommended schema producer — the source of `Static<>`).

## Public interface

### `resource` — an item symbol

```ts
function resource<Name extends string, S extends TSchema>(
    name: Name, schema: S, opts?: { key?: keyof Static<S> & string },
): Resource<Name, Static<S>>;
// Overload — a raw JSON Schema object (any non-TypeBox producer) works too, but then T is `unknown`
// and you lose the field-level checks (the "no lock-in" escape hatch):
function resource<Name extends string>(
    name: Name, schema: JsonSchema, opts?: { key?: string },
): Resource<Name, unknown>;
```

A pure `{ name, schema, key }` symbol — no extract logic. `Static<S>` is the item's TS type `T`.
Guides use TypeBox because it gives that `T`; the raw-schema overload keeps the framework un-locked.

### `urlPattern` — inferred params, multi-path

```ts
type ExtractParams<P extends string> = /* template-literal type over the reversible grammar:
   ":name" → { name: string }, ":name?" → { name?: string }. Wildcards / (regex) groups may match
   but are not part of the typed, toUrl-able surface. */;

// From the standalone PathPattern codec package (aligned to the URLPattern Web API), re-exported here.
function urlPattern<P extends string>(
    canonical: P,
    opts?: { aliases?: string[]; paramsSchema?: Partial<Record<keyof ExtractParams<P>, TSchema>> },
): PathPattern<ExtractParams<P>>;
```

`urlPattern("/item/:id")` is `PathPattern<{ id: string }>`. A page may match **multiple** pathnames
that converge on one canonical — `urlPattern("/product/:slug/:id", { aliases: ["/p/:id"] })` matches
either, and `toUrl` always emits the canonical `/product/:slug/:id`. All aliases must expose the same
params as the canonical (checked at construction; a mismatch throws). `paramsSchema` constrains each
param — and seeds the generator for the property-based [`path-codec`](./04-framework-test) check.

### `page` — binds params, collects bindings via a builder

`prepare` lives only in the `render: "dynamic"` arm, so a static page can't declare it (a compile
error, matching [00's `PageDef`](./00-contracts)):

```ts
interface PageBuilder<TParams extends Record<string, string>> {
    one<N extends string, T>(r: Resource<N, T>,  extract: (ctx: ExtractContext<TParams>) => FieldFns<T>):    Binding<N, T, "one">;
    many<N extends string, T>(r: Resource<N, T>, extract: (ctx: ExtractContext<TParams>) => FieldFns<T>[]):  Binding<N, T, "many">;
}

function page<TParams extends Record<string, string>, const E extends Record<string, Binding>>(
    def:
        | {   // static (default): fetch, no interaction phase
              render?: "static";
              path: PathPattern<TParams>;
              validate: (ctx: ExtractContext<TParams>) => boolean;
              extract: (p: PageBuilder<TParams>) => E;              // the builder carries TParams into each binding
              fixtures: FixtureSpec<TParams>[];
          }
        | {   // dynamic: browser render; `prepare` allowed
              render: "dynamic";
              path: PathPattern<TParams>;
              validate: (ctx: ExtractContext<TParams>) => boolean;
              prepare?: (page: PageController) => Promise<void>;
              extract: (p: PageBuilder<TParams>) => E;
              fixtures: FixtureSpec<TParams>[];
          },
): Page<E>;

// Page<E> — the authoring form page() returns: a PageDef plus a compile-time capture of E (the
// extract map's shape) that drives result-type inference. defineSite erases E → a plain PageDef.
interface Page<E extends Record<string, Binding> = Record<string, Binding>> {
    readonly __def: PageDef;    // the erased runtime form
    readonly __bindings?: E;    // phantom: carries E for inference; absent at runtime
}
```

The **builder is what fixes the typed-params problem**: `p.one(Story, (ctx) => …)` types that
extract's `ctx.params` as the page's `TParams`, because the binding is created *inside* the page
where the path's params are known — not on the standalone resource symbol. `E` is captured with a
`const` type parameter so the page's result shape (`{ [k]: one ? T : T[] }`) is derived from the
bindings' cardinalities. The page factory calls `extract(p)` once with a real builder and stores the
resolved `Record<string, Binding>` in the `PageDef`. `defineSite` erases each `Page<E>` into the
runtime **`PageDef`** ([00](./00-contracts)), keyed by the name you give it in the `pages` record (the
page has no `name` of its own).

### `defineSite` — assemble + validate run-blockers

```ts
function defineSite(config: {
    id: string; displayName: string; origin: string; pages: Record<string, Page>;
}): SiteDefinition;
```

Keys the page record by name, runs `validateSite`, and **throws on any run-blocking error** (below).
It does **not** enforce `presence()` — that's a quality gate, not a run gate (see
[the harness](./04-framework-test)), so an author can define and run a scraper mid-development without
annotating presence yet. (No resource registry / provider map is built — that's a v1 seam; see
[00](./00-contracts).)

### Annotation helpers

```ts
// asset(kind) — the GENERIC schema helper (see 00): Static<> recovers the literal `type`.
const asset: {
    <K extends AssetType>(kind: K): TObject<{ url: TString; type: TLiteral<K>; format: TOptional<TUnion</*MediaFormat*/>>; mimeType: TOptional<TString> }>;
    image(url: string, opts?: { format?: MediaFormat; mimeType?: string }): Asset;    // value helpers
    video(url: string, opts?: { format?: MediaFormat; mimeType?: string }): Asset;
    audio(url: string, opts?: { format?: MediaFormat; mimeType?: string }): Asset;
    document(url: string, opts?: { mimeType?: string }): Asset;
};

function presence<S extends TSchema>(schema: S, rate: number): S;    // wraps an optional/nullable field's schema; rate in 0..1
```

So authoring an asset field stays lean and type-checked — the field function returns the typed object:

```ts
heroImage: () => asset.image(ctx.$('meta[property="og:image"]')?.attr("content") ?? "")
//   → { url, type: "image" }, matching the resource's asset("image") schema
stream:    () => asset.video(manifestUrl, { format: "hls" })
//   → { url, type: "video", format: "hls" } — a manifest the consumer plays with an HLS player
```

### Static validation (run-blockers only)

```ts
interface SiteValidationError { kind: "path-parse" | "invalid-schema" | "bad-key" | "invalid-origin"; where: string; message: string }
function validateSite(site: SiteDefinition): SiteValidationError[];
```

Only the mistakes that stop a scraper from *running*:

- **`path-parse`** — a page `path` (canonical or an alias) that doesn't parse, or aliases whose params
  disagree with the canonical.
- **`invalid-schema`** — a resource `schema` that isn't a valid JSON Schema object.
- **`bad-key`** — a resource `key` naming a field its schema doesn't have.
- **`invalid-origin`** — the site `origin` doesn't parse as a `scheme://host[:port]` origin.

`presence`-mandatory is **not** here — it's a `sitely test` check ([04](./04-framework-test)).

### Re-exports

The [error classes](./00-contracts) and the `ExtractContext` type ([00](./00-contracts)), plus
`urlPattern`/`PathPattern` from the codec package — so a package imports everything it needs from
`@sitely/framework`.

## Invariants

1. **Field functions type-check against their resource's schema.** A field function whose return type
   doesn't match `Static<schema>` is a compile error — the core of authoring safety.
2. **Params are inferred and typed into extract via the builder.** `urlPattern` derives `TParams` from
   `:segments`; the page builder threads it into every binding's `ctx.params`, and into `validate`
   and `fixtures`.
3. **`defineSite` fails fast on run-blockers only** (`path-parse`, `invalid-schema`, `bad-key`, `invalid-origin`).
   `presence`-mandatory is a test gate, not a run gate.
4. **The DSL emits plain data.** `defineSite(...)` is a `SiteDefinition` — inert data the runner
   executes; no DSL type or runtime crosses into `@sitely/runtime`.
5. **TypeBox is recommended, not required.** The raw-`JsonSchema` `resource` overload compiles for any
   producer; only `Static<>` field-level inference is TypeBox-specific.
6. **An asset field function returns a typed `{ url, type, format?, mimeType? }`** (via
   `asset.<kind>(url, opts?)`), matching its `asset(kind)` schema.

## Behaviour & edge cases

- **Field-function type mismatch** (`headline: () => 42` where the schema says `string`) → compile
  error at the `p.one`/`p.many` call.
- **A `p.many` extract returning a single object** → compile error.
- **`prepare` on a `render: "static"` (or render-omitted) page** → compile error (the static arm has
  no `prepare`).
- **Unparseable `path` / invalid schema / bad `key` / invalid `origin` / alias-params mismatch** →
  `validateSite`, `defineSite` throws.
- **Optional field without `presence()`** → **not** a `defineSite` error; the scraper runs. `sitely
  test` flags it (`04`); `sitely dev` warns.
- **Raw JSON Schema (non-TypeBox) resource** → compiles via the overload and runs; `Static<>` is
  `unknown`, so its field functions aren't type-checked (documented trade-off).
- **A resource symbol defined but used by no page** → not an error; it's simply unreferenced.

## Acceptance criteria

- **Type-test suite** (compile-time): a field-type mismatch, a `p.many`-returns-non-array, a `prepare`
  on a static page, and a `urlPattern` param check each fail to compile; a correct site compiles;
  `validate`/`fixtures[i]` `ctx.params` is typed to the page path; `asset.image(url)` is assignable to
  `Static<asset("image")>` (the generic `asset<K>` carries the literal); a raw-`JsonSchema` `resource`
  compiles with `T = unknown`.
- **`validateSite`** catches each run-blocker with a precise `where` (including an alias-params
  mismatch); **`defineSite` throws** those but **not** a missing-`presence` case.
- **Helpers:** `asset(kind)` emits the object schema + keyword; `asset.<kind>(url, opts?)` returns the
  typed object (with `format`/`mimeType` when given); `presence` emits `x-sitely-presence`.

## Open questions

- **`const`-generic + builder inference.** The result shape leans on capturing `E` from `extract(p)`'s
  return with a `const` type parameter through the builder. Verify inference holds (and error
  messages stay legible) on real nested TypeBox schemas before locking the signatures.
- **`ExtractParams` grammar coverage.** The typed/`toUrl`-able subset is named + optional segments;
  confirm the template-literal type and the codec's `toUrl` agree on optional-segment handling before
  locking, and whether wildcard/regex match-only forms need a typed escape.
- **Eager vs lazy `defineSite` validation.** Throwing is best for authoring fail-fast; a
  `{ throwOnError?: false }` escape may be worth it for programmatic/site-generation callers that want
  to inspect errors.
