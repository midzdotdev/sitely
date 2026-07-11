# 05 · URL codec

The standalone URL codec — a typed, reversible pattern over a URL's **path + query**, published as
its own package with nothing sitely-specific in it. It is the true root of the build order (built
**first**; spec file numbers are stable IDs, not build positions): [`00`](./00-contracts) re-exports
the `URLCodec` type, [`03`](./03-framework-dsl) re-exports the `urlCodec` factory, and
[`04`](./04-framework-test)'s `path-codec` check property-tests every page's codec.

## Purpose & dependencies

**Purpose.** One object that both *recognises* URLs (`fromUrl`: does this URL belong here, and with
what params?) and *produces* them (`toUrl`: the canonical URL for these params). Reversibility is the
contract — `fromUrl(toUrl(p))` recovers `p`, and `toUrl(fromUrl(url))` collapses any alias or noisy
real-world URL to one canonical form (the v1 cache key).

**Dependencies.** None. Origins arrive as a call-time `base`; `paramsSchema` values are opaque plain
objects; errors are codec-local. The package is usable by any router or link-builder, not just
sitely.

**Provenance (evaluated 2026-07-11).** Greenfield, with the `URLPattern` Web API as the grammar
reference. `@f-stack/typed-url-pattern` (JSR, MIT, v0.1.0 — its only release; repo dormant since) was
evaluated as a fork base and declined: it wraps *native* `URLPattern` and types params from a
user-supplied Standard Schema, so it provides none of the four load-bearing needs here —
template-literal param inference from the pattern string, aliases with canonical collapse, origin at
call time, and a restricted reversible grammar. Two of its choices survive as design references: a
typed `href()` inverse (evidence the inverse composes with `URLPattern` semantics) and by-name search
matching that tolerates `utm` noise (independent convergence on the same deviation). Schema-library
note for the sitely side: TypeBox was renamed — `typebox` (1.x) vs `@sinclair/typebox` (0.34.x, which
the design probes ran against); pin the choice when implementation starts.

## Public interface

```ts
function urlCodec<P extends string>(
    canonical: P,
    opts?: {
        aliases?: string[];      // match-only alternates; must expose the same params (construction throws)
        paramsSchema?: Partial<Record<keyof ExtractParams<P>, Record<string, unknown>>>;   // per-param JSON Schema; metadata only
    },
): URLCodec<ExtractParams<P>>;

type ExtractParams<P extends string> = /* template-literal type over the grammar — in the path AND
   the query tail: ":name" → { name: string }, ":name?" → { name?: string }. */;

interface URLCodec<TParams extends Record<string, string> = Record<string, string>> {
    readonly canonical: string;
    readonly aliases: readonly string[];
    readonly paramsSchema?: Readonly<Partial<Record<keyof TParams, Record<string, unknown>>>>;
    toUrl(params: TParams, opts?: { base?: string | URL }): string;
    fromUrl(url: string | URL, opts?: { base?: string | URL }): TParams | null;
}

class URLCodecError extends Error {
    readonly kind: "invalid-pattern" | "alias-params-mismatch" | "missing-param" | "empty-param";
}
```

### Grammar — the reversible subset

A pattern is a root-relative path, optionally followed by a query tail:

- **Path:** literal segments and named params — `/item/:id`; optional with `?` —
  `/r/:sub/comments/:id/:slug?`.
- **Query:** `?` + `&`-separated pairs — named `?id=:id`, optional `?p=:p?`, or **literal**
  `?type=job` (a literal pair must be present with exactly that value to match, and `toUrl` emits it).
- **Rejected at construction** (`invalid-pattern`): wildcards (`*`) and `(regex)` groups. They cannot
  round-trip through `toUrl`, and their param exposure breaks the same-params rule across aliases.
  Loosening the grammar later is non-breaking; the reverse is not.

Matching is deterministic: segments match greedily left-to-right; an optional segment matches when
its boundary allows it and stays absent otherwise; a pattern that admits two parses of the same path
is rejected at construction (`invalid-pattern`).

### Encoding

- Param values are **decoded strings** on both sides of the codec.
- `toUrl` percent-encodes per component (`encodeURIComponent` semantics per path segment / query
  value); `fromUrl` decodes. A value containing `/` round-trips as `%2F` within one segment.
- Param values must be **non-empty**: `toUrl` throws `missing-param` for an absent required param and
  `empty-param` for `""` (an empty segment cannot be re-recognised). Optional params are omitted
  entirely — no dangling `/` or `=`.
- `toUrl` without `base` returns a root-relative path starting with `/`.

### `base` — origins at call time

A codec carries no origin; one codec value is valid for any origin. `base` (`string | URL`)
contributes **origin only** (`scheme://host[:port]`); paths are root-relative, so any path component
in `base` is ignored (WHATWG-`URL` resolution with a leading-`/` path).

- `toUrl(p, { base })` → an absolute URL on `base`'s origin.
- `fromUrl(url, { base })` → if `url` is absolute, its origin must equal `base`'s (WHATWG
  `URL.origin` equality, default ports normalised) or the result is `null`; matching then proceeds on
  path + query.
