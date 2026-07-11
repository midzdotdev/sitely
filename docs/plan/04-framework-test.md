# 04 · @sitely/framework — test / CLI

The harness that runs a site package against its committed fixtures, and the `sitely` commands
authors live in: `test`, `dev`, `snapshot`. It ties the tree together — it calls
[`02`'s `runExtractionOnDriver`](./02-runtime) against a `CheerioDriver` built from each fixture's
HTML **and `meta.json`** (`url`/`status`/`headers`, so captured non-200s replay faithfully) and
asserts the [`RunnerResult`](./00-contracts). It's also where the **`presence` quality gate** lives.

## Purpose & dependencies

**Purpose.** Prove a package correct and reproducible against committed HTML, and give authoring its
tight loop. The harness runs **in-process** — site code and the harness in the same Node process, no
isolation (the trust boundary is the lockfile, same as any dependency; managed isolation is v1).

**Dependencies.** [`03 · DSL`](./03-framework-dsl) (loads the `SiteDefinition`, reuses `validateSite`),
[`02 · runtime`](./02-runtime) (`runExtractionOnDriver` for the fixture path, `runExtraction` for
`snapshot`, `validateExtraction` for `schema-conformance`), [`01 · page`](./01-page) (`CheerioDriver`,
`StaticBackend`, `PlaywrightBackend`), [`00`](./00-contracts). The `presence`-detection rule is
defined **here** (below), not in 03.

## Where a rule lives — the three gates

Each stage is allowed a different *kind* of failure. This is the rule for deciding where any new
check belongs:

- **`defineSite` / `validateSite` ([03](./03-framework-dsl)) — "is it well-formed?"** Throws
  immediately, no fixtures. Only what makes the definition *inoperable* — `path-parse`,
  `invalid-schema`, `bad-key`, `invalid-origin`. Nothing below lives here.
- **`sitely dev` — "how's it going?"** The author loop: **warns, never fails.** It surfaces
  everything `test` will block on, as non-blocking diagnostics, so a half-built package still runs.
- **`sitely test` — "is it shippable?"** The **publish gate** — blocks. The package is well-formed
  and runs, but must clear the bar to ship: completeness, proof, self-consistency. Every check in
  this spec lives here.

Two v1 stages finish the picture. **`sitely build`** is a pure transformation — a well-formed
definition → an artifact — that needs *only* `defineSite`: it is **safe to build an untested
package** for local use, and never runs the `test` gate. **Publishing** is where the gate binds:
`publish ⊇ test` (green tests required before an artifact is distributed). The safety boundary is
*distribution*, not artifact-production.

Decision rule: inoperable without it → `defineSite`; a bar for shipping → `test` (mirrored as a
`dev` warning); purely advisory → `dev` warning only.

## Loading the package

Before any check runs, the CLI locates the package's entry module (its `package.json` `"exports"` /
`"main"`), imports it, and takes the `SiteDefinition` from the **default export**
(`export default defineSite({ … })`). It validates that export *is* a `SiteDefinition` (a shape
check) and fails clearly otherwise — `no-site-export` (nothing exported) or `not-a-site` (the default
export isn't a `SiteDefinition`). A load-time precondition, not a per-fixture check.

## Fixtures on disk

Per page, per params-hash. The fixture *is* the settled, post-`prepare` DOM.

```
fixtures/
└── <page-name>/
    ├── <hash>.html          # captured HTML (post-prepare for dynamic pages)
    ├── <hash>.expected.json # what extract should produce (omitted for errorCase fixtures)
    └── <hash>.meta.json     # url, status, headers (names lowercased at capture), fetchedAt
```

`<hash>` is a short stable hash of the fixture's `params` (`sha256(canonicalize(params)).slice(0,12)`).

**Code is the source of truth** for the fixture↔disk linkage. The declared `FixtureSpec`s drive
everything: a spec whose `<hash>.html` is missing fails `fixture-presence` with a "run `sitely
snapshot`" hint; on-disk files matching no declared spec are **warned about** and run nothing; two
specs with identical `params` (⇒ identical hash) fail `fixture-presence`; and `snapshot` warns when
its captured params match no declared spec (the files are written, but no check reads them until a
spec is added).

## The v0 checks

Must-pass (a package isn't shippable until all pass); all run by `sitely test`. Two groups —
**definition** checks (no fixtures; a property of the `SiteDefinition` itself) and **fixture** checks
(run in-process against committed HTML).

**Definition checks**

| Check | Asserts |
|---|---|
| `site-nonempty` | the site defines at least one page. |
| `page-nonempty` | each page's `extract` binds at least one resource (no empty-binding page). |
| `path-codec` | each page's `URLCodec` is a faithful codec whose aliases all collapse to the canonical — property-based (rule below). |
| `resource-name-unique` | no two resources bound anywhere in the site share a `name` — the v1 catalogue and GraphQL type names key on it (a cheap definition check now beats a corrupted catalogue later). |

**Fixture checks**

| Check | Asserts |
|---|---|
| `fixture-presence` | each page declares ≥ 1 `FixtureSpec`, all spec `params` are pairwise distinct, and every declared spec has its `<hash>.html` on disk; at least one *happy* fixture extracts populated data — a non-empty array for a `many` output, or an item with ≥ 1 resolved field for a `one`. |
| `fixture-extraction` | for each happy fixture, `runExtractionOnDriver` returns `ok` and `data` deep-equals `<hash>.expected.json` (stable-serialized) — the *run reproduces the expected value*. |
| `schema-conformance` | the committed `<hash>.expected.json`, taken as data, validates per output against its binding's resource schema (`many` → each element). Its value over `fixture-extraction` is **localization**: when extraction breaks, it still says whether the committed file itself is sane (stale/hand-edited vs a broken extractor), and it runs even when extraction fails. (An `expected.json` that deep-equals an `ok` run necessarily conforms — the runner validated it — so this check never fails alone.) |
| `determinism` | two runs on the same fixture yield byte-identical `data`. Catches `Date.now()`, `Math.random()`, iteration-order leakage. |
| `error-path-coverage` | each `errorCase` fixture yields `rejected`; if the fixture pinned a reason (`errorCase: "captcha"`), the reason matches. |
| `presence-coverage` | every optional/nullable field in a resource schema carries `x-sitely-presence` (rule below). |
| `path-url-match` | for each fixture, `page.path.fromUrl(meta.url, { base: site.origin })` deep-equals the declared `params` — the codec matches the URL the fixture was captured from, with origin equality enforced, fragments ignored, and undeclared query noise (`utm_…`) tolerated by construction. |

Warning-only (surface in output, don't block):

- `fixture-coverage` — for each optional/nullable field, fixtures collectively cover both the present
  and absent case (so both branches of the extractor are exercised).
- `fixture-freshness` — a fixture's `meta.fetchedAt` is old (warn well before it's meaningless).

### The `presence-coverage` rule

Resolve local refs, then walk each resource's JSON Schema **recursively**: same-document `$ref`s
(`#/$defs/…`, `#/definitions/…`) are dereferenced first, with a visited-set so cyclic schemas
terminate; any **external** `$ref` fails the check with `unsupported-external-ref` naming the pointer
(explicit v0 scope, not silence). The walk visits every subschema that types a data location —
`properties.*`, `items`/`prefixItems`, and each `anyOf`/`oneOf`/`allOf` branch. A property **requires
`presence`** if it is:

- **optional** — its key is absent from its parent object's `required`, **or**
- **nullable** — its schema admits `null`: a `type` of/including `"null"`, an `anyOf`/`oneOf` branch
  that does, a `const: null`, or an `enum` containing `null`.

Such a property must carry `x-sitely-presence` on its top-level schema object (which `presence()`
adds), and the keyword's **value** must be a number in `[0,1]` — checked here too, catching
hand-written schemas that bypass the typed helper. A failure names the property's JSON Pointer and
which rule (optional, nullable, or both) triggered. The rule reads the JSON Schema — `required`,
`anyOf`, `oneOf`, `type` — not TypeBox internals, so it holds for any producer:

| Author writes | JSON Schema | Verdict |
|---|---|---|
| `Type.String()` | in `required`, no null | no presence needed |
| `Type.Optional(Type.String())` | omitted from `required` | needs presence |
| `Type.Union([Type.String(), Type.Null()])` | `anyOf` with `{type:"null"}` | needs presence |
| `Type.Optional(Type.Union([…, Type.Null()]))` | both | needs presence |

A missing annotation fails `presence-coverage` (test/CI) and **warns** in `sitely dev` — it never
blocks running.

### The `path-codec` check (property-based)

`URLCodec` must be a faithful codec, and `toUrl` must emit the **canonical** form
([00](./00-contracts)). Verified with property-based testing (**fast-check**), fixture-free — the
generator comes from the pattern: each `:param` (path or query) → a non-empty, slash-free string,
refined by the codec's exposed `paramsSchema`; optional params are exercised both present and absent.
Over a fixed seed (so it stays deterministic):

- **Round-trip** — ∀ params `p`: `fromUrl(toUrl(p))` deep-equals `p`.
- **Alias-canonicalisation** — ∀ params `p` and each **alias** pattern: build the alias-form path via
  a single-pattern codec over that alias (`urlCodec(alias)` — the public surface suffices), and assert
  `fromUrl(aliasPath)` recovers `p` *and* `toUrl(fromUrl(aliasPath)) === toUrl(p)` — every alias
  collapses to the one canonical form. This is where canonicalisation has teeth: the alias forms are
  the genuinely *non-canonical* inputs (feeding only `toUrl(p)` back would be trivially canonical and
  would test nothing).
- **Noise-immunity** — ∀ params `p`: `fromUrl` of `toUrl(p)` with `&utm_source=x` or a `#fragment`
  appended still deep-equals `p` — undeclared query params and fragments never affect the result.

It also round-trips each fixture's *real* `params` — real values catch encoding cases a synthesized
`"1"` won't. (A pattern that fails to *parse* throws at `urlCodec()` construction; `path-codec`
catches a lossy codec or a broken alias-collapse.)

