# 03 · @sitely/framework — DSL

The package authors import. It provides the factories that turn TypeBox schemas + extract logic into
the standalone symbols the [runner](./02-runtime) executes and the [harness](./04-framework-test)
tests — `resource`, `page`, `defineSite`, `urlCodec`, `defineInterface` — plus the `presence` /
`asset` helpers and the fail-fast structural validation `defineSite` runs. Its real job is the
**authoring-side type-safety**: the generics that make a field function a *compile error* if it
doesn't match its resource's schema, and the page builder that types `ctx.params`.

## Purpose & dependencies

**Purpose.** The authoring DSL, its compile-time safety, and fail-fast validation of *run-blocking*
mistakes. It produces plain data — a `SiteDefinition` — with no runtime coupling to the runner.

**Dependencies.** [`00 · contracts`](./00-contracts) (the `Resource`/`PageDef`/`Binding`/`SiteDefinition`
types, `ExtractContext`/`PageController`, `Asset`/`AssetType`/`MediaFormat`, `Interface`, errors,
`JsonSchema`), the **standalone URL-codec package** ([05](./05-url-codec); re-exported as `urlCodec`),
and **TypeBox** (the recommended schema producer — the source of `Static<>`; note the package rename,
`typebox` 1.x vs `@sinclair/typebox` 0.34.x — pin the choice at implementation start).

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

### `defineInterface` — a named schema claim

```ts
// The Interface type is declared in 00. TypeBox overload (Static<> gives T) + the raw escape hatch:
function defineInterface<N extends string, S extends TSchema>(name: N, schema: S): Interface<N, Static<S>>;
function defineInterface<N extends string>(name: N, schema: JsonSchema): Interface<N, unknown>;
```

An `Interface` is the G2 interop unit — *data of type `name`, shaped like `schema`*. In v0 authors
mint **partial** interfaces as parse contracts for `ctx.jsonLd`: schema only the fields you use — a
partial is *tighter* than the full schema.org type (which is all-optional unions) and doubles as a
drift tripwire, because when the site reshapes its embed the parse starts dropping and the
diagnostics say so.

```ts
const JobPostingLd = defineInterface("JobPosting", Type.Object({
    title: Type.String(),
    hiringOrganization: Type.Object({ name: Type.String() }),
}));

// inside extract:
const [job] = ctx.jsonLd(JobPostingLd);   // job: { title: string; hiringOrganization: { name: string } }
```

In v1 the generated schema.org catalogue is a set of `Interface` values and `resource`'s `implements`
option takes them — the same primitive, no new concepts. A `Resource` is deliberately **not** an
`Interface`: its `name` is site-local vocabulary (`"story"`), not schema.org identity, and the `kind`
discriminant makes `ctx.jsonLd(someResource)` a compile error rather than a silent non-match.

### `urlCodec` — inferred params, multi-path

```ts
type ExtractParams<P extends string> = /* template-literal type over the reversible grammar — in the
   path AND the query tail: ":name" → { name: string }, ":name?" → { name?: string }. */;

// From the standalone URL-codec package (05), re-exported here.
function urlCodec<P extends string>(
    canonical: P,
    opts?: { aliases?: string[]; paramsSchema?: Partial<Record<keyof ExtractParams<P>, JsonSchema>> },
): URLCodec<ExtractParams<P>>;
```

`urlCodec("/item?id=:id")` is `URLCodec<{ id: string }>` — authors state **paths only**; origins are
the runner's business, passed as `base` at call time. A page may match **multiple** patterns that
converge on one canonical — `urlCodec("/product/:slug/:id", { aliases: ["/p/:id"] })` matches either,
and `toUrl` always emits the canonical `/product/:slug/:id`. Grammar and alias-params errors throw at
construction (`URLCodecError` — the codec enforces its own invariants; see [05](./05-url-codec)).
`paramsSchema` is per-param **metadata**: it documents each param and seeds the generator for the
property-based [`path-codec`](./04-framework-test) check; it is *not* enforced at match time in v0.

### `page` — binds params, collects bindings via a builder

