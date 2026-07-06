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

**Dependencies.** [`00 · contracts`](./00-contracts) (the `Resource`/`Page`/`Binding`/`SiteDefinition`
types, `Asset`, errors, `JsonSchema`), [`02 · runtime`](./02-runtime) (the `ExtractContext` type it
references in extract signatures), and **TypeBox** (the recommended schema producer — the source of
`Static<>`).

## Public interface

### `resource` — an item symbol

```ts
function resource<Name extends string, S extends TSchema>(
    name: Name, schema: S, opts?: { key?: keyof Static<S> & string },
): Resource<Name, Static<S>>;
```

A pure `{ name, schema, key }` symbol — no extract logic. `Static<S>` is the item's TS type `T`.
A raw JSON Schema object works at runtime, but then `T` is `unknown` and you lose the field-level
checks — which is why guides use TypeBox.

### `urlPattern` — inferred params

```ts
type ExtractParams<P extends string> = /* template-literal type: ":segment" → { segment: string } */;

function urlPattern<P extends string>(
    pattern: P, paramsSchema?: Partial<Record<keyof ExtractParams<P>, TSchema>>,
): URLPattern<ExtractParams<P>>;
```

`urlPattern("/item/:id")` is `URLPattern<{ id: string }>`. `path` is relative to the site's `hostname`.

### `page` — binds params, collects bindings via a builder

```ts
interface PageBuilder<TParams extends Record<string, string>> {
    one<N extends string, T>(r: Resource<N, T>,  extract: (ctx: ExtractContext<TParams>) => FieldFns<T>):    Binding<N, T, "one">;
    many<N extends string, T>(r: Resource<N, T>, extract: (ctx: ExtractContext<TParams>) => FieldFns<T>[]):  Binding<N, T, "many">;
}

function page<TParams extends Record<string, string>, const E extends Record<string, Binding>>(
    name: string,
    def: {
        path: URLPattern<TParams>;
        validate: (ctx: ExtractContext<TParams>) => boolean;
        prepare?: (page: PageController) => Promise<void>;
        extract: (p: PageBuilder<TParams>) => E;                 // the builder carries TParams into each binding
        fixtures: FixtureSpec<TParams>[];
    },
): Page<E>;
```

The **builder is what fixes the typed-params problem**: `p.one(Story, (ctx) => …)` types that
extract's `ctx.params` as the page's `TParams`, because the binding is created *inside* the page
where the path's params are known — not on the standalone resource symbol. `E` is captured with a
`const` type parameter so the page's result shape (`{ [k]: one ? T : T[] }`) is derived from the
bindings' cardinalities. The page factory calls `extract(p)` once with a real builder and stores the
resolved `Record<string, Binding>` in the `PageDef`.

### `defineSite` — assemble + validate run-blockers

```ts
function defineSite(config: {
    id: string; displayName: string; hostname: string; pages: Page[];
}): SiteDefinition;
```

Collects the pages, derives the flat resource registry + provider map from their bindings, runs
`validateSite`, and **throws on any run-blocking error** (below). It does **not** enforce
`presence()` — that's a quality gate, not a run gate (see [the harness](./04-framework-test)), so an
author can define and run a scraper mid-development without annotating presence yet.

### Annotation helpers

```ts
function asset(kind: AssetType): TSchema;              // schema for { url: string; type: <kind> } + x-sitely-asset
const asset: {
    (kind: AssetType): TSchema;
    image(url: string): { url: string; type: "image" };     // value helpers — used inside a field function
    video(url: string): { url: string; type: "video" };
    audio(url: string): { url: string; type: "audio" };
    document(url: string): { url: string; type: "document" };
};

function presence<S extends TSchema>(schema: S, rate: number): S;    // wraps an optional/nullable field's schema
```

So authoring an asset field stays lean and type-checked — the field function returns the typed object:

```ts
heroImage: () => asset.image(ctx.$('meta[property="og:image"]').attr("content") ?? "")
//   returns { url, type: "image" }, matching the resource's asset("image") schema
```

