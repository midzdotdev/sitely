# 04 · @sitely/framework — test / CLI

The harness that runs a site package against its committed fixtures, and the `sitely` commands
authors live in: `test`, `dev`, `snapshot`. It ties the tree together — it calls
[`02`'s `runExtractionOnDriver`](./02-runtime) against a `CheerioDriver` built from each fixture and
asserts the [`RunnerResult`](./00-contracts). It's also where the **`presence` quality gate** lives.

## Purpose & dependencies

**Purpose.** Prove a package correct and reproducible against committed HTML, and give authoring its
tight loop. The harness runs **in-process** — site code and the harness in the same Node process, no
isolation (the trust boundary is the lockfile, same as any dependency; managed isolation is v1).

**Dependencies.** [`03 · DSL`](./03-framework-dsl) (loads the `SiteDefinition`, reuses `validateSite`
and the `presence`-detection rule), [`02 · runtime`](./02-runtime) (`runExtractionOnDriver` for the
fixture path, `runExtraction` for `snapshot`), [`01 · page`](./01-page) (`CheerioDriver`,
`PlaywrightBackend`), [`00`](./00-contracts).

## Fixtures on disk

Per page, per params-hash. The fixture *is* the settled, post-`prepare` DOM.

```
fixtures/
└── <page-name>/
    ├── <hash>.html          # captured HTML (post-prepare for dynamic pages)
    ├── <hash>.expected.json # what extract should produce (omitted for errorCase fixtures)
    └── <hash>.meta.json     # url, status, headers, fetchedAt
```

`<hash>` is a short stable hash of the fixture's `params` (`sha256(canonicalize(params)).slice(0,12)`).

## The v0 checks

Must-pass (a package isn't shippable until all pass); run in-process against committed fixtures.

| # | Check | Asserts |
|---|---|---|
| 1 | `fixture-extraction` | For each happy fixture, `runExtractionOnDriver` returns `ok` and `data` deep-equals `<hash>.expected.json` (stable-serialized). |
| 2 | `schema-conformance` | The same run is `ok`, not `validation-error` — extracted output conforms to each resource's schema. (A `schema-conformance` failure where `fixture-extraction` matches means the committed `expected.json` is itself wrong.) |
| 3 | `determinism` | Two runs on the same fixture yield byte-identical `data`. Catches `Date.now()`, `Math.random()`, iteration-order leakage. |
| 4 | `error-path-coverage` | Each `errorCase` fixture yields `rejected`; if the fixture pinned a reason (`errorCase: "captcha"`), the reason matches. |
| 5 | `presence-coverage` | Every optional/nullable field in a resource schema carries `x-sitely-presence` (the gate moved off `defineSite`). Rule below. |

Warning-only (surface in output, don't block):

- `fixture-coverage` — for each optional/nullable field, fixtures collectively cover both the present
  and absent case (so both branches of the extractor are exercised).
- `fixture-freshness` — a fixture's `meta.fetchedAt` is old (warn well before it's meaningless).

### The `presence-coverage` rule

Walk each resource's JSON Schema **recursively**. A property **requires `presence`** if it is:

- **optional** — its key is absent from its parent object's `required`, **or**
- **nullable** — its schema permits `null` (an `anyOf`/`type`-array branch of `null`).

Such a property must carry `x-sitely-presence` (which `presence()` adds). The rule reads the JSON
Schema — `required`, `anyOf`, `type` — not TypeBox internals, so it holds for any producer:

| Author writes | JSON Schema | Verdict |
|---|---|---|
| `Type.String()` | in `required`, no null | no presence needed |
| `Type.Optional(Type.String())` | omitted from `required` | needs presence |
| `Type.Union([Type.String(), Type.Null()])` | `anyOf` with `{type:"null"}` | needs presence |
| `Type.Optional(Type.Union([…, Type.Null()]))` | both | needs presence |

A missing annotation fails `presence-coverage` (test/CI) and **warns** in `sitely dev` — it never
blocks running.

## The CLI

```
sitely test [--only <check>] [--update <fixture>] [--watch]
sitely dev  [--only <page>] [--fixture <hash>]
sitely snapshot <url> | --page <name> '<params-json>' [--overwrite]
```

- **`sitely test`** — runs the checks and prints pass/fail per check with a diff on mismatch.
  `--update` rewrites a fixture's `expected.json` from current output (review the diff before
  committing); `--watch` re-runs on file change. This is the pre-commit / CI gate.
- **`sitely dev`** — the tight loop: on every save, re-run each page's `validate` + `extract` against
  its fixtures and print a per-field diff (from the `ok` result's `fieldErrors`), a `~ field old →
  new` for changes, and `presence`/coverage **warnings** (never errors). No server, no live fetch —
  it reads `fixtures/` and runs in-process.
- **`sitely snapshot`** — capture a fixture: resolve `(page, params)` from the URL (reverse-parse via
  the registered patterns) or from `--page` + params, run [`02`'s `runExtraction` lifecycle](./02-runtime)
  (`launch → prepare → materialize`) against the right backend — `PlaywrightBackend` for a page with
  `prepare`, static fetch otherwise — and write the settled `<hash>.html` + `<hash>.meta.json`. It
  ignores robots.txt (an explicit author action, not server traffic). For a dynamic page, the capture
  runs `prepare`, so the committed HTML is already post-interaction.

## Invariants

1. **Tests run against committed fixtures, never live.** Reproducible by construction; the site can
   change under you and CI won't flake. Live re-capture is an explicit `snapshot`.
2. **The harness calls the same `runExtractionOnDriver` the server uses.** No test-only extraction
   path; what passes here is what runs in production.
3. **All five checks must pass** for a package to be shippable; there is no sixth check hiding in a
   reviewer's head (human review is a v1 directory concern).
4. **`presence-coverage` is enforced here, not at `defineSite`.** Authoring and `sitely dev` never
   block on it; `sitely test`/CI do.
5. **`sitely dev` is diagnostics-only** — it warns (presence, coverage) but never fails; failing is
   `sitely test`'s job.

## Behaviour & edge cases

- **A happy fixture has no `expected.json`** → `fixture-extraction` fails with a clear message
  (add one, or mark the fixture `errorCase`).
- **An `errorCase` fixture whose run is `ok`** (validate accepted it) → `error-path-coverage` fails —
  `validate` is too permissive.
- **`determinism` fails on one machine only** → almost always locale/timezone-dependent formatting;
  the check diffs the two runs to show the field.
- **`snapshot` of a `prepare` page on a machine without a browser** → fails clearly (needs the
  Playwright backend); static pages need no browser.
- **`snapshot` hits an auth wall** (e.g. LinkedIn) → capture from a logged-in browser session; the
  harness doesn't manage credentials (framework auth is v1). The resulting committed HTML tests
  offline like any other fixture.
- **`--update` on an `errorCase` fixture** → no-op (error fixtures have no `expected.json`).

## Acceptance criteria

- **Each check fires correctly** against crafted fixtures: a mismatched `expected.json` fails
  `fixture-extraction`; a schema-violating extraction fails `schema-conformance`; a `Date.now()` in a
  field fails `determinism`; an `errorCase` fixture that `validate` accepts fails
  `error-path-coverage`; an un-annotated optional field fails `presence-coverage` (per the table).
- **Warnings don't change exit code**; `--strict` can opt into failing on them.
- **`sitely dev`** re-runs on save and surfaces per-field diffs + presence warnings without ever
  exiting non-zero.
- **`sitely snapshot`** produces a `<hash>.html` that `sitely test` can then extract from — including
  a dynamic page where the captured HTML is post-`prepare`.
- **The three example scrapers** (Reddit, LinkedIn, HN) each pass all five checks against their
  committed fixtures — the v0 definition of done.

## Open questions

- **Extract-timeout surfacing in `dev`.** A hung selector should show as a per-field timeout, not
  wedge the watch loop — confirm the `dev` loop wraps each fixture in the runner's timeout.
- **`snapshot` params ergonomics.** JSON on the CLI (`'{"id":"1"}'`) is clunky; a friendlier param
  syntax or an interactive prompt may be worth it.
- **Fixture hashing collisions.** 12 hex chars is comfortable for realistic fixture counts; revisit
  if a package ever approaches that scale.