`prepare` lives only in the `render: "dynamic"` arm, and the static arm declares `prepare?: never` —
so a static page can't declare it **even with `render` omitted** (a compile error, matching
[00's `PageDef`](./00-contracts)):

```ts
interface PageBuilder<TParams extends Record<string, string>> {
    one<N extends string, T>(r: Resource<N, T>,  extract: (ctx: ExtractContext<TParams>) => FieldFns<T>):    Binding<N, T, "one">;
    many<N extends string, T>(r: Resource<N, T>, extract: (ctx: ExtractContext<TParams>) => FieldFns<T>[]):  Binding<N, T, "many">;
}

function page<TParams extends Record<string, string>, const E extends Record<string, Binding>>(
    def:
        | {   // static (default): fetch, no interaction phase
              render?: "static";
              path: URLCodec<TParams>;
              validate: (ctx: ExtractContext<TParams>) => boolean;
              prepare?: never;                                      // compile error even when `render` is omitted
              extract: (p: PageBuilder<TParams>) => E;              // the builder carries TParams into each binding
              fixtures: FixtureSpec<TParams>[];
          }
        | {   // dynamic: browser render; `prepare` allowed
              render: "dynamic";
              path: URLCodec<TParams>;
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
page has no `name` of its own). The erasure is a **deliberate variance cast**: under
`strictFunctionTypes`, a `Binding` whose `extract` takes `ExtractContext<{ id: string }>` is not
assignable to the default `Binding` (`Record<string, string>` is not assignable to `{ id: string }` —
compiler-verified), so `page()` casts at the erase point; do not "fix" the cast by weakening the
typed builder.

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
// asset(kind) — the GENERIC schema helper (see 00): Static<> recovers the literal `type`. Emitted
// schemas are CLOSED (additionalProperties: false) and carry `format` only for video/audio, so a
// nonsense combination ({ type: "image", format: "hls" }) fails validation, not just compilation.
const asset: {
    <K extends AssetType>(kind: K): TObject</* url: TString; type: TLiteral<K>;
        format: TOptional<TUnion<MediaFormat>> — video/audio only; mimeType: TOptional<TString> */>;
    image(url: string, opts?: { mimeType?: string }): Asset<"image">;                       // value helpers return the
    video(url: string, opts?: { format?: MediaFormat; mimeType?: string }): Asset<"video">; //   LITERAL kind (Asset<K>),
    audio(url: string, opts?: { format?: MediaFormat; mimeType?: string }): Asset<"audio">; //   so each matches its
    document(url: string, opts?: { mimeType?: string }): Asset<"document">;                 //   asset(kind) schema
};

// presence — wraps an optional/nullable field's schema with its expected-present rate. The rate is
// type-level-guarded to a number literal in [0,1] (template-literal analysis — compiler-verified;
// the tuple in the false branch makes the error message self-explanatory) and range-checked at
// runtime for JS callers and casts:
function presence<S extends TSchema, N extends number>(
    schema: S,
    rate: `${N}` extends "0" | "1" | `0.${string}` ? N : ["presence(): rate must be a number literal in [0,1]; got", N],
): S;   // + "x-sitely-presence": rate; throws RangeError at runtime if an out-of-range value sneaks past the types
```

So authoring an asset field stays lean and type-checked — the field function returns the typed
object, and a miss is a **thrown signal**, never silent empty data (a `{ url: "" }` would validate
and defeat the drift telemetry the field-function design exists for):

```ts
heroImage: () => {
    const src = ctx.$('meta[property="og:image"]')?.attr("content");
    if (!src) throw new MissingDataError({ field: "heroImage", detail: "og:image absent" });
    return asset.image(src);     // { url, type: "image" } — matches the resource's asset("image") schema
},
stream: () => asset.video(manifestUrl, { format: "hls" }),
//   → { url, type: "video", format: "hls" } — a manifest the consumer plays with an HLS player
```

Asset `url`s are stored **as found**; when a page emits a relative reference, resolve it yourself
(`new URL(src, ctx.url).href`) — sitely never rewrites media URLs.

### Static validation (run-blockers only)

```ts
interface SiteValidationError { kind: "path-parse" | "invalid-schema" | "bad-key" | "invalid-origin"; where: string; message: string }
function validateSite(site: SiteDefinition): SiteValidationError[];

// defineSite throws this on any run-blocker (authors and the CLI switch on it):
class SiteDefinitionError extends FrameworkError { readonly kind = "invalid-site"; readonly errors: SiteValidationError[] }
```

Only the mistakes that stop a scraper from *running*:

- **`path-parse`** — the page's `path` is not a usable `URLCodec` (not an object exposing
  `canonical`/`toUrl`/`fromUrl`; reachable from plain JS, e.g. a raw string passed as `path`).
  Grammar and alias-params errors throw **earlier**, at `urlCodec()` construction — the codec
  enforces its own invariants, so by the time `defineSite` runs, every DSL-built path is already
  valid.