### Static validation (run-blockers only)

```ts
interface SiteValidationError { kind: "path-parse" | "invalid-schema" | "bad-key"; where: string; message: string }
function validateSite(site: SiteDefinition): SiteValidationError[];
```

Only the mistakes that stop a scraper from *running*:

- **`path-parse`** — a page `path` that doesn't parse as a URL pattern.
- **`invalid-schema`** — a resource `schema` that isn't a valid JSON Schema object.
- **`bad-key`** — a resource `key` naming a field its schema doesn't have.

`presence`-mandatory is **not** here — it's a `sitely test` check ([04](./04-framework-test)).

### Re-exports

The [error classes](./00-contracts) and the `ExtractContext` type ([02](./02-runtime)), so a package
imports everything it needs from `@sitely/framework`.

## Invariants

1. **Field functions type-check against their resource's schema.** A field function whose return type
   doesn't match `Static<schema>` is a compile error — the core of authoring safety.
2. **Params are inferred and typed into extract via the builder.** `urlPattern` derives `TParams` from
   `:segments`; the page builder threads it into every binding's `ctx.params`, and into `validate`
   and `fixtures`.
3. **`defineSite` fails fast on run-blockers only** (`path-parse`, `invalid-schema`, `bad-key`).
   `presence`-mandatory is a test gate, not a run gate.
4. **The DSL emits plain data.** `defineSite(...)` is a `SiteDefinition` — inert data the runner
   executes; no DSL type or runtime crosses into `@sitely/runtime`.
5. **TypeBox is recommended, not required.** Any JSON-Schema producer works at runtime; only
   `Static<>` field-level inference is TypeBox-specific.
6. **An asset field function returns a typed `{ url, type }`** (via `asset.<kind>(url)`), matching its
   `asset(kind)` schema.

## Behaviour & edge cases

- **Field-function type mismatch** (`headline: () => 42` where the schema says `string`) → compile
  error at the `p.one`/`p.many` call.
- **A `p.many` extract returning a single object** → compile error.
- **Unparseable `path` / invalid schema / bad `key`** → `validateSite`, `defineSite` throws.
- **Optional field without `presence()`** → **not** a `defineSite` error; the scraper runs. `sitely
  test` flags it (`04`); `sitely dev` warns.
- **Raw JSON Schema (non-TypeBox) resource** → runs at runtime; `Static<>` is `unknown`, so its field
  functions aren't type-checked (documented trade-off).
- **A resource symbol defined but used by no page** → not an error; it just isn't in the registry.

## Acceptance criteria

- **Type-test suite** (compile-time): a field-type mismatch, a `p.many`-returns-non-array, and a
  `urlPattern` param check each fail to compile; a correct site compiles; `validate`/`fixtures[i]`
  `ctx.params` is typed to the page path; `asset.image(url)` is assignable to `Static<asset("image")>`.
- **`validateSite`** catches each run-blocker with a precise `where`; **`defineSite` throws** those but
  **not** a missing-`presence` case (a package with un-annotated optionals still `defineSite`s and
  runs).
- **Helpers:** `asset(kind)` emits the object schema + keyword; `asset.<kind>(url)` returns the typed
  object; `presence` emits `x-sitely-presence`.

## Open questions

- **`const`-generic + builder inference.** The result shape leans on capturing `E` from `extract(p)`'s
  return with a `const` type parameter through the builder. Verify inference holds (and error
  messages stay legible) on real nested TypeBox schemas before locking the signatures.
- **`asset` value-helper ergonomics.** `asset.image(url)` overloads the `asset` function with methods;
  confirm that reads well and types cleanly, vs separate named helpers.
- **Eager vs lazy `defineSite` validation.** Throwing is best for authoring fail-fast; a
  `{ throwOnError?: false }` escape may be worth it for programmatic/site-generation callers that want
  to inspect errors.