- `fromUrl(url)` without `base` → a relative input matches directly; an absolute input matches on its
  path + query with the origin unchecked.

### Deviations from `URLPattern` (deliberate, with reasoning)

The codec aligns with the
[`URLPattern` Web API](https://developer.mozilla.org/en-US/docs/Web/API/URL_Pattern_API) pathname
grammar. It deviates where `URLPattern` semantics defeat the purpose:

1. **Query params match by name, order-insensitive; undeclared params are ignored.** `URLPattern`
   matches `search` as one ordered string; real query strings reorder freely and carry tracking noise
   (`utm_*`), which would make every captured URL unmatchable.
2. **`toUrl` exists.** `URLPattern` is match-only; reversibility is this package's point.
3. **The grammar is restricted to the reversible subset.** Wildcards and regex groups can't
   round-trip and break alias-param equality — rejected at construction rather than silently
   second-class.
4. **Fragments are ignored** by `fromUrl`. A `#fragment` is client-side state, never part of
   server-visible page identity.
5. **Origin is a call-time `base`, not a pattern component.** One codec serves any origin; patterns
   stay portable and the package stays generic.
6. **The name.** `URLCodec`, because it is a bidirectional codec, not a pattern — and to avoid
   shadowing the platform `URLPattern` global.

## Invariants

1. **Round-trip.** ∀ valid params `p`: `fromUrl(toUrl(p))` deep-equals `p`.
2. **Alias collapse.** ∀ `p` and every alias: the alias-form path for `p` parses back to `p`, and
   `toUrl(fromUrl(aliasPath))` equals `toUrl(p)` — one canonical form.
3. **Canonical emission.** `toUrl` builds only from the canonical pattern.
4. **Same params everywhere.** Canonical and aliases expose identical `TParams`
   (construction-checked; `alias-params-mismatch`).
5. **Noise-immunity.** Undeclared query params and fragments never affect a match's result params.
6. **Origin-agnostic.** Match/build results are identical for any `base` with an equal origin; a
   codec value never stores an origin.
7. **`fromUrl` never throws** on any string input — a non-match is `null`. `toUrl` throws
   (`URLCodecError`) only for missing/empty params.

## Behaviour & edge cases

- **Extraneous query params** (`/item?id=1&utm_source=x`) → matched; extraneous ignored → `{ id: "1" }`.
- **Fragment** (`/item?id=1#comments`) → ignored; same result.
- **Origin mismatch with `base`** → `null`, not an error — the URL simply isn't this site's.
- **Missing required param in `toUrl`** → throws `missing-param`; a `""` value → throws `empty-param`.
- **Optional param absent** → `toUrl` omits the segment/pair entirely.
- **Percent-encoded input** (`/item/a%2Fb`) → one segment, decoding to `a/b`; `toUrl` re-encodes it.
- **Unicode** → decoded params carry the unicode value; `toUrl` re-encodes (UTF-8 percent-encoding).
- **A literal query pair with the wrong value** (`?type=cars` against a declared `?type=job`) → no
  match.
- **Duplicate query keys in the input** (`?id=1&id=2`) → the first occurrence wins; the rest are
  treated as noise.
- **An alias exposing different params** → `urlCodec()` throws `alias-params-mismatch`.
- **A wildcard or regex group in any pattern** → `urlCodec()` throws `invalid-pattern`.

## Acceptance criteria

- **Property-based (fast-check, fixed seed):** round-trip; alias collapse (alias paths built via each
  alias's own single-pattern codec); noise-immunity (`fromUrl` of `toUrl(p)` with `&utm_source=x` or
  `#frag` appended recovers `p`); optional params exercised both present and absent by the generator.
- **Type-level:** `urlCodec("/item?id=:id")` is `URLCodec<{ id: string }>`;
  `urlCodec("/r/:sub/:slug?")` gives `{ sub: string; slug?: string }`; a `toUrl` call missing a
  required param is a compile error.
- **Encoding table:** the edge cases above (`%2F`, unicode, empty values, duplicate keys) behave as
  specified on both `toUrl` and `fromUrl`.
- **Construction rejections:** a wildcard, a regex group, an alias-params mismatch, and an ambiguous
  optional arrangement each throw a `URLCodecError` with the right `kind`.
- **`base` semantics:** origin equality (including default-port normalisation) decides
  absolute-input matches; `toUrl` with `base` produces an absolute URL whose path + query equal the
  baseless result.

## Open questions

- **Registry name.** `URLCodec` is the type; the published package needs an available npm/JSR name —
  decide at implementation (nothing in sitely depends on the name).
- **Ambiguity rule detail.** "Rejected at construction" needs a precise definition of *ambiguous*
  (adjacent optionals, optional-before-literal collisions); pin it against the first property-test
  counterexamples during implementation.
- **`paramsSchema` at match time.** v0 treats it as metadata (04's generator reads it). Enforcing it
  in `fromUrl` (schema-violating value → `null`) is a possible v1 refinement — it would change page
  resolution and `path-url-match` semantics, so it must be a deliberate flip, not a drive-by.