- **`invalid-schema`** — a resource `schema` that isn't a valid JSON Schema object.
- **`bad-key`** — a resource `key` naming a field its schema doesn't have.
- **`invalid-origin`** — the site `origin` doesn't parse as a `scheme://host[:port]` origin.

`presence`-mandatory is **not** here — it's a `sitely test` check ([04](./04-framework-test)).

### Re-exports

The [error classes](./00-contracts) and the `ExtractContext`/`Interface` types ([00](./00-contracts)),
plus `urlCodec`/`URLCodec` from the codec package ([05](./05-url-codec)) — so a package imports
everything it needs from `@sitely/framework`.

## Invariants

1. **Field functions type-check against their resource's schema.** A field function whose return type
   doesn't match `Static<schema>` is a compile error — the core of authoring safety.
2. **Params are inferred and typed into extract via the builder.** `urlCodec` derives `TParams` from
   `:params` (path segments and query pairs); the page builder threads it into every binding's
   `ctx.params`, and into `validate` and `fixtures`.
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
- **A malformed pattern or alias-params mismatch** → `urlCodec` throws at construction
  (`URLCodecError`); it never reaches `defineSite`. **Invalid schema / bad `key` / invalid `origin` /
  a non-codec `path`** → `validateSite` reports; `defineSite` throws `SiteDefinitionError`.
- **Optional field without `presence()`** → **not** a `defineSite` error; the scraper runs. `sitely
  test` flags it (`04`); `sitely dev` warns.
- **Raw JSON Schema (non-TypeBox) resource** → compiles via the overload and runs; `Static<>` is
  `unknown`, so its field functions aren't type-checked (documented trade-off).
- **A resource symbol defined but used by no page** → not an error; it's simply unreferenced.

## Acceptance criteria

- **Type-test suite** (compile-time): a field-type mismatch, a `p.many`-returns-non-array, a `prepare`
  on a static **or render-omitted** page, an out-of-range `presence` rate literal (`1.5`, `-0.25`),
  a `urlCodec` param check, and `ctx.jsonLd(someResource)` (no `kind` discriminant) each fail to
  compile; a correct site compiles; `validate`/`fixtures[i]` `ctx.params` is typed to the page's path
  **and query** params; `asset.image(url)` is assignable to `Static<asset("image")>` and
  `asset.video(url, { format: "hls" })` to `Static<asset("video")>` (the generics carry the literal);
  `ctx.jsonLd(defineInterface(…))` returns the schema's `Static<>` type; a raw-`JsonSchema` `resource`
  compiles with `T = unknown`.
- **`validateSite`** catches each run-blocker with a precise `where`; **`defineSite` throws**
  `SiteDefinitionError` for those but **not** for a missing-`presence` case. A malformed pattern or
  alias-params mismatch throws at `urlCodec()` construction instead.
- **Helpers:** `asset(kind)` emits the closed object schema + keyword (`format` for video/audio only);
  `asset.<kind>(url, opts?)` returns the typed literal-kind object; `presence` emits
  `x-sitely-presence` and throws at runtime on an out-of-range cast; `defineInterface` returns a
  `kind: "interface"` symbol whose `name`/`schema` drive `ctx.jsonLd`.

## Open questions

- **`const`-generic + builder inference.** The result shape leans on capturing `E` from `extract(p)`'s
  return with a `const` type parameter through the builder. Verify inference holds (and error
  messages stay legible) on real nested TypeBox schemas before locking the signatures.
- **`ExtractParams` grammar coverage.** The typed/`toUrl`-able grammar is named + optional params in
  the path **and the query tail**; confirm the template-literal type and the codec's `toUrl` agree on
  optional handling (path segments *and* query pairs) before locking the signatures.
- **Eager vs lazy `defineSite` validation.** Throwing is best for authoring fail-fast; a
  `{ throwOnError?: false }` escape may be worth it for programmatic/site-generation callers that want
  to inspect errors.