## The CLI

```
sitely test [--only <check>] [--update [<page>[/<hash>]]] [--watch] [--strict]
sitely dev  [--only <page>] [--fixture <hash>]
sitely snapshot <url> | --page <name> '<params-json>' [--overwrite]
```

- **`sitely test`** — runs the checks and prints pass/fail per check with a diff on mismatch.
  Bare `--update` rewrites **every** happy fixture's `expected.json` from current output;
  `--update <page>` limits it to one page, `--update <page>/<hash>` to one fixture (review the diff
  before committing). `--watch` re-runs on file change; `--strict` also fails on the warning-only
  checks. This is the pre-commit / CI gate.
- **`sitely dev`** — the tight loop: on every save, re-run each page's `validate` + `extract` against
  its fixtures and print a per-field **value diff against the previous watch-run** (`~ field old →
  new`; the first run diffs against `expected.json` where present), the `ok` result's `fieldErrors`
  as per-field absence warnings, and `presence`/coverage **warnings** (never errors). No server, no
  live fetch — it reads `fixtures/` and runs in-process.
- **`sitely snapshot`** — capture a fixture: resolve `(page, params)` from the URL by probing each
  page's patterns individually with `{ base: site.origin }` (single-pattern codecs over
  `path.canonical` and each alias — the same public-surface technique `path-codec` uses; a combined
  `path.fromUrl` couldn't say *which* pattern matched), in two passes: **canonical patterns first**
  in `pages`-record order, then aliases in record order, so a canonical match on any page beats an
  alias-only match — or from `--page` + params, run [`02`'s `runExtraction` lifecycle](./02-runtime)
  (`launch → prepare → materialize`) against the right backend — `PlaywrightBackend` for a
  `render: "dynamic"` page, `StaticBackend` (fetch → `CheerioDriver`) otherwise — and write the
  settled `<hash>.html` + `<hash>.meta.json`. `--user-agent`/`--headers` thread through
  `runExtraction`'s `launch` option to [`LaunchOptions`](./01-page) for auth-walled sites. It ignores
  robots.txt (an explicit author action, not server traffic). For a dynamic page, the capture runs
  `prepare`, so the committed HTML is already post-interaction.

## Invariants

1. **Tests run against committed fixtures, never live.** Reproducible by construction; the site can
   change under you and CI won't flake. Live re-capture is an explicit `snapshot`.
2. **The harness calls the same `runExtractionOnDriver` the server uses.** No test-only extraction
   path; what passes here is what runs in production.
3. **All checks must pass** for a package to be shippable; there is no extra check hiding in a
   reviewer's head (human review is a v1 directory concern).
4. **`presence-coverage` is enforced here, not at `defineSite`.** Authoring and `sitely dev` never
   block on it; `sitely test`/CI do.
5. **`sitely dev` is diagnostics-only** — it warns (presence, coverage) but never fails; failing is
   `sitely test`'s job.

## Behaviour & edge cases

- **A happy fixture has no `expected.json`** → `fixture-extraction` fails with a clear message
  (add one, or mark the fixture `errorCase`).
- **A fresh `snapshot`** writes `<hash>.html` + `<hash>.meta.json` only; run `sitely test --update` (or
  hand-author) to add the `<hash>.expected.json` a happy fixture needs before `fixture-extraction`
  passes.
- **An `errorCase` fixture whose run is `ok`** (validate accepted it) → `error-path-coverage` fails —
  `validate` is too permissive.
- **What `determinism` can and can't catch** → it catches in-process nondeterminism — `Date.now()`,
  `Math.random()`, mutable cross-run state — and diffs the two runs to show the field.
  Locale/timezone-dependent formatting is *cross-machine* nondeterminism: both runs share the process
  locale, so it surfaces as `fixture-extraction` failing on another machine (the committed
  `expected.json` was produced elsewhere), never as a `determinism` failure.
- **`snapshot` of a `render: "dynamic"` page on a machine without a browser** → fails clearly (needs
  the Playwright backend); static pages need no browser.
- **`snapshot` hits an auth wall** (e.g. LinkedIn) → capture from a logged-in browser session; the
  harness doesn't manage credentials (framework auth is v1). The resulting committed HTML tests
  offline like any other fixture.
- **`--update` on an `errorCase` fixture** → no-op (error fixtures have no `expected.json`).

## Acceptance criteria

- **Each check fires correctly** against crafted cases: a mismatched `expected.json` fails
  `fixture-extraction`; a hand-edited schema-invalid `expected.json` fails `schema-conformance`
  (alongside `fixture-extraction` — conformance localizes which side is wrong); a `Date.now()` in a
  field fails `determinism`; an `errorCase` fixture that `validate` accepts fails
  `error-path-coverage`; an un-annotated optional field fails `presence-coverage`; two resources
  sharing a `name` fail `resource-name-unique`; a site with no pages fails `site-nonempty`; a page
  with an empty `extract` fails `page-nonempty`; a lossy codec or an alias that doesn't collapse fails
  `path-codec`; a page with no declared fixture — or a declared spec missing its `<hash>.html`, or two
  specs with identical `params` — fails `fixture-presence`; a fixture whose `meta.url` doesn't
  `fromUrl` (with the site origin as `base`) to its declared `params` fails `path-url-match`.
- **The loader** rejects a package with no default export (`no-site-export`) and one whose default
  export isn't a `SiteDefinition` (`not-a-site`), before any check runs.
- **Warnings don't change exit code** unless `--strict`.
- **`sitely dev`** re-runs on save and surfaces per-field diffs + presence warnings without ever
  exiting non-zero.
- **`sitely snapshot`** produces a `<hash>.html` that `sitely test` can then extract from — including
  a dynamic page where the captured HTML is post-`prepare`.
- **The three example scrapers** (Reddit, LinkedIn, HN) each pass **all** checks against their
  committed fixtures — the v0 definition of done.

## Open questions

- **A hung field function wedges `sitely dev`'s watch loop.** Extraction is synchronous and un-timed
  (see [02](./02-runtime)), so a pathological selector blocks the loop until the process is killed —
  accepted as an author bug, though a coarse per-fixture wall-clock guard in `dev` may be worth it.
- **`snapshot` params ergonomics.** JSON on the CLI (`'{"id":"1"}'`) is clunky; a friendlier param
  syntax or an interactive prompt may be worth it.
- **Fixture hashing collisions.** 12 hex chars is comfortable for realistic fixture counts; revisit
  if a package ever approaches that scale.
